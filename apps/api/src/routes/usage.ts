import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { currentUser, requireUser } from "../auth/session.ts";
import { db } from "../db/client.ts";

export interface Usage {
  storageBytes: number;
  documents: number;
  recordings: number;
  mediaSecondsTotal: number;
  mediaSecondsThisMonth: number;
}

/** Storage in use and media minutes (RF18). Items in the trash still count until they're erased. */
export async function usageRoutes(app: FastifyInstance) {
  app.get("/usage", { preHandler: requireUser }, async (request): Promise<Usage> => {
    const user = currentUser(request);
    const res = await db.execute<{
      doc_bytes: string | null;
      rec_bytes: string | null;
      documents: number;
      recordings: number;
      media_total: string | null;
      media_month: string | null;
    }>(sql`
      select
        (select sum(size_bytes) from (select distinct on (storage_key) size_bytes from source_documents where user_id = ${user.id}) d) as doc_bytes,
        (select sum(r.size_bytes) from recordings r join attempts a on a.id = r.attempt_id join study_sessions s on s.id = a.session_id
           join subjects sb on sb.id = s.subject_id where sb.user_id = ${user.id}) as rec_bytes,
        (select count(*)::int from source_documents where user_id = ${user.id} and deleted_at is null) as documents,
        (select count(*)::int from recordings r join attempts a on a.id = r.attempt_id join study_sessions s on s.id = a.session_id
           join subjects sb on sb.id = s.subject_id where sb.user_id = ${user.id} and a.deleted_at is null and r.status = 'ready') as recordings,
        (select sum(quantity) from usage_ledger where user_id = ${user.id} and kind = 'media_seconds') as media_total,
        (select sum(quantity) from usage_ledger where user_id = ${user.id} and kind = 'media_seconds'
           and created_at >= date_trunc('month', now())) as media_month`);
    const r = res.rows[0]!;
    return {
      storageBytes: Number(r.doc_bytes ?? 0) + Number(r.rec_bytes ?? 0),
      documents: r.documents,
      recordings: r.recordings,
      mediaSecondsTotal: Number(r.media_total ?? 0),
      mediaSecondsThisMonth: Number(r.media_month ?? 0),
    };
  });
}
