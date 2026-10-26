import { jobs } from "@calabrain/shared";
import { PgBoss } from "pg-boss";
import { env } from "../env.ts";

/** Send-only queue client: the worker runs the jobs, maintenance and schedules. */
let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function start(): Promise<PgBoss> {
  const b = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss", supervise: false, schedule: false, max: 3 });
  b.on("error", (err) => console.error("[queue]", err));
  await b.start();
  for (const name of Object.values(jobs)) await b.createQueue(name);
  boss = b;
  return b;
}

export async function enqueue(name: (typeof jobs)[keyof typeof jobs], data: object, opts: { singletonKey?: string } = {}) {
  const b = boss ?? (await (starting ??= start()));
  await b.send(name, data, { retryLimit: 3, retryDelay: 30, retryBackoff: true, ...opts });
}

export async function stopQueue() {
  if (boss) await boss.stop({ graceful: false });
  boss = null;
  starting = null;
}
