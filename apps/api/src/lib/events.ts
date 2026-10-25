/** Fan-out of worker status events (Postgres LISTEN) to each user's open SSE streams (RF16). */
import { EVENTS_CHANNEL, type StatusEvent } from "@calabrain/db/events";
import pg from "pg";
import { env } from "../env.ts";

type Listener = (event: StatusEvent) => void;

const listeners = new Map<string, Set<Listener>>();
let client: pg.Client | null = null;
let connecting: Promise<void> | null = null;

async function connect(): Promise<void> {
  const c = new pg.Client({ connectionString: env.DATABASE_URL });
  c.on("notification", (msg) => {
    if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
    let event: StatusEvent;
    try {
      event = JSON.parse(msg.payload) as StatusEvent;
    } catch {
      return;
    }
    for (const fn of listeners.get(event.userId) ?? []) fn(event);
  });
  c.on("error", () => {
    client = null;
    connecting = null;
    // Reconnect while someone is listening; clients also poll as a fallback.
    if (listeners.size) setTimeout(() => void ensure().catch(() => undefined), 2000);
  });
  await c.connect();
  await c.query(`listen ${EVENTS_CHANNEL}`);
  client = c;
}

const ensure = () => (client ? Promise.resolve() : (connecting ??= connect()));

export async function subscribe(userId: string, fn: Listener): Promise<() => void> {
  await ensure();
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (!set!.size) listeners.delete(userId);
  };
}

export async function stopEvents() {
  listeners.clear();
  const c = client;
  client = null;
  connecting = null;
  await c?.end().catch(() => undefined);
}
