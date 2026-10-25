/**
 * Background worker: PDF and media processing, fed by a queue in Postgres (pg-boss).
 * Stage 1 only boots the queue; the jobs (PDF text, chapter split, media conversion,
 * note import, trash purge) arrive with their features in the next stages.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PgBoss } from "pg-boss";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");

const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
boss.on("error", (err) => console.error("[worker]", err));

await boss.start();
console.log("[worker] ready, waiting for jobs");

const stop = async () => {
  await boss.stop({ graceful: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
