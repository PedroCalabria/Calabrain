/** Source document jobs: text extraction (RF05), per-user dedupe (RF07) and chapter split (RF08). */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema, type Db } from "@calabrain/db";
import { unreferenced } from "@calabrain/db/trash";
import type { Storage } from "@calabrain/storage";
import { and, asc, between, eq, ne, sql } from "drizzle-orm";
import { copyPages, extractPdf, PdfError } from "../pdf.ts";

const { sourceDocuments, documentPages, documentOutline, usageLedger } = schema;

export interface Deps {
  db: Db;
  storage: Storage;
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "calabrain-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fail(db: Db, id: string, reason: string) {
  await db.update(sourceDocuments).set({ status: "failed", failureReason: reason }).where(eq(sourceDocuments.id, id));
}

async function savePages(db: Db, documentId: string, pages: string[]) {
  await db.delete(documentPages).where(eq(documentPages.documentId, documentId));
  for (let i = 0; i < pages.length; i += 200) {
    await db.insert(documentPages).values(
      pages.slice(i, i + 200).map((text, j) => ({ documentId, pageNumber: i + j + 1, text })),
    );
  }
}

async function saveOutline(db: Db, documentId: string, outline: { title: string; level: number; startPage: number; endPage: number | null }[]) {
  await db.delete(documentOutline).where(eq(documentOutline.documentId, documentId));
  if (outline.length) {
    await db.insert(documentOutline).values(outline.map((o, position) => ({ documentId, position, ...o })));
  }
}

export async function processDocument({ db, storage }: Deps, documentId: string): Promise<void> {
  const [doc] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, documentId));
  if (!doc || doc.deletedAt || doc.status === "ready") return;

  await withTemp(async (dir) => {
    const file = join(dir, "source.pdf");
    try {
      await storage.download(doc.storageKey, file);
    } catch {
      return fail(db, doc.id, "missing");
    }
    const bytes = await readFile(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    // Same file already stored for this user: point at that object and drop the new copy.
    const [twin] = await db
      .select()
      .from(sourceDocuments)
      .where(
        and(
          eq(sourceDocuments.userId, doc.userId),
          eq(sourceDocuments.sha256, sha256),
          eq(sourceDocuments.status, "ready"),
          ne(sourceDocuments.id, doc.id),
          ne(sourceDocuments.storageKey, doc.storageKey),
          sql`${sourceDocuments.parentDocumentId} is null`,
        ),
      )
      .limit(1);

    if (twin && (await storage.head(twin.storageKey))) {
      const ownKey = doc.storageKey;
      const pages = await db
        .select({ text: documentPages.text })
        .from(documentPages)
        .where(eq(documentPages.documentId, twin.id))
        .orderBy(asc(documentPages.pageNumber));
      const outline = await db
        .select({ title: documentOutline.title, level: documentOutline.level, startPage: documentOutline.startPage, endPage: documentOutline.endPage })
        .from(documentOutline)
        .where(eq(documentOutline.documentId, twin.id))
        .orderBy(asc(documentOutline.position));
      await savePages(db, doc.id, pages.map((p) => p.text));
      await saveOutline(db, doc.id, outline);
      await db
        .update(sourceDocuments)
        .set({ storageKey: twin.storageKey, sha256, pageCount: twin.pageCount, status: "ready", failureReason: null })
        .where(eq(sourceDocuments.id, doc.id));
      const orphans = await unreferenced(db, [ownKey]);
      if (orphans.length) await storage.deleteMany(orphans);
      return;
    }

    try {
      const { pageCount, pages, outline } = await extractPdf(bytes);
      await savePages(db, doc.id, pages);
      await saveOutline(db, doc.id, outline);
      await db
        .update(sourceDocuments)
        .set({ sha256, pageCount, sizeBytes: bytes.length, status: "ready", failureReason: null })
        .where(eq(sourceDocuments.id, doc.id));
      await db.insert(usageLedger).values({ userId: doc.userId, kind: "storage_bytes", quantity: bytes.length, unit: "bytes", refId: doc.id });
    } catch (err) {
      if (err instanceof PdfError) return fail(db, doc.id, err.reason);
      throw err;
    }
  });
}

export async function splitDocument({ db, storage }: Deps, documentId: string): Promise<void> {
  const [child] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, documentId));
  if (!child || child.deletedAt || child.status === "ready" || !child.parentDocumentId) return;
  const [book] = await db.select().from(sourceDocuments).where(eq(sourceDocuments.id, child.parentDocumentId));
  if (!book || book.status !== "ready") return fail(db, child.id, "missing");
  const start = child.pageStart ?? 1;
  const end = child.pageEnd ?? book.pageCount ?? start;

  await withTemp(async (dir) => {
    const src = join(dir, "book.pdf");
    try {
      await storage.download(book.storageKey, src);
    } catch {
      return fail(db, child.id, "missing");
    }
    let out: Uint8Array;
    try {
      out = await copyPages(await readFile(src), start, end);
    } catch {
      return fail(db, child.id, "corrupt");
    }
    const key = `u/${child.userId}/chapters/${child.id}.pdf`;
    const path = join(dir, "chapter.pdf");
    await writeFile(path, out);
    await storage.upload(key, path, "application/pdf");

    // The chapter's text is the book's text for that range, renumbered from page 1.
    const pages = await db
      .select({ text: documentPages.text })
      .from(documentPages)
      .where(and(eq(documentPages.documentId, book.id), between(documentPages.pageNumber, start, end)))
      .orderBy(asc(documentPages.pageNumber));
    await savePages(db, child.id, pages.map((p) => p.text));
    const outline = await db
      .select()
      .from(documentOutline)
      .where(and(eq(documentOutline.documentId, book.id), between(documentOutline.startPage, start, end)))
      .orderBy(asc(documentOutline.position));
    await saveOutline(
      db,
      child.id,
      outline.map((o) => ({
        title: o.title,
        level: o.level,
        startPage: o.startPage - start + 1,
        endPage: o.endPage === null ? null : Math.min(o.endPage, end) - start + 1,
      })),
    );
    await db
      .update(sourceDocuments)
      .set({
        storageKey: key,
        sha256: createHash("sha256").update(out).digest("hex"),
        sizeBytes: out.length,
        pageCount: end - start + 1,
        status: "ready",
        failureReason: null,
      })
      .where(eq(sourceDocuments.id, child.id));
    await db.insert(usageLedger).values({ userId: child.userId, kind: "storage_bytes", quantity: out.length, unit: "bytes", refId: child.id });
  });
}
