import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, schema } from "@calabrain/db";
import { createStorage, storageConfigFromEnv } from "@calabrain/storage";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processRecording } from "../src/jobs/recordings.ts";
import { probe } from "../src/media.ts";

const { db, pool } = createDb(process.env.DATABASE_URL!, 3);
const storage = createStorage(storageConfigFromEnv());
const dir = mkdtempSync(join(tmpdir(), "rec-fixtures-"));
afterAll(() => pool.end());

const ff = (...args: string[]) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
const files = {
  h264: join(dir, "h264.mp4"),
  hevc: join(dir, "iphone.mov"),
  mp3: join(dir, "voice.mp3"),
  long: join(dir, "long.m4a"),
  junk: join(dir, "junk.mp4"),
};
beforeAll(() => {
  const video = ["-f", "lavfi", "-i", "testsrc=size=320x240:rate=15", "-f", "lavfi", "-i", "sine=frequency=440"];
  ff(...video, "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", files.h264);
  ff(...video, "-t", "2", "-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", files.hevc);
  ff("-f", "lavfi", "-i", "sine=frequency=300", "-t", "2", "-c:a", "libmp3lame", files.mp3);
  ff("-f", "lavfi", "-i", "anullsrc=r=8000:cl=mono", "-t", "62", "-c:a", "aac", "-b:a", "16k", files.long);
  execFileSync("sh", ["-c", `head -c 4000 /dev/urandom > ${files.junk}`]);
});

async function pending(path: string, mime: string, limitMin = 15) {
  const userId = crypto.randomUUID();
  await db.insert(schema.users).values({ id: userId, name: "T", email: `${userId}@example.com` });
  const [subject] = await db.insert(schema.subjects).values({ userId, title: "S" }).returning();
  const [session] = await db.insert(schema.studySessions).values({ subjectId: subject!.id, title: "Ch. 5", recordingLimitMin: limitMin }).returning();
  const [attempt] = await db.insert(schema.attempts).values({ sessionId: session!.id, number: 1 }).returning();
  const key = `u/${userId}/${crypto.randomUUID()}.${path.split(".").pop()}`;
  const bytes = readFileSync(path);
  await storage.putBytes(key, bytes, mime);
  const [rec] = await db.insert(schema.recordings).values({ attemptId: attempt!.id, storageKey: key, mime, sizeBytes: bytes.length }).returning();
  return { rec: rec!, key, userId };
}
const reload = async (id: string) => (await db.select().from(schema.recordings).where(eq(schema.recordings.id, id)))[0]!;

describe("process-recording job (RF12, RF14)", () => {
  it("keeps a browser-playable MP4 and adds the audio track and a thumbnail", async () => {
    const { rec, key, userId } = await pending(files.h264, "video/mp4");
    await processRecording({ db, storage }, rec.id);
    const after = await reload(rec.id);
    expect(after).toMatchObject({ status: "ready", storageKey: key, mime: "video/mp4", durationS: 3 });
    expect(after.audioKey).toMatch(/\.audio\.ogg$/);
    expect(after.thumbnailKey).toMatch(/\.thumb\.jpg$/);
    expect(await storage.head(after.thumbnailKey!)).not.toBeNull();

    const audio = join(dir, `${rec.id}.ogg`);
    await storage.download(after.audioKey!, audio);
    const a = await probe(audio);
    expect(a.audio?.codec).toBe("opus");
    expect(a.video).toBeNull();
    const ledger = await db.select().from(schema.usageLedger).where(eq(schema.usageLedger.userId, userId));
    expect(ledger.map((l) => l.kind).sort()).toEqual(["media_seconds", "storage_bytes"]);
  });

  it("converts HEVC from an iPhone .mov into MP4 H.264 and drops the original", async () => {
    const { rec, key } = await pending(files.hevc, "video/quicktime");
    await processRecording({ db, storage }, rec.id);
    const after = await reload(rec.id);
    expect(after).toMatchObject({ status: "ready", mime: "video/mp4" });
    expect(after.storageKey).toMatch(/\.play\.mp4$/);
    expect(await storage.head(key)).toBeNull();
    const out = join(dir, `${rec.id}.mp4`);
    await storage.download(after.storageKey, out);
    expect((await probe(out)).video?.codec).toBe("h264");
  });

  it("accepts audio-only recordings without a thumbnail", async () => {
    const { rec } = await pending(files.mp3, "audio/mpeg");
    await processRecording({ db, storage }, rec.id);
    expect(await reload(rec.id)).toMatchObject({ status: "ready", mime: "audio/mpeg", durationS: 2, thumbnailKey: null });
  });

  it("rejects a recording over the session limit and erases it", async () => {
    const { rec, key } = await pending(files.long, "audio/mp4", 1);
    await processRecording({ db, storage }, rec.id);
    expect(await reload(rec.id)).toMatchObject({ status: "failed", failureReason: "too_long" });
    expect(await storage.head(key)).toBeNull();
  });

  it("fails clearly on a file that isn't media", async () => {
    const { rec } = await pending(files.junk, "video/mp4");
    await processRecording({ db, storage }, rec.id);
    expect(await reload(rec.id)).toMatchObject({ status: "failed", failureReason: "corrupt" });
  });
});

describe("daily jobs", () => {
  it("backs the database up to the bucket", async () => {
    const { backupDatabase, BACKUP_PREFIX } = await import("../src/jobs/backup.ts");
    const key = await backupDatabase(storage, process.env.DATABASE_URL!);
    expect(key.startsWith(BACKUP_PREFIX)).toBe(true);
    const head = await storage.head(key);
    expect(head!.size).toBeGreaterThan(500);
  });

  it("aborts uploads nobody finished and deletes files nobody used", async () => {
    const { cleanupUploads } = await import("../src/jobs/uploads.ts");
    const userId = crypto.randomUUID();
    await db.insert(schema.users).values({ id: userId, name: "T", email: `${userId}@example.com` });
    const key = `u/${userId}/orphan.pdf`;
    await storage.putBytes(key, new Uint8Array([1, 2, 3]), "application/pdf");
    const past = new Date(Date.now() - 2 * 86400000);
    const [done] = await db
      .insert(schema.uploads)
      .values({ userId, storageKey: key, kind: "source_document", filename: "a.pdf", contentType: "application/pdf", sizeBytes: 3, status: "completed", expiresAt: past })
      .returning();
    const n = await cleanupUploads({ db, storage });
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await storage.head(key)).toBeNull();
    expect((await db.select().from(schema.uploads).where(eq(schema.uploads.id, done!.id)))[0]!.status).toBe("aborted");
  });
});
