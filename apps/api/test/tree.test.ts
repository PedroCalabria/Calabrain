import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { ORIGIN, signUp } from "./helpers.ts";

let app: Awaited<ReturnType<typeof buildApp>>;
let me: string;
let other: string;

beforeAll(async () => {
  app = await buildApp();
  me = (await signUp(app)).cookie;
  other = (await signUp(app)).cookie;
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

async function subject(title = "Distributed Systems") {
  const r = await call("POST", "/subjects", me, { title, description: "From one book and one lecture series." });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const folder = async (subjectId: string, title: string, parentId?: string) =>
  (await call("POST", "/folders", me, { subjectId, title, parentId })).body.id as string;
const session = async (subjectId: string, title: string, folderId?: string) =>
  (await call("POST", "/sessions", me, { subjectId, title, folderId })).body.id as string;
const tree = async (subjectId: string) => (await call("GET", `/subjects/${subjectId}/tree`, me)).body;

describe("subjects (RF02)", () => {
  it("creates, lists, renames and reorders subjects", async () => {
    const a = await subject("A");
    const b = await subject("B");
    const list = (await call("GET", "/subjects", me)).body as { id: string; title: string }[];
    expect(list.map((s) => s.id)).toEqual(expect.arrayContaining([a, b]));

    const renamed = await call("PATCH", `/subjects/${b}`, me, { title: "B, renamed", position: 0 });
    expect(renamed.status).toBe(200);
    expect(renamed.body.title).toBe("B, renamed");
    const after = (await call("GET", "/subjects", me)).body as { id: string }[];
    expect(after[0]!.id).toBe(b);
  });

  it("rejects an empty title with a field message", async () => {
    const r = await call("POST", "/subjects", me, { title: "  " });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.title).toBe("Give the subject a name.");
  });

  it("hides another user's subject behind a 404", async () => {
    const id = await subject();
    expect((await call("GET", `/subjects/${id}`, other)).status).toBe(404);
    expect((await call("GET", `/subjects/${id}/tree`, other)).status).toBe(404);
    expect((await call("PATCH", `/subjects/${id}`, other, { title: "x" })).status).toBe(404);
    expect((await call("DELETE", `/subjects/${id}`, other)).status).toBe(404);
    expect((await call("POST", "/folders", other, { subjectId: id, title: "x" })).status).toBe(404);
    expect((await call("POST", "/sessions", other, { subjectId: id, title: "x" })).status).toBe(404);
    const list = (await call("GET", "/subjects", other)).body as { id: string }[];
    expect(list.find((s) => s.id === id)).toBeUndefined();
  });
});

describe("folders and sessions (RF02)", () => {
  it("builds a tree of any depth with sessions in folders", async () => {
    const s = await subject();
    const book = await folder(s, "Designing Data-Intensive Applications");
    const part2 = await folder(s, "Part II · Distributed data", book);
    const ch5 = await session(s, "Ch. 5 · Replication", part2);
    const loose = await session(s, "Course syllabus");

    const t = await tree(s);
    expect(t.folders).toHaveLength(2);
    expect(t.folders.find((f: { id: string }) => f.id === part2).parentId).toBe(book);
    expect(t.sessions.find((x: { id: string }) => x.id === ch5).folderId).toBe(part2);
    expect(t.sessions.find((x: { id: string }) => x.id === loose).folderId).toBeNull();
    expect(t.subject.sessionCount).toBe(2);

    const detail = (await call("GET", `/sessions/${ch5}`, me)).body;
    expect(detail.recordingLimitMin).toBe(15);
    expect(detail.breadcrumb.map((b: { title: string }) => b.title)).toEqual([
      "Distributed Systems",
      "Designing Data-Intensive Applications",
      "Part II · Distributed data",
    ]);
  });

  it("moves folders and sessions, and refuses a folder inside itself", async () => {
    const s = await subject();
    const a = await folder(s, "A");
    const b = await folder(s, "B", a);
    const c = await folder(s, "C");
    const x = await session(s, "X", a);

    expect((await call("PATCH", `/folders/${a}`, me, { parentId: b })).status).toBe(400);
    expect((await call("PATCH", `/folders/${a}`, me, { parentId: a })).status).toBe(400);

    const moved = await call("PATCH", `/folders/${b}`, me, { parentId: c });
    expect(moved.body.parentId).toBe(c);
    const toRoot = await call("PATCH", `/sessions/${x}`, me, { folderId: null });
    expect(toRoot.body.folderId).toBeNull();
    const intoC = await call("PATCH", `/sessions/${x}`, me, { folderId: c });
    expect(intoC.body.folderId).toBe(c);
  });

  it("won't move items into another subject", async () => {
    const s1 = await subject("One");
    const s2 = await subject("Two");
    const f1 = await folder(s1, "F1");
    const f2 = await folder(s2, "F2");
    const x = await session(s1, "X");
    expect((await call("PATCH", `/sessions/${x}`, me, { folderId: f2 })).status).toBe(400);
    expect((await call("PATCH", `/folders/${f1}`, me, { parentId: f2 })).status).toBe(400);
  });

  it("reorders sessions inside a folder", async () => {
    const s = await subject();
    const f = await folder(s, "F");
    const one = await session(s, "1", f);
    const two = await session(s, "2", f);
    const three = await session(s, "3", f);
    await call("PATCH", `/sessions/${three}`, me, { position: 0 });
    const order = (await tree(s)).sessions.map((x: { id: string }) => x.id);
    expect(order).toEqual([three, one, two]);
  });

  it("limits the recording to 1–30 minutes (RF12)", async () => {
    const s = await subject();
    const x = await session(s, "X");
    expect((await call("PATCH", `/sessions/${x}`, me, { recordingLimitMin: 31 })).status).toBe(400);
    expect((await call("PATCH", `/sessions/${x}`, me, { recordingLimitMin: 30 })).body.recordingLimitMin).toBe(30);
  });
});

describe("trash (RF03)", () => {
  it("moves a folder with everything under it to the trash as one entry, and restores it all", async () => {
    const s = await subject("Trash test");
    const part = await folder(s, "Part II");
    const sub = await folder(s, "Chapters", part);
    const ch5 = await session(s, "Ch. 5", sub);
    const other = await session(s, "Keep me");

    expect((await call("DELETE", `/folders/${part}`, me)).status).toBe(204);
    let t = await tree(s);
    expect(t.folders).toHaveLength(0);
    expect(t.sessions.map((x: { id: string }) => x.id)).toEqual([other]);
    expect((await call("GET", `/sessions/${ch5}`, me)).status).toBe(404);

    const trash = (await call("GET", "/trash", me)).body as { type: string; id: string; location: string; purgeAt: string; deletedAt: string }[];
    const mine = trash.filter((i) => i.location?.startsWith("Trash test") || i.id === part);
    expect(mine.map((i) => i.id)).toEqual([part]);
    const days = (new Date(mine[0]!.purgeAt).getTime() - new Date(mine[0]!.deletedAt).getTime()) / 86_400_000;
    expect(days).toBe(30);

    expect((await call("POST", `/trash/folder/${part}/restore`, me)).status).toBe(204);
    t = await tree(s);
    expect(t.folders).toHaveLength(2);
    expect(t.sessions).toHaveLength(2);
  });

  it("keeps an item deleted earlier in the trash when its parent comes back", async () => {
    const s = await subject();
    const f = await folder(s, "F");
    const early = await session(s, "Deleted first", f);
    const later = await session(s, "Deleted with the folder", f);
    await call("DELETE", `/sessions/${early}`, me);
    await call("DELETE", `/folders/${f}`, me);

    // The earlier session can't come back while its folder is in the trash.
    const blocked = await call("POST", `/trash/session/${early}/restore`, me);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("parent_in_trash");

    await call("POST", `/trash/folder/${f}/restore`, me);
    const ids = (await tree(s)).sessions.map((x: { id: string }) => x.id);
    expect(ids).toContain(later);
    expect(ids).not.toContain(early);
    const trash = (await call("GET", "/trash", me)).body as { id: string }[];
    expect(trash.some((i) => i.id === early)).toBe(true);
  });

  it("deletes a whole subject and erases it for good on request", async () => {
    const s = await subject("Erase me");
    await folder(s, "F");
    await call("DELETE", `/subjects/${s}`, me);
    expect((await call("GET", `/subjects/${s}`, me)).status).toBe(404);
    expect((await call("GET", "/trash", other)).body.some((i: { id: string }) => i.id === s)).toBe(false);
    expect((await call("DELETE", `/trash/subject/${s}`, other)).status).toBe(404);

    expect((await call("DELETE", `/trash/subject/${s}`, me)).status).toBe(204);
    const left = await db.execute(sql`select count(*)::int as n from folders where subject_id = ${s}`);
    expect(left.rows[0]).toEqual({ n: 0 });
    expect((await call("POST", `/trash/subject/${s}/restore`, me)).status).toBe(404);
  });

  it("does not list or restore rows that were deleted along with a parent", async () => {
    const s = await subject();
    const f = await folder(s, "F");
    const x = await session(s, "X", f);
    await call("DELETE", `/subjects/${s}`, me);
    expect((await call("POST", `/trash/session/${x}/restore`, me)).status).toBe(404);
    expect((await call("POST", `/trash/folder/${f}/restore`, me)).status).toBe(404);
    await call("POST", `/trash/subject/${s}/restore`, me);
    expect((await tree(s)).sessions).toHaveLength(1);
  });
});

describe("daily trash purge", () => {
  it("erases entries older than 30 days and leaves newer ones", async () => {
    const { purgeExpired } = await import("@calabrain/db/trash");
    const s = await subject("Old");
    const old = await session(s, "Deleted 31 days ago");
    const recent = await session(s, "Deleted yesterday");
    await call("DELETE", `/sessions/${old}`, me);
    await call("DELETE", `/sessions/${recent}`, me);
    await db.execute(sql`update study_sessions set deleted_at = now() - interval '31 days' where id = ${old}`);
    await db.execute(sql`update study_sessions set deleted_at = now() - interval '1 day' where id = ${recent}`);

    const result = await purgeExpired(db, 30);
    expect(result.purged).toBeGreaterThanOrEqual(1);
    const rows = await db.execute<{ id: string }>(
      sql`select id from study_sessions where id in (${old}, ${recent})`,
    );
    expect(rows.rows.map((r) => r.id)).toEqual([recent]);
  });
});
