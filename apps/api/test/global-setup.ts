import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { runMigrations } from "@calabrain/db/migrate";
import pg from "pg";

/** Recreates the test database schema from the migrations once per test run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://calabrain:calabrain@localhost:5432/calabrain_test";
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; create schema public;");
  } finally {
    await pool.end();
  }
  await runMigrations(url);

  const s3 = new S3Client({
    endpoint: process.env.TEST_S3_ENDPOINT ?? "http://127.0.0.1:9100",
    region: "us-east-1",
    forcePathStyle: true,
    credentials: { accessKeyId: "test", secretAccessKey: "test-secret" },
  });
  await s3.send(new CreateBucketCommand({ Bucket: "calabrain-test" })).catch(() => undefined);
}
