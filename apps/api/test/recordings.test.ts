import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processRecording } from "../../worker/src/jobs/recordings.ts";
import { buildApp } from "../src/app.ts";
import { db, pool } from "../src/db/client.ts";
import { storage } from "../src/lib/storage.ts";
import { ORIGIN, signUp } from "./helpers.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let app: Awaited<ReturnType<typeof buildApp>>;
let me: string;
let other: string;
let sessionId: string;
let clip: Uint8Array;

beforeAll(async () => {
  app = await buildApp();
  me = (await signUp(app)).cookie;
  other = (await signUp(app)).cookie;
  const subjectId = (await call("POST", "/subjects", me, { title: "Distributed Systems" })).body.id;
  sessionId = (await call("POST", "/sessions", me, { subjectId, title: "Ch. 5 · Replication" })).body.id;
  const path = join(mkdtempSync(join(tmpdir(), "api-rec-")), "clip.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=10", "-f", "lavfi", "-i", "sine", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path]);
  clip = readFileSync(path);
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
async function call(method: Method, url: string, cookie: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: { cookie, origin: ORIGIN }, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}) });
  return { status: res.statusCode, body: res.body ? res.json() : null };
}

async function upload(bytes: Uint8Array, filename = "take.mp4", contentType = "video/mp4") {
  const start = await call("POST", "/uploads", me, { kind: "recording", filename, contentType, sizeBytes: bytes.length });
  expect(start.status).toBe(201);
  const [part] = (await call("POST", `/uploads/${start.body.id}/parts`, me, { partNumbers: [1] })).body.parts;
  await fetch(part.url, { method: "PUT", body: bytes });
  await call("POST", `/uploads/${start.body.id}/complete`, me);
  return start.body.id as string;
}

const worker = { db, storage };

describe("attempts and recordings (RF12, RF13)", () => {
  it("rejects files that aren't video or audio, and recordings over the limit", async () => {
    const bad = await call("POST", "/uploads", me, { kind: "recording", filename: "slides.pdf", contentType: "application/pdf", sizeBytes: 10 });
    expect(bad.status).toBe(400);
    const big = await call("POST", "/uploads", me, { kind: "recording", filename: "take.mov", contentType: "video/quicktime", sizeBytes: 3 * 1024 ** 3 });
    expect(big.body.error.message).toBe("This recording is larger than 2 GB. Choose a smaller file.");
    const uploadId = await upload(clip);
    const long = await call("POST", `/sessions/${sessionId}/attempts`, me, { uploadId, durationS: 16 * 60 });
    expect(long.status).toBe(400);
    expect(long.body.error.code).toBe("too_long");
  });

  it("numbers new attempts and keeps the earlier ones", async () => {
    const a1 = await call("POST", `/sessions/${sessionId}/attempts`, me, { uploadId: await upload(clip), durationS: 2 });
    const a2 = await call("POST", `/sessions/${sessionId}/attempts`, me, { uploadId: await upload(clip), durationS: 2 });
    expect(a2.body.number).toBe(a1.body.number + 1);
    expect(a1.body.recording).toMatchObject({ status: "processing", kind: "video" });
    const list = (await call("GET", `/sessions/${sessionId}/attempts`, me)).body;
    expect(list.slice(0, 2).map((a: { id: string }) => a.id)).toEqual([a2.body.id, a1.body.id]);

    await processRecording(worker, a1.body.recording.id);
    const ready = (await call("GET", `/attempts/${a1.body.id}`, me)).body;
    expect(ready.recording).toMatchObject({ status: "ready", durationS: 2 });
    const res = await fetch(ready.playbackUrl, { headers: { range: "bytes=0-99" } });
    expect([200, 206]).toContain(res.status);
    expect(ready.thumbnailUrl).toBeTruthy();
    expect((await call("GET", `/attempts/${a1.body.id}`, other)).status).toBe(404);
  });

  it("replaces a recording: old files and markers are erased (RF13)", async () => {
    const a = (await call("POST", `/sessions/${sessionId}/attempts`, me, { uploadId: await upload(clip) })).body;
    await processRecording(worker, a.recording.id);
    const before = (await call("GET", `/attempts/${a.id}`, me)).body;
    const oldKey = (await db.query.recordings.findFirst({ where: (r, { eq }) => eq(r.id, before.recording.id) }))!.storageKey;
    await call("POST", `/recordings/${before.recording.id}/markers`, me, { tSeconds: 1, label: "Leader election" });

    const replaced = await call("PUT", `/attempts/${a.id}/recording`, me, { uploadId: await upload(clip) });
    expect(replaced.status).toBe(200);
    expect(replaced.body.number).toBe(a.number);
    expect(replaced.body.markers).toEqual([]);
    expect(replaced.body.recording.id).not.toBe(before.recording.id);
    expect(await storage.head(oldKey)).toBeNull();
  });

  it("adds, renames and deletes time markers (RF15)", async () => {
    const a = (await call("POST", `/sessions/${sessionId}/attempts`, me, { uploadId: await upload(clip) })).body;
    const m = await call("POST", `/recordings/${a.recording.id}/markers`, me, { tSeconds: 1.4, label: "Quorums" });
    expect(m.body).toMatchObject({ tSeconds: 1, label: "Quorums" });
    expect((await call("POST", `/recordings/${a.recording.id}/markers`, other, { tSeconds: 1, label: "x" })).status).toBe(404);
    expect((await call("PATCH", `/markers/${m.body.id}`, me, { label: "Quorums: w + r > n" })).body.label).toBe("Quorums: w + r > n");
    expect((await call("PATCH", `/markers/${m.body.id}`, other, { label: "x" })).status).toBe(404);
    expect((await call("DELETE", `/markers/${m.body.id}`, me)).status).toBe(204);
    expect((await call("GET", `/attempts/${a.id}`, me)).body.markers).toEqual([]);
  });

  it("moves an attempt to the trash and erases its files when erased", async () => {
    const a = (await call("POST", `/sessions/${sessionId}/attempts`, me, { uploadId: await upload(clip) })).body;
    await processRecording(worker, a.recording.id);
    const rec = (await db.query.recordings.findFirst({ where: (r, { eq }) => eq(r.id, a.recording.id) }))!;
    expect((await call("DELETE", `/attempts/${a.id}`, me)).status).toBe(204);
    expect((await call("GET", "/trash", me)).body.find((t: { id: string }) => t.id === a.id)).toMatchObject({ type: "attempt" });
    expect((await call("DELETE", `/trash/attempt/${a.id}`, me)).status).toBe(204);
    for (const key of [rec.storageKey, rec.audioKey!, rec.thumbnailKey!]) expect(await storage.head(key)).toBeNull();
  });
});
