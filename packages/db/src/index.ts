import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export { schema };
export * from "./schema.ts";

export function createDb(connectionString: string, max = 10) {
  const pool = new pg.Pool({ connectionString, max });
  const db = drizzle(pool, { schema, casing: "snake_case" });
  return { db, pool };
}

export type Db = ReturnType<typeof createDb>["db"];
/** A db handle or an open transaction: both run the same queries. */
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];
