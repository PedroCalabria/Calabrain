import {
  createAttemptSchema,
  jobs,
  markerSchema,
  type AttemptDetail,
  type AttemptSummary,
  type Marker,
  type RecordingInfo,
} from "@calabrain/shared";
import { softDelete, unreferenced } from "@calabrain/db/trash";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentUser, requireUser } from "../auth/session.ts";
import { db, schema, type Tx } from "../db/client.ts";
import { HttpError, notFound } from "../lib/errors.ts";
import { enqueue } from "../lib/queue.ts";
import { storage } from "../lib/storage.ts";
import { deleteStorageObjects } from "../services/storage-cleanup.ts";
import { ownSession } from "../services/tree.ts";
import { idParam } from "./subjects.ts";
import { usableUpload } from "./uploads.ts";

const { attempts, recordings, recordingMarkers, studySessions, subjects } = schema;

async function ownAttempt(tx: Tx, userId: string, id: string) {
  const [row] = await tx
    .select({ attempt: attempts, session: studySessions })
    .from(attempts)
    .innerJoin(studySessions, eq(studySessions.id, attempts.sessionId))
    .innerJoin(subjects, eq(subjects.id, studySessions.subjectId))
    .where(
      and(
        eq(attempts.id, id),
        eq(subjects.userId, userId),
        isNull(attempts.deletedAt),
        isNull(studySessions.deletedAt),
        isNull(subjects.deletedAt),
      ),
    );
  if (!row) throw notFound("Attempt");
  return row;
}

async function ownRecording(tx: Tx, userId: string, id: string) {
  const [row] = await tx.select({ attemptId: recordings.attemptId }).from(recordings).where(eq(recordings.id, id));
  if (!row) throw notFound("Recording");
  await ownAttempt(tx, userId, row.attemptId);
  return row;
}

async function ownMarker(tx: Tx, userId: string, id: string) {
  const [row] = await tx.select().from(recordingMarkers).where(eq(recordingMarkers.id, id));
  if (!row) throw notFound("Marker");
  await ownRecording(tx, userId, row.recordingId);
  return row;
}

const info = (r: typeof recordings.$inferSelect): RecordingInfo => ({
  id: r.id,
  status: r.status,
  failureReason: r.failureReason,
  mime: r.mime,
  kind: r.mime.startsWith("audio/") ? "audio" : "video",
  durationS: r.durationS,
  sizeBytes: r.sizeBytes,
});

const marker = (m: typeof recordingMarkers.$inferSelect): Marker => ({ id: m.id, tSeconds: m.tSeconds, label: m.label });

async function detail(tx: Tx, attempt: typeof attempts.$inferSelect): Promise<AttemptDetail> {
  const [rec] = await tx.select().from(recordings).where(eq(recordings.attemptId, attempt.id));
  const markers = rec
    ? await tx.select().from(recordingMarkers).where(eq(recordingMarkers.recordingId, rec.id)).orderBy(asc(recordingMarkers.tSeconds))
    : [];
  const ready = rec?.status === "ready";
  return {
    id: attempt.id,
    number: attempt.number,
    sessionId: attempt.sessionId,
    createdAt: attempt.createdAt.toISOString(),
    recording: rec ? info(rec) : null,
    // One hour: long enough to watch a 30-minute recording with pauses.
    playbackUrl: ready ? await storage.presignGet(rec.storageKey, 3600, { contentType: rec.mime }) : null,
    thumbnailUrl: ready && rec.thumbnailKey ? await storage.presignGet(rec.thumbnailKey, 3600, { contentType: "image/jpeg" }) : null,
    markers: markers.map(marker),
  };
}

/** Storage objects of a recording (video or audio, extracted audio, thumbnail). */
const filesOf = (r: typeof recordings.$inferSelect) => [r.storageKey, r.audioKey, r.thumbnailKey].filter((k): k is string => !!k);

