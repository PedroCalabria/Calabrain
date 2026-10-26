import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

// Run directly: `pnpm db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  runMigrations(url)
    .then(() => console.log("Migrations applied."))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
