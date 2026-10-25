/**
 * Background worker: PDF and media processing, fed by a queue in Postgres (pg-boss).
 * Jobs arrive with their features; today it runs the daily trash purge (RF03).
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb } from "@calabrain/db";
import { purgeExpired } from "@calabrain/db/trash";
import { limits } from "@calabrain/shared";
import { PgBoss } from "pg-boss";
import { deleteObjects } from "./storage.ts";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");

const { db, pool } = createDb(url, 5);
const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
boss.on("error", (err) => console.error("[worker]", err));
await boss.start();

// --- Trash purge: every day at 03:17 (São Paulo), erase what passed the 30-day window.
const PURGE = "purge-trash";
await boss.createQueue(PURGE);
await boss.schedule(PURGE, "17 3 * * *", null, { tz: "America/Sao_Paulo" });
await boss.work(PURGE, async () => {
  const { purged, keys } = await purgeExpired(db, limits.trashRetentionDays);
  await deleteObjects(keys);
  console.log(`[worker] trash purge: ${purged} item(s), ${keys.length} file(s)`);
});

console.log("[worker] ready, waiting for jobs");

const stop = async () => {
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
