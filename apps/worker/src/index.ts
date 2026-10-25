/**
 * Background worker, fed by a queue in Postgres (pg-boss): PDF text and chapters, media,
 * note imports and the daily trash purge.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "@calabrain/db";
import { commitIdleDrafts } from "@calabrain/db/notes";
import { purgeExpired } from "@calabrain/db/trash";
import { jobs, limits, type ImportNoteJob, type ProcessDocumentJob, type SplitDocumentJob } from "@calabrain/shared";
import { PgBoss } from "pg-boss";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");

// Imported after the env is loaded: storage reads S3_* at import time.
const { storage, deleteObjects } = await import("./storage.ts");
const { processDocument, splitDocument } = await import("./jobs/documents.ts");
const { importNote } = await import("./jobs/notes.ts");

const { db, pool } = createDb(url, 5);
const deps = { db, storage };
const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
boss.on("error", (err) => console.error("[worker]", err));
await boss.start();
for (const name of Object.values(jobs)) await boss.createQueue(name);

const log = (msg: string) => console.log(`[worker] ${msg}`);

await boss.work<ProcessDocumentJob>(jobs.processDocument, { localConcurrency: 2 }, async ([job]) => {
  await processDocument(deps, job!.data.documentId);
  log(`document ${job!.data.documentId} processed`);
});

await boss.work<SplitDocumentJob>(jobs.splitDocument, { localConcurrency: 2 }, async ([job]) => {
  await splitDocument(deps, job!.data.documentId);
  log(`chapter ${job!.data.documentId} created`);
});

await boss.work<ImportNoteJob>(jobs.importNote, { localConcurrency: 2 }, async ([job]) => {
  await importNote(deps, job!.data.noteId, job!.data.uploadId);
  log(`note ${job!.data.noteId} imported`);
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
  log(`trash purge: ${purged} item(s), ${keys.length} file(s)`);
});

log("ready, waiting for jobs");

const stop = async () => {
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
