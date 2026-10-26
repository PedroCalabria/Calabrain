/** Daily Postgres backup to the bucket (deploy requirement): pg_dump, gzip, keep the last 14. */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import type { Storage } from "@calabrain/storage";

export const BACKUP_PREFIX = "backups/";
const KEEP = 14;

export async function backupDatabase(storage: Storage, databaseUrl: string, now = new Date()): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "calabrain-backup-"));
  try {
    const file = join(dir, "dump.sql.gz");
    const dump = spawn("pg_dump", ["--no-owner", "--no-privileges", "--dbname", databaseUrl], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    dump.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
    const exited = new Promise<number>((resolve, reject) => (dump.on("error", reject), dump.on("close", (c) => resolve(c ?? 1))));
    await pipeline(dump.stdout, createGzip(), createWriteStream(file));
    const code = await exited;
    if (code !== 0) throw new Error(`pg_dump failed: ${stderr}`);

    const key = `${BACKUP_PREFIX}calabrain-${now.toISOString().slice(0, 19).replace(/[:T]/g, "-")}.sql.gz`;
    await storage.upload(key, file, "application/gzip");

    const all = (await storage.list(BACKUP_PREFIX)).sort((a, b) => a.key.localeCompare(b.key));
    const old = all.slice(0, Math.max(0, all.length - KEEP)).map((o) => o.key);
    if (old.length) await storage.deleteMany(old);
    return key;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
