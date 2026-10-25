import { createDb, schema } from "@calabrain/db";
import { createStorage, storageConfigFromEnv } from "@calabrain/storage";
import { asc, eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { processDocument, splitDocument } from "../src/jobs/documents.ts";
import { extractPdf, PdfError } from "../src/pdf.ts";
import { bookOutline, bookPages, makePdf } from "./fixtures.ts";

const { db, pool } = createDb(process.env.DATABASE_URL!, 3);
const storage = createStorage(storageConfigFromEnv());
const deps = { db, storage };
afterAll(() => pool.end());

async function setup() {
  const userId = crypto.randomUUID();
  await db.insert(schema.users).values({ id: userId, name: "Test", email: `${userId}@example.com` });
  const [subject] = await db.insert(schema.subjects).values({ userId, title: "Distributed Systems" }).returning();
  return { userId, subjectId: subject!.id };
}

async function stored(userId: string, subjectId: string, bytes: Uint8Array, title = "Book") {
  const key = `u/${userId}/${crypto.randomUUID()}.pdf`;
  await storage.putBytes(key, bytes, "application/pdf");
  const [doc] = await db
    .insert(schema.sourceDocuments)
    .values({ userId, subjectId, title, storageKey: key, sha256: "", sizeBytes: bytes.length })
    .returning();
  return doc!;
}

const reload = async (id: string) => (await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.id, id)))[0]!;

describe("PDF extraction (RF05)", () => {
  it("reads the text of every page and the outline with page ranges", async () => {
    const out = await extractPdf(await makePdf(bookPages, bookOutline));
    expect(out.pageCount).toBe(12);
    expect(out.pages[6]).toContain("Page 7.");
    expect(out.outline).toEqual([
      { title: "Part I", level: 1, startPage: 1, endPage: 6 },
      { title: "Ch. 1 Reliability", level: 2, startPage: 1, endPage: 3 },
      { title: "Ch. 2 Data models", level: 2, startPage: 4, endPage: 6 },
      { title: "Part II", level: 1, startPage: 7, endPage: 12 },
      { title: "Ch. 5 Replication", level: 2, startPage: 7, endPage: 9 },
      { title: "Ch. 6 Partitioning", level: 2, startPage: 10, endPage: 12 },
    ]);
  });

  it("refuses a PDF without selectable text", async () => {
    await expect(extractPdf(await makePdf(["", "", ""]))).rejects.toEqual(new PdfError("no_text"));
  });

  it("refuses a file that isn't a PDF", async () => {
    await expect(extractPdf(new TextEncoder().encode("hello, not a pdf"))).rejects.toEqual(new PdfError("corrupt"));
  });
});

describe("process-document job", () => {
  it("stores pages and outline and marks the document ready", async () => {
    const { userId, subjectId } = await setup();
    const doc = await stored(userId, subjectId, await makePdf(bookPages, bookOutline));
    await processDocument(deps, doc.id);

    const after = await reload(doc.id);
    expect(after.status).toBe("ready");
    expect(after.pageCount).toBe(12);
    expect(after.sha256).toMatch(/^[0-9a-f]{64}$/);
    const pages = await db.select().from(schema.documentPages).where(eq(schema.documentPages.documentId, doc.id));
    expect(pages).toHaveLength(12);
    const outline = await db.select().from(schema.documentOutline).where(eq(schema.documentOutline.documentId, doc.id));
    expect(outline).toHaveLength(6);
    const ledger = await db.select().from(schema.usageLedger).where(eq(schema.usageLedger.refId, doc.id));
    expect(ledger[0]).toMatchObject({ kind: "storage_bytes", unit: "bytes" });
  });

  it("fails with no_text for a scanned-like PDF", async () => {
    const { userId, subjectId } = await setup();
    const doc = await stored(userId, subjectId, await makePdf(["", ""]));
    await processDocument(deps, doc.id);
    expect(await reload(doc.id)).toMatchObject({ status: "failed", failureReason: "no_text" });
  });

  it("dedupes an identical file of the same user, never across users (RF07)", async () => {
    const bytes = await makePdf(bookPages, bookOutline);
    const a = await setup();
    const first = await stored(a.userId, a.subjectId, bytes);
    await processDocument(deps, first.id);
    const second = await stored(a.userId, a.subjectId, bytes, "Same book again");
    const secondKey = second.storageKey;
    await processDocument(deps, second.id);

    const after = await reload(second.id);
    expect(after.status).toBe("ready");
    expect(after.storageKey).toBe((await reload(first.id)).storageKey);
    expect(await storage.head(secondKey)).toBeNull();

    const b = await setup();
    const other = await stored(b.userId, b.subjectId, bytes);
    await processDocument(deps, other.id);
    expect((await reload(other.id)).storageKey).not.toBe((await reload(first.id)).storageKey);
  });
});

describe("split-document job (RF08)", () => {
  it("creates a chapter PDF with only its pages and their text", async () => {
    const { userId, subjectId } = await setup();
    const book = await stored(userId, subjectId, await makePdf(bookPages, bookOutline));
    await processDocument(deps, book.id);
    const [session] = await db.insert(schema.studySessions).values({ subjectId, title: "Ch. 5 Replication" }).returning();
    const [child] = await db
      .insert(schema.sourceDocuments)
      .values({
        userId,
        subjectId,
        sessionId: session!.id,
        title: "Book · Ch. 5",
        storageKey: (await reload(book.id)).storageKey,
        sha256: "",
        sizeBytes: 0,
        parentDocumentId: book.id,
        pageStart: 7,
        pageEnd: 9,
      })
      .returning();

    await splitDocument(deps, child!.id);
    const after = await reload(child!.id);
    expect(after).toMatchObject({ status: "ready", pageCount: 3 });
    expect(after.storageKey).toContain("/chapters/");

    const path = `/tmp/chapter-${child!.id}.pdf`;
    await storage.download(after.storageKey, path);
    const pdf = await PDFDocument.load(await (await import("node:fs/promises")).readFile(path));
    expect(pdf.getPageCount()).toBe(3);

    const pages = await db
      .select()
      .from(schema.documentPages)
      .where(eq(schema.documentPages.documentId, child!.id))
      .orderBy(asc(schema.documentPages.pageNumber));
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);
    expect(pages[0]!.text).toContain("Page 7.");
    const outline = await db.select().from(schema.documentOutline).where(eq(schema.documentOutline.documentId, child!.id));
    expect(outline.map((o) => [o.title, o.startPage, o.endPage])).toEqual([["Part II", 1, 3], ["Ch. 5 Replication", 1, 3]]);
  });
});
