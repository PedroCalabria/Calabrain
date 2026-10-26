import { createStorage } from "@calabrain/storage";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processDocument } from "../../worker/src/jobs/documents.ts";
import { makePdf, bookOutline, bookPages } from "../../worker/test/fixtures.ts";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { storage } from "../src/lib/storage.ts";
import { ORIGIN, signUp } from "./helpers.ts";

let app: Awaited<ReturnType<typeof buildApp>>;
let me: string;
let other: string;
let subjectId: string;
const worker = { db, storage: storage as ReturnType<typeof createStorage> };

beforeAll(async () => {
  app = await buildApp();
  me = (await signUp(app)).cookie;
  other = (await signUp(app)).cookie;
  subjectId = (await call("POST", "/subjects", me, { title: "Distributed Systems" })).body.id;
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

type Method = "GET" | "POST" | "PATCH" | "DELETE";
async function call(method: Method, url: string, cookie: string, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

/** The browser's side of an upload: start, PUT each part to its presigned URL, complete. */
async function upload(bytes: Uint8Array, filename = "ddia.pdf", cookie = me, opts: { skipComplete?: boolean } = {}) {
  const start = await call("POST", "/uploads", cookie, {
    kind: "source_document",
    filename,
    contentType: "application/pdf",
    sizeBytes: bytes.length,
  });
  expect(start.status).toBe(201);
  const { id, partSize, partCount } = start.body;
  const parts = await call("POST", `/uploads/${id}/parts`, cookie, {
    partNumbers: Array.from({ length: partCount }, (_, i) => i + 1),
  });
  for (const p of parts.body.parts as { partNumber: number; url: string }[]) {
    const chunk = bytes.subarray((p.partNumber - 1) * partSize, p.partNumber * partSize);
    const res = await fetch(p.url, { method: "PUT", body: chunk });
    expect(res.ok).toBe(true);
  }
  if (!opts.skipComplete) expect((await call("POST", `/uploads/${id}/complete`, cookie)).status).toBe(200);
  return id as string;
}

async function readyBook() {
  const uploadId = await upload(await makePdf(bookPages, bookOutline));
  const created = await call("POST", "/documents", me, { uploadId, subjectId });
  expect(created.status).toBe(201);
  expect(created.body.status).toBe("processing");
  await processDocument(worker, created.body.id);
  return created.body.id as string;
}

describe("uploads (RF04)", () => {
  it("rejects files that aren't PDFs and PDFs over 200 MB", async () => {
    const wrong = await call("POST", "/uploads", me, { kind: "source_document", filename: "notes.docx", sizeBytes: 1000 });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.message).toBe("This isn't a PDF. Choose a PDF.");
    const big = await call("POST", "/uploads", me, {
      kind: "source_document",
      filename: "huge.pdf",
      contentType: "application/pdf",
      sizeBytes: 201 * 1024 * 1024,
    });
    expect(big.status).toBe(400);
    expect(big.body.error.message).toBe("This PDF is larger than 200 MB. Choose a smaller file.");
  });

  it("reports which parts arrived so a broken upload resends only the rest", async () => {
    const bytes = new Uint8Array(12 * 1024 * 1024).fill(37); // 2 parts of 10 MB max
    const start = await call("POST", "/uploads", me, {
      kind: "recording",
      filename: "take.mp4",
      contentType: "video/mp4",
      sizeBytes: bytes.length,
    });
    const { id, partSize, partCount } = start.body;
    expect(partCount).toBe(2);
    const [first] = (await call("POST", `/uploads/${id}/parts`, me, { partNumbers: [1] })).body.parts;
    await fetch(first.url, { method: "PUT", body: bytes.subarray(0, partSize) });

    expect((await call("GET", `/uploads/${id}`, me)).body.uploadedParts).toEqual([1]);
    expect((await call("POST", `/uploads/${id}/complete`, me)).status).toBe(409);

    const [second] = (await call("POST", `/uploads/${id}/parts`, me, { partNumbers: [2] })).body.parts;
    await fetch(second.url, { method: "PUT", body: bytes.subarray(partSize) });
    expect((await call("POST", `/uploads/${id}/complete`, me)).body.status).toBe("completed");
  });

  it("hides another user's upload and won't let it be used twice", async () => {
    const id = await upload(await makePdf(["Short text page for the upload test."]));
    expect((await call("GET", `/uploads/${id}`, other)).status).toBe(404);
    const otherSubject = (await call("POST", "/subjects", other, { title: "Theirs" })).body.id;
    expect((await call("POST", "/documents", other, { uploadId: id, subjectId: otherSubject })).status).toBe(404);

    expect((await call("POST", "/documents", me, { uploadId: id, subjectId })).status).toBe(201);
    const again = await call("POST", "/documents", me, { uploadId: id, subjectId });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("upload_used");
  });

  it("won't attach an upload that hasn't finished", async () => {
    const id = await upload(await makePdf(["Text."]), "x.pdf", me, { skipComplete: true });
    const res = await call("POST", "/documents", me, { uploadId: id, subjectId });
    expect(res.status).toBe(409);
  });
});

describe("documents (RF04–06)", () => {
  it("attaches at the session level and lists it in the tree", async () => {
    const session = (await call("POST", "/sessions", me, { subjectId, title: "Ch. 5" })).body.id;
    const uploadId = await upload(await makePdf(bookPages));
    const created = await call("POST", "/documents", me, { uploadId, subjectId, sessionId: session });
    expect(created.body).toMatchObject({ sessionId: session, folderId: null, title: "ddia" });
    const tree = (await call("GET", `/subjects/${subjectId}/tree`, me)).body;
    expect(tree.documents.find((d: { id: string }) => d.id === created.body.id)).toMatchObject({ sessionId: session, status: "processing" });
    expect(tree.sessions.find((s: { id: string }) => s.id === session).documentCount).toBe(1);
  });

  it("serves pages, the outline and a short-lived file URL once ready", async () => {
    const id = await readyBook();
    const doc = (await call("GET", `/documents/${id}`, me)).body;
    expect(doc).toMatchObject({ status: "ready", pageCount: 12 });
    expect(doc.outline[0]).toEqual({ title: "Part I", level: 1, startPage: 1, endPage: 6 });

    const pages = (await call("GET", `/documents/${id}/pages?from=7&to=8`, me)).body.pages;
    expect(pages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([7, 8]);
    expect(pages[0].text).toContain("Page 7.");

    const { url } = (await call("GET", `/documents/${id}/file`, me)).body;
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
    expect((await call("GET", `/documents/${id}/file`, other)).status).toBe(404);
  });

  it("splits a book into sessions with chapter documents (RF08)", async () => {
    const id = await readyBook();
    const folder = (await call("POST", "/folders", me, { subjectId, title: "DDIA" })).body.id;
    const tooFar = await call("POST", `/documents/${id}/split`, me, {
      folderId: folder,
      chapters: [{ title: "Ch. 99", pageStart: 10, pageEnd: 13 }],
    });
    expect(tooFar.status).toBe(400);

    const split = await call("POST", `/documents/${id}/split`, me, {
      folderId: folder,
      chapters: [
        { title: "Ch. 5 Replication", pageStart: 7, pageEnd: 9 },
        { title: "Ch. 6 Partitioning", pageStart: 10, pageEnd: 12 },
      ],
    });
    expect(split.status).toBe(201);
    expect(split.body.created).toHaveLength(2);
    const tree = (await call("GET", `/subjects/${subjectId}/tree`, me)).body;
    const sessions = tree.sessions.filter((s: { folderId: string }) => s.folderId === folder);
    expect(sessions.map((s: { title: string }) => s.title)).toEqual(["Ch. 5 Replication", "Ch. 6 Partitioning"]);
    const child = (await call("GET", `/documents/${split.body.created[0].documentId}`, me)).body;
    expect(child).toMatchObject({ parentDocumentId: id, pageStart: 7, pageEnd: 9, status: "processing" });
  });

  it("moves a document to the trash and erases its file when erased (RF03)", async () => {
    const id = await readyBook();
    const key = (await db.execute<{ storage_key: string }>(sql`select storage_key from source_documents where id = ${id}`)).rows[0]!.storage_key;
    // Other ready copies of the same book share the object; erase only frees it when none remain.
    await db.execute(sql`update source_documents set storage_key = storage_key || '-shared-test' where storage_key = ${key} and id <> ${id}`);
    expect((await call("DELETE", `/documents/${id}`, me)).status).toBe(204);
    expect((await call("GET", `/documents/${id}`, me)).status).toBe(404);
    expect(await storage.head(key)).not.toBeNull();
    expect((await call("DELETE", `/trash/document/${id}`, me)).status).toBe(204);
    expect(await storage.head(key)).toBeNull();
  });
});
