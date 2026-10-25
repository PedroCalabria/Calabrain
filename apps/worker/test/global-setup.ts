import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { runMigrations } from "@calabrain/db/migrate";
import pg from "pg";

/** Fresh database (created if missing) and bucket for the worker tests. */
export default async function setup() {
  const url = process.env.TEST_WORKER_DATABASE_URL ?? "postgres://calabrain:calabrain@localhost:5432/calabrain_worker_test";
  const dbName = new URL(url).pathname.slice(1);
  const admin = new pg.Client({ connectionString: url.replace(/\/[^/]+$/, "/postgres") });
  await admin.connect();
  const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
  if (!exists.rowCount) await admin.query(`create database "${dbName}"`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: url });
  await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await pool.end();
  await runMigrations(url);

  const s3 = new S3Client({
    endpoint: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9100",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test-secret" },
  });
  await s3.send(new CreateBucketCommand({ Bucket: "calabrain-worker-test" })).catch(() => undefined);
}
