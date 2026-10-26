/**
 * Background worker, fed by a queue in Postgres (pg-boss): PDF text and chapters, media,
 * note imports and the daily trash purge.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, schema } from "@calabrain/db";
import { announce } from "@calabrain/db/events";
import { commitIdleDrafts } from "@calabrain/db/notes";
import { purgeExpired } from "@calabrain/db/trash";
import {
  jobs,
  limits,
  type ImportNoteJob,
  type ProcessDocumentJob,
  type ProcessRecordingJob,
  type SplitDocumentJob,
} from "@calabrain/shared";
import { eq } from "drizzle-orm";
import { PgBoss, type Job } from "pg-boss";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");

// Imported after the env is loaded: storage reads S3_* at import time.
const { storage, deleteObjects } = await import("./storage.ts");
const { processDocument, splitDocument } = await import("./jobs/documents.ts");
const { importNote } = await import("./jobs/notes.ts");
const { processRecording } = await import("./jobs/recordings.ts");
const { cleanupUploads } = await import("./jobs/uploads.ts");
const { backupDatabase } = await import("./jobs/backup.ts");

const { db, pool } = createDb(url, 5);
const deps = { db, storage };
const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
boss.on("error", (err) => console.error("[worker]", err));
await boss.start();
for (const name of Object.values(jobs)) await boss.createQueue(name);

const log = (msg: string) => console.log(`[worker] ${msg}`);

/** Same as the API's enqueue retryLimit: after the last retry the item is marked failed, not left processing. */
const RETRY_LIMIT = 3;
const tables = { document: schema.sourceDocuments, note: schema.notes, recording: schema.recordings } as const;

async function guarded(job: Job<object>, type: keyof typeof tables, id: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (err) {
    console.error(`[worker] ${type} ${id} failed (try ${job.retryCount + 1})`, err);
    if (job.retryCount < RETRY_LIMIT) throw err;
    await db.update(tables[type]).set({ status: "failed", failureReason: "internal" }).where(eq(tables[type].id, id));
  }
  await announce(db, type, id);
}

await boss.work<ProcessDocumentJob>(jobs.processDocument, { localConcurrency: 2 }, async ([job]) => {
  await guarded(job!, "document", job!.data.documentId, () => processDocument(deps, job!.data.documentId));
  log(`document ${job!.data.documentId} processed`);
});

await boss.work<SplitDocumentJob>(jobs.splitDocument, { localConcurrency: 2 }, async ([job]) => {
  await guarded(job!, "document", job!.data.documentId, () => splitDocument(deps, job!.data.documentId));
  log(`chapter ${job!.data.documentId} created`);
});

await boss.work<ImportNoteJob>(jobs.importNote, { localConcurrency: 2 }, async ([job]) => {
  await guarded(job!, "note", job!.data.noteId, () => importNote(deps, job!.data.noteId, job!.data.uploadId));
  log(`note ${job!.data.noteId} imported`);
});

// Media conversion is heavy: one at a time.
await boss.work<ProcessRecordingJob>(jobs.processRecording, { localConcurrency: 1 }, async ([job]) => {
  await guarded(job!, "recording", job!.data.recordingId, () => processRecording(deps, job!.data.recordingId));
  log(`recording ${job!.data.recordingId} processed`);
});

// Safety net for RF10: drafts idle for 5 minutes become a version even if the tab never said goodbye.
await boss.schedule(jobs.commitDrafts, "*/5 * * * *");
await boss.work(jobs.commitDrafts, async () => {
  const n = await commitIdleDrafts(db, limits.noteVersionIdleMinutes);
  if (n) log(`${n} idle draft(s) saved as versions`);
});

// Trash purge: every day at 03:17 (São Paulo), erase what passed the 30-day window, files included.
await boss.schedule(jobs.purgeTrash, "17 3 * * *", null, { tz: "America/Sao_Paulo" });
await boss.work(jobs.purgeTrash, async () => {
  const { purged, keys } = await purgeExpired(db, limits.trashRetentionDays);
  await deleteObjects(keys);
  const uploadsCleaned = await cleanupUploads(deps);
  log(`trash purge: ${purged} item(s), ${keys.length} file(s); ${uploadsCleaned} abandoned upload(s)`);
});

// Database backup to the bucket: every day at 04:07 (São Paulo), keeping the last 14.
await boss.createQueue("backup-db");
await boss.schedule("backup-db", "7 4 * * *", null, { tz: "America/Sao_Paulo" });
await boss.work("backup-db", async () => {
  const key = await backupDatabase(storage, url!);
  log(`database backup saved to ${key}`);
});

log("ready, waiting for jobs");

const stop = async () => {
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