export async function recordingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /** Latest attempts across all subjects (the Recordings page). */
  app.get("/recordings", async (request) => {
    const user = currentUser(request);
    const rows = await db
      .select({ attempt: attempts, recording: recordings, sessionTitle: studySessions.title, subjectTitle: subjects.title })
      .from(attempts)
      .innerJoin(studySessions, eq(studySessions.id, attempts.sessionId))
      .innerJoin(subjects, eq(subjects.id, studySessions.subjectId))
      .leftJoin(recordings, eq(recordings.attemptId, attempts.id))
      .where(and(eq(subjects.userId, user.id), isNull(attempts.deletedAt), isNull(studySessions.deletedAt), isNull(subjects.deletedAt)))
      .orderBy(desc(attempts.createdAt))
      .limit(100);
    return rows.map((r) => ({
      id: r.attempt.id,
      number: r.attempt.number,
      sessionId: r.attempt.sessionId,
      createdAt: r.attempt.createdAt.toISOString(),
      recording: r.recording ? info(r.recording) : null,
      sessionTitle: r.sessionTitle,
      subjectTitle: r.subjectTitle,
    }));
  });

  app.get("/sessions/:id/attempts", async (request): Promise<AttemptSummary[]> => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await ownSession(db, user.id, id);
    const rows = await db
      .select({ attempt: attempts, recording: recordings })
      .from(attempts)
      .leftJoin(recordings, eq(recordings.attemptId, attempts.id))
      .where(and(eq(attempts.sessionId, id), isNull(attempts.deletedAt)))
      .orderBy(desc(attempts.number));
    return rows.map((r) => ({
      id: r.attempt.id,
      number: r.attempt.number,
      createdAt: r.attempt.createdAt.toISOString(),
      recording: r.recording ? info(r.recording) : null,
    }));
  });

  /** New attempt: the previous ones stay, with their recordings (RF13). */
  app.post("/sessions/:id/attempts", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = createAttemptSchema.parse(request.body);
    const created = await db.transaction(async (tx) => {
      const session = await ownSession(tx, user.id, id);
      if (input.durationS !== undefined && input.durationS > session.recordingLimitMin * 60 + 1) {
        throw new HttpError(400, "too_long", `This recording is longer than the session's ${session.recordingLimitMin}-minute limit.`);
      }
      const upload = await usableUpload(tx, user.id, input.uploadId, "recording");
      await tx.execute(sql`select id from study_sessions where id = ${id} for update`);
      const [{ next }] = (await tx
        .select({ next: sql<number>`coalesce(max(${attempts.number}), 0) + 1` })
        .from(attempts)
        .where(eq(attempts.sessionId, id))) as [{ next: number }];
      const [attempt] = await tx.insert(attempts).values({ sessionId: id, number: Number(next) }).returning();
      const [rec] = await tx
        .insert(recordings)
        .values({ attemptId: attempt!.id, storageKey: upload.storageKey, mime: upload.contentType, sizeBytes: upload.sizeBytes })
        .returning();
      return { attempt: attempt!, recordingId: rec!.id };
    });
    await enqueue(jobs.processRecording, { recordingId: created.recordingId });
    reply.status(201);
    return detail(db, created.attempt);
  });

  app.get("/attempts/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const { attempt } = await ownAttempt(db, user.id, id);
    return detail(db, attempt);
  });

  /**
   * Replace the recording of an attempt (RF13): the old files and markers are erased
   * (and, in phase 2, the attempt's evaluations).
   */
  app.put("/attempts/:id/recording", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = createAttemptSchema.parse(request.body);
    const { attempt, oldKeys, recordingId } = await db.transaction(async (tx) => {
      const { attempt, session } = await ownAttempt(tx, user.id, id);
      if (input.durationS !== undefined && input.durationS > session.recordingLimitMin * 60 + 1) {
        throw new HttpError(400, "too_long", `This recording is longer than the session's ${session.recordingLimitMin}-minute limit.`);
      }
      const upload = await usableUpload(tx, user.id, input.uploadId, "recording");
      const [old] = await tx.select().from(recordings).where(eq(recordings.attemptId, id));
      if (old) await tx.delete(recordings).where(eq(recordings.id, old.id)); // markers cascade
      const [rec] = await tx
        .insert(recordings)
        .values({ attemptId: id, storageKey: upload.storageKey, mime: upload.contentType, sizeBytes: upload.sizeBytes })
        .returning();
      return { attempt, oldKeys: old ? await unreferenced(tx, filesOf(old)) : [], recordingId: rec!.id };
    });
    await deleteStorageObjects(oldKeys, request.log);
    await enqueue(jobs.processRecording, { recordingId });
    return detail(db, attempt);
  });

  app.delete("/attempts/:id", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await db.transaction(async (tx) => {
      await ownAttempt(tx, user.id, id);
      await softDelete(tx, "attempt", id);
    });
    return reply.status(204).send();
  });

  // --- Time markers (RF15)

  app.post("/recordings/:id/markers", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = markerSchema.parse(request.body);
    await ownRecording(db, user.id, id);
    const [row] = await db
      .insert(recordingMarkers)
      .values({ recordingId: id, tSeconds: Math.round(input.tSeconds), label: input.label })
      .returning();
    reply.status(201);
    return marker(row!);
  });

  app.patch("/markers/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = markerSchema.partial().parse(request.body);
    await ownMarker(db, user.id, id);
    const set: Partial<typeof recordingMarkers.$inferInsert> = {};
    if (input.label !== undefined) set.label = input.label;
    if (input.tSeconds !== undefined) set.tSeconds = Math.round(input.tSeconds);
    const [row] = Object.keys(set).length
      ? await db.update(recordingMarkers).set(set).where(eq(recordingMarkers.id, id)).returning()
      : await db.select().from(recordingMarkers).where(eq(recordingMarkers.id, id));
    return marker(row!);
  });

  app.delete("/markers/:id", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await ownMarker(db, user.id, id);
    await db.delete(recordingMarkers).where(eq(recordingMarkers.id, id));
    return reply.status(204).send();
  });
}
