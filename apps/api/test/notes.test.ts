import { commitIdleDrafts } from "@calabrain/db/notes";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { ORIGIN, signUp } from "./helpers.ts";

let app: Awaited<ReturnType<typeof buildApp>>;
let me: string;
let other: string;
let sessionId: string;

beforeAll(async () => {
  app = await buildApp();
  me = (await signUp(app)).cookie;
  other = (await signUp(app)).cookie;
  const subjectId = (await call("POST", "/subjects", me, { title: "Distributed Systems" })).body.id;
  sessionId = (await call("POST", "/sessions", me, { subjectId, title: "Ch. 5 · Replication" })).body.id;
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
async function call(method: Method, url: string, cookie: string, payload?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { cookie, origin: ORIGIN },
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

const doc = (...paragraphs: string[]) => ({
  type: "doc",
  content: paragraphs.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});

async function newNote(title = "Leader election") {
  const r = await call("POST", `/sessions/${sessionId}/notes`, me, { title });
  expect(r.status).toBe(201);
  return r.body;
}

describe("notes (RF09)", () => {
  it("creates several notes per session, each starting at version 1", async () => {
    const a = await newNote("A");
    const b = await newNote("B");
    expect(a).toMatchObject({ version: 1, status: "ready", hasUnversionedDraft: false });
    const list = (await call("GET", `/sessions/${sessionId}/notes`, me)).body;
    expect(list.map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining([a.id, b.id]));
    expect((await call("GET", "/notes", me)).body[0]).toMatchObject({ sessionTitle: "Ch. 5 · Replication", subjectTitle: "Distributed Systems" });
  });

  it("hides another user's note", async () => {
    const n = await newNote();
    expect((await call("GET", `/notes/${n.id}`, other)).status).toBe(404);
    expect((await call("PUT", `/notes/${n.id}/draft`, other, { content: doc("x"), baseVersion: 1 })).status).toBe(404);
    expect((await call("POST", `/sessions/${sessionId}/notes`, other, {})).status).toBe(404);
  });
});

describe("drafts and versions (RF10)", () => {
  it("saves the draft continuously and turns it into an immutable version", async () => {
    const n = await newNote();
    const saved = await call("PUT", `/notes/${n.id}/draft`, me, { content: doc("Detect the failure."), baseVersion: 1 });
    expect(saved.status).toBe(200);
    const reopened = (await call("GET", `/notes/${n.id}`, me)).body;
    expect(reopened).toMatchObject({ hasUnversionedDraft: true, version: 1 });
    expect(reopened.content.content[0].content[0].text).toBe("Detect the failure.");

    const v = await call("POST", `/notes/${n.id}/versions`, me, { baseVersion: 1 });
    expect(v.status).toBe(201);
    expect(v.body.version).toBe(2);
    const versions = (await call("GET", `/notes/${n.id}/versions`, me)).body;
    expect(versions.map((x: { version: number }) => x.version)).toEqual([2, 1]);
    const two = (await call("GET", `/notes/${n.id}/versions/2`, me)).body;
    expect(two).toMatchObject({ text: "Detect the failure.", words: 3, source: "editor" });
  });

  it("answers 409 when another tab saved a version, and saves as new version on request", async () => {
    const n = await newNote();
    // Tab A makes version 2.
    await call("POST", `/notes/${n.id}/versions`, me, { baseVersion: 1, content: doc("From tab A") });
    // Tab B still thinks it's on version 1.
    const stale = await call("PUT", `/notes/${n.id}/draft`, me, { content: doc("From tab B"), baseVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("version_conflict");
    expect((await call("POST", `/notes/${n.id}/versions`, me, { baseVersion: 1, content: doc("From tab B") })).status).toBe(409);
    const forced = await call("POST", `/notes/${n.id}/versions`, me, { baseVersion: 1, content: doc("From tab B"), force: true });
    expect(forced.body.version).toBe(3);
  });

  it("restores an old version as a new one, overwriting nothing", async () => {
    const n = await newNote();
    await call("POST", `/notes/${n.id}/versions`, me, { baseVersion: 1, content: doc("First idea") });
    await call("POST", `/notes/${n.id}/versions`, me, { baseVersion: 2, content: doc("Second idea") });
    const restored = await call("POST", `/notes/${n.id}/versions/2/restore`, me);
    expect(restored.body.version).toBe(4);
    const now = (await call("GET", `/notes/${n.id}`, me)).body;
    expect(now.content.content[0].content[0].text).toBe("First idea");
    const sources = (await call("GET", `/notes/${n.id}/versions`, me)).body.map((x: { source: string }) => x.source);
    expect(sources).toEqual(["restore", "editor", "editor", "editor"]);
  });

  it("turns a draft idle for 5 minutes into a version (worker safety net)", async () => {
    const n = await newNote();
    await call("PUT", `/notes/${n.id}/draft`, me, { content: doc("Left the tab open"), baseVersion: 1 });
    await db.execute(sql`update notes set draft_updated_at = now() - interval '6 minutes' where id = ${n.id}`);
    expect(await commitIdleDrafts(db, 5)).toBeGreaterThanOrEqual(1);
    const after = (await call("GET", `/notes/${n.id}`, me)).body;
    expect(after).toMatchObject({ version: 2, hasUnversionedDraft: false });
  });

  it("rejects content that isn't a note document", async () => {
    const n = await newNote();
    expect((await call("PUT", `/notes/${n.id}/draft`, me, { content: { type: "evil" }, baseVersion: 1 })).status).toBe(400);
  });
});

describe("imports and trash", () => {
  it("starts an import from an upload with the note in processing (RF11)", async () => {
    const bytes = new TextEncoder().encode("# Imported\n\nText");
    const start = await call("POST", "/uploads", me, { kind: "note_import", filename: "notes.md", contentType: "text/markdown", sizeBytes: bytes.length });
    const [part] = (await call("POST", `/uploads/${start.body.id}/parts`, me, { partNumbers: [1] })).body.parts;
    await fetch(part.url, { method: "PUT", body: bytes });
    await call("POST", `/uploads/${start.body.id}/complete`, me);
    const r = await call("POST", `/sessions/${sessionId}/notes`, me, { uploadId: start.body.id });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ title: "notes", status: "processing", version: 0 });
    expect((await call("PUT", `/notes/${r.body.id}/draft`, me, { content: doc("x"), baseVersion: 0 })).status).toBe(409);
  });

  it("moves a note to the trash with its versions", async () => {
    const n = await newNote("Trash me");
    expect((await call("DELETE", `/notes/${n.id}`, me)).status).toBe(204);
    expect((await call("GET", `/notes/${n.id}`, me)).status).toBe(404);
    const trash = (await call("GET", "/trash", me)).body;
    expect(trash.find((t: { id: string }) => t.id === n.id)).toMatchObject({ type: "note", title: "Trash me" });
    await call("POST", `/trash/note/${n.id}/restore`, me);
    expect((await call("GET", `/notes/${n.id}`, me)).body.version).toBe(1);
  });
});
