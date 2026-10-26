import { createDb, schema } from "@calabrain/db";
import { env } from "../env.ts";

export const { db, pool } = createDb(env.DATABASE_URL);
export { schema };
export type { Db, Tx } from "@calabrain/db";
