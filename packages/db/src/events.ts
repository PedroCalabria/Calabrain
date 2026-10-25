/**
 * Status events (RF16): the worker announces finished jobs with Postgres NOTIFY and the API
 * relays them to the user's open tabs over Server-Sent Events.
 */
import { sql } from "drizzle-orm";
import type { Tx } from "./index.ts";

export const EVENTS_CHANNEL = "calabrain_events";

export interface StatusEvent {
  type: "document" | "note" | "recording";
  id: string;
  userId: string;
  status: "processing" | "ready" | "failed";
  subjectId?: string | null;
  sessionId?: string | null;
  attemptId?: string | null;
}

export async function notifyStatus(tx: Tx, event: StatusEvent): Promise<void> {
  await tx.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify(event)})`);
}

/** Looks up who owns an item and its current status, then announces it. */
export async function announce(tx: Tx, type: StatusEvent["type"], id: string): Promise<void> {
  const query = {
    document: sql`select d.user_id, d.status, d.subject_id, d.session_id, null::uuid as attempt_id from source_documents d where d.id = ${id}`,
    note: sql`select s.user_id, n.status, ss.subject_id, n.session_id, null::uuid as attempt_id
              from notes n join study_sessions ss on ss.id = n.session_id join subjects s on s.id = ss.subject_id where n.id = ${id}`,
    recording: sql`select s.user_id, r.status, ss.subject_id, a.session_id, r.attempt_id
                   from recordings r join attempts a on a.id = r.attempt_id join study_sessions ss on ss.id = a.session_id
                   join subjects s on s.id = ss.subject_id where r.id = ${id}`,
  }[type];
  const res = await tx.execute<{ user_id: string; status: StatusEvent["status"]; subject_id: string | null; session_id: string | null; attempt_id: string | null }>(query);
  const row = res.rows[0];
  if (!row) return;
  await notifyStatus(tx, {
    type,
    id,
    userId: row.user_id,
    status: row.status,
    subjectId: row.subject_id,
    sessionId: row.session_id,
    attemptId: row.attempt_id,
  });
}
