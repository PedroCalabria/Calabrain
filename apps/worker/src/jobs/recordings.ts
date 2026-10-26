/** Recording job (RF12, RF14): duration check, browser-playable MP4, extracted audio and thumbnail. */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@calabrain/db";
import { eq } from "drizzle-orm";
import { conversionTimeoutMs, extractAudio, MediaError, playbackPlan, probe, thumbnail, toMp4 } from "../media.ts";
import type { Deps } from "./documents.ts";

const { recordings, attempts, studySessions, subjects, usageLedger } = schema;

export async function processRecording({ db, storage }: Deps, recordingId: string): Promise<void> {
  const [row] = await db
    .select({ rec: recordings, limitMin: studySessions.recordingLimitMin, userId: subjects.userId })
    .from(recordings)
    .innerJoin(attempts, eq(attempts.id, recordings.attemptId))
    .innerJoin(studySessions, eq(studySessions.id, attempts.sessionId))
    .innerJoin(subjects, eq(subjects.id, studySessions.subjectId))
    .where(eq(recordings.id, recordingId));
  if (!row || row.rec.status === "ready") return;
  const rec = row.rec;
  const fail = async (reason: string, deleteFile = false) => {
    await db.update(recordings).set({ status: "failed", failureReason: reason }).where(eq(recordings.id, rec.id));
    if (deleteFile) await storage.deleteMany([rec.storageKey]);
  };

  const dir = await mkdtemp(join(tmpdir(), "calabrain-rec-"));
  try {
    const src = join(dir, "source");
    try {
      await storage.download(rec.storageKey, src);
    } catch {
      return fail("missing");
    }

    let info;
    try {
      info = await probe(src);
    } catch (err) {
      if (err instanceof MediaError) return fail(err.reason);
      throw err;
    }
    // The check that counts: the browser blocks early, but metadata can lie.
    if (info.durationS > row.limitMin * 60 + 1) return fail("too_long", true);

    const base = rec.storageKey.replace(/\.[a-z0-9]+$/i, "");
    let playKey = rec.storageKey;
    let mime = rec.mime;
    let playPath = src;
    const plan = playbackPlan(info, rec.mime);
    if (plan !== "keep") {
      playPath = join(dir, "play.mp4");
      try {
        await toMp4(src, playPath, plan, !!info.video, conversionTimeoutMs(info.durationS));
      } catch {
        return fail("unsupported");
      }
      playKey = `${base}.play.mp4`;
      mime = info.video ? "video/mp4" : "audio/mp4";
      await storage.upload(playKey, playPath, mime);
    }

    const audioKey = `${base}.audio.ogg`;
    const audioPath = join(dir, "audio.ogg");
    let hasAudio = false;
    if (info.audio) {
      await extractAudio(src, audioPath, conversionTimeoutMs(info.durationS));
      await storage.upload(audioKey, audioPath, "audio/ogg");
      hasAudio = true;
    }

    let thumbKey: string | null = null;
    if (info.video) {
      const thumbPath = join(dir, "thumb.jpg");
      await thumbnail(playPath, thumbPath, Math.min(1, info.durationS / 2));
      thumbKey = `${base}.thumb.jpg`;
      await storage.upload(thumbKey, thumbPath, "image/jpeg");
    }

    const size = (await stat(playPath)).size;
    await db
      .update(recordings)
      .set({
        storageKey: playKey,
        mime,
        sizeBytes: size,
        audioKey: hasAudio ? audioKey : null,
        thumbnailKey: thumbKey,
        durationS: Math.round(info.durationS),
        status: "ready",
        failureReason: null,
      })
      .where(eq(recordings.id, rec.id));
    if (playKey !== rec.storageKey) await storage.deleteMany([rec.storageKey]);
    await db.insert(usageLedger).values([
      { userId: row.userId, kind: "media_seconds", quantity: Math.round(info.durationS), unit: "seconds", refId: rec.id },
      { userId: row.userId, kind: "storage_bytes", quantity: size, unit: "bytes", refId: rec.id },
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
