import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Recreates the test database schema from the migrations once per test run. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://calabrain:calabrain@localhost:5432/calabrain_test";
  const pool = new pg.Pool({ connectionString: url });
  try {
    await pool.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  } finally {
    await pool.end();
  }
}
