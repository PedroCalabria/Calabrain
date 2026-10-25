import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.ts";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations() {
  await migrate(db, { migrationsFolder });
}

// Run directly: `pnpm db:migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied.");
      return pool.end();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
