import { notifyStatus } from "@calabrain/db/events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { ORIGIN, signUp } from "./helpers.ts";

let app: Awaited<ReturnType<typeof buildApp>>;
let base: string;

beforeAll(async () => {
  app = await buildApp();
  base = await app.listen({ port: 0, host: "127.0.0.1" });
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

async function userId(cookie: string) {
  return (await app.inject({ method: "GET", url: "/me", headers: { cookie } })).json().id as string;
}

/** Reads SSE events from a live stream until `count` arrived or the time runs out. */
async function readEvents(cookie: string, count: number, during: () => Promise<void>) {
  const controller = new AbortController();
  const res = await fetch(`${base}/events`, { headers: { cookie, origin: ORIGIN }, signal: controller.signal });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  const reader = res.body!.getReader();
  const events: unknown[] = [];
  let buf = "";
  await new Promise((r) => setTimeout(r, 150));
  await during();
  const deadline = Date.now() + 3000;
  while (events.length < count && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), 500))]);
    if (!chunk || chunk.done) continue;
    buf += new TextDecoder().decode(chunk.value);
    for (const block of buf.split("\n\n").slice(0, -1)) {
      const data = block.split("\n").find((l) => l.startsWith("data: "));
      if (data) events.push(JSON.parse(data.slice(6)));
    }
    buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
  }
  controller.abort();
  return events;
}

describe("status events over SSE (RF16)", () => {
  it("delivers a user's processing updates to their open stream only", async () => {
    const me = (await signUp(app)).cookie;
    const other = (await signUp(app)).cookie;
    const [myId, otherId] = [await userId(me), await userId(other)];
    const docId = crypto.randomUUID();

    const events = await readEvents(me, 1, async () => {
      await notifyStatus(db, { type: "document", id: crypto.randomUUID(), userId: otherId, status: "ready" });
      await notifyStatus(db, { type: "document", id: docId, userId: myId, status: "ready", subjectId: null, sessionId: null });
    });
    expect(events).toEqual([{ type: "document", id: docId, status: "ready", subjectId: null, sessionId: null }]);
  });

  it("requires a session", async () => {
    const res = await fetch(`${base}/events`);
    expect(res.status).toBe(401);
  });
});

describe("usage (RF18)", () => {
  it("reports storage, items and media minutes", async () => {
    const me = (await signUp(app)).cookie;
    const res = await app.inject({ method: "GET", url: "/usage", headers: { cookie: me } });
    expect(res.json()).toEqual({ storageBytes: 0, documents: 0, recordings: 0, mediaSecondsTotal: 0, mediaSecondsThisMonth: 0 });
  });
});
