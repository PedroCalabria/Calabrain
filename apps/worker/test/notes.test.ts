import { createDb, schema } from "@calabrain/db";
import { createStorage, storageConfigFromEnv } from "@calabrain/storage";
import { docToText } from "@calabrain/shared";
import { desc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { importNote } from "../src/jobs/notes.ts";
import { makePdf } from "./fixtures.ts";

const { db, pool } = createDb(process.env.DATABASE_URL!, 3);
const storage = createStorage(storageConfigFromEnv());
afterAll(() => pool.end());

async function pendingImport(bytes: Uint8Array, filename: string, contentType: string) {
  const userId = crypto.randomUUID();
  await db.insert(schema.users).values({ id: userId, name: "T", email: `${userId}@example.com` });
  const [subject] = await db.insert(schema.subjects).values({ userId, title: "S" }).returning();
  const [session] = await db.insert(schema.studySessions).values({ subjectId: subject!.id, title: "Ch. 5" }).returning();
  const key = `u/${userId}/${crypto.randomUUID()}`;
  await storage.putBytes(key, bytes, contentType);
  const [upload] = await db
    .insert(schema.uploads)
    .values({ userId, storageKey: key, kind: "note_import", filename, contentType, sizeBytes: bytes.length, status: "completed", usedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) })
    .returning();
  const [note] = await db.insert(schema.notes).values({ sessionId: session!.id, title: filename, status: "processing" }).returning();
  return { note: note!, upload: upload!, key };
}

async function latest(noteId: string) {
  const [note] = await db.select().from(schema.notes).where(eq(schema.notes.id, noteId));
  const [v] = await db.select().from(schema.noteVersions).where(eq(schema.noteVersions.noteId, noteId)).orderBy(desc(schema.noteVersions.version));
  return { note: note!, version: v };
}

describe("import-note job (RF11)", () => {
  it("imports Markdown as an editable note and drops the uploaded file", async () => {
    const md = "# Leader election\n\n- Detect the failure\n- **Choose** a follower\n";
    const { note, upload, key } = await pendingImport(new TextEncoder().encode(md), "leader.md", "text/markdown");
    await importNote({ db, storage }, note.id, upload.id);
    const { note: after, version } = await latest(note.id);
    expect(after.status).toBe("ready");
    expect(version).toMatchObject({ version: 1, source: "import" });
    expect(version!.contentText).toBe("Leader election\nDetect the failure\nChoose a follower");
    expect(after.currentVersionId).toBe(version!.id);
    expect(await storage.head(key)).toBeNull();
  });

  it("imports plain text", async () => {
    const { note, upload } = await pendingImport(new TextEncoder().encode("One\n\nTwo"), "a.txt", "text/plain");
    await importNote({ db, storage }, note.id, upload.id);
    expect((await latest(note.id)).version!.contentText).toBe("One\nTwo");
  });

  it("keeps only the text of a PDF", async () => {
    const { note, upload } = await pendingImport(await makePdf(["Quorum reads need a majority of replicas."]), "q.pdf", "application/pdf");
    await importNote({ db, storage }, note.id, upload.id);
    const { version } = await latest(note.id);
    expect(docToText(version!.contentJson as never)).toContain("Quorum reads need a majority");
  });

  it("fails clearly on a damaged Word file", async () => {
    const { note, upload } = await pendingImport(
      new TextEncoder().encode("not a zip"),
      "broken.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    await importNote({ db, storage }, note.id, upload.id);
    expect((await latest(note.id)).note).toMatchObject({ status: "failed", failureReason: "corrupt" });
  });
});
