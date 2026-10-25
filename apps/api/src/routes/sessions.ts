import { createSessionSchema, limits, updateSessionSchema, type SessionDetail } from "@calabrain/shared";
import { softDelete } from "@calabrain/db/trash";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentUser, requireUser } from "../auth/session.ts";
import { db, schema, type Tx } from "../db/client.ts";
import {
  destinationFolder,
  nextPosition,
  ownSession,
  ownSubject,
  placeAt,
  renumber,
  sessionSiblings,
} from "../services/tree.ts";
import { idParam } from "./subjects.ts";

const { studySessions } = schema;

async function detail(tx: Tx, s: typeof studySessions.$inferSelect): Promise<SessionDetail> {
  const res = await tx.execute<{ type: "subject" | "folder"; id: string; title: string }>(sql`
    with recursive chain as (
      select f.id, f.parent_id, f.title, 0 as depth from folders f where f.id = ${s.folderId}
      union all
      select p.id, p.parent_id, p.title, chain.depth + 1 from folders p join chain on p.id = chain.parent_id
    )
    select 'subject' as type, id, title, 1000000 as depth from subjects where id = ${s.subjectId}
    union all
    select 'folder' as type, id, title, depth from chain
    order by depth desc`);
  return {
    id: s.id,
    subjectId: s.subjectId,
    folderId: s.folderId,
    title: s.title,
    position: s.position,
    recordingLimitMin: s.recordingLimitMin,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    breadcrumb: res.rows.map(({ type, id, title }) => ({ type, id, title })),
  };
}

export async function sessionRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.post("/sessions", async (request, reply) => {
    const user = currentUser(request);
    const input = createSessionSchema.parse(request.body);
    const folderId = input.folderId ?? null;
    const out = await db.transaction(async (tx) => {
      await ownSubject(tx, user.id, input.subjectId);
      if (folderId) await destinationFolder(tx, user.id, input.subjectId, folderId);
      const position = await nextPosition(tx, studySessions, sessionSiblings(input.subjectId, folderId));
      const [row] = await tx
        .insert(studySessions)
        .values({
          subjectId: input.subjectId,
          folderId,
          title: input.title,
          position,
          recordingLimitMin: input.recordingLimitMin ?? limits.recordingDefaultMinutes,
        })
        .returning();
      return detail(tx, row!);
    });
    reply.status(201);
    return out;
  });

  app.get("/sessions/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const session = await ownSession(db, user.id, id);
    return detail(db, session);
  });

  /** Rename, change the recording limit, move to another folder and/or reorder. */
  app.patch("/sessions/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = updateSessionSchema.parse(request.body);
    return db.transaction(async (tx) => {
      const session = await ownSession(tx, user.id, id);
      const moving = input.folderId !== undefined && input.folderId !== session.folderId;
      const folderId = input.folderId !== undefined ? input.folderId : session.folderId;
      if (moving && folderId) await destinationFolder(tx, user.id, session.subjectId, folderId);

      const set: Partial<typeof studySessions.$inferInsert> = {};
      if (input.title !== undefined) set.title = input.title;
      if (input.recordingLimitMin !== undefined) set.recordingLimitMin = input.recordingLimitMin;
      if (moving) {
        set.folderId = folderId;
        set.position = await nextPosition(tx, studySessions, sessionSiblings(session.subjectId, folderId));
      }
      if (Object.keys(set).length) await tx.update(studySessions).set(set).where(eq(studySessions.id, id));
      if (input.position !== undefined) {
        await placeAt(tx, studySessions, sessionSiblings(session.subjectId, folderId), id, input.position);
      }
      if (moving) await renumber(tx, studySessions, sessionSiblings(session.subjectId, session.folderId));
      const [updated] = await tx.select().from(studySessions).where(eq(studySessions.id, id));
      return detail(tx, updated!);
    });
  });

  app.delete("/sessions/:id", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await db.transaction(async (tx) => {
      await ownSession(tx, user.id, id);
      await softDelete(tx, "session", id);
    });
    return reply.status(204).send();
  });
}
