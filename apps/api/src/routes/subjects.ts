import {
  createSubjectSchema,
  updateSubjectSchema,
  type DocumentNode,
  type FolderNode,
  type SessionNode,
  type SubjectSummary,
  type SubjectTree,
} from "@calabrain/shared";
import { softDelete } from "@calabrain/db/trash";
import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/session.ts";
import { db, schema } from "../db/client.ts";
import { nextPosition, ownSubject, placeAt, subjectSiblings } from "../services/tree.ts";

const { subjects, folders, studySessions, sourceDocuments, notes, attempts } = schema;
export const idParam = z.object({ id: z.uuid() });

const counts = {
  folderCount: sql<number>`(select count(*)::int from folders f where f.subject_id = "subjects"."id" and f.deleted_at is null)`,
  sessionCount: sql<number>`(select count(*)::int from study_sessions s where s.subject_id = "subjects"."id" and s.deleted_at is null)`,
  documentCount: sql<number>`(select count(*)::int from source_documents d where d.subject_id = "subjects"."id" and d.deleted_at is null)`,
};

type SubjectRow = typeof subjects.$inferSelect & { folderCount: number; sessionCount: number; documentCount: number };
const summary = (s: SubjectRow): SubjectSummary => ({
  id: s.id,
  title: s.title,
  description: s.description,
  position: s.position,
  folderCount: s.folderCount,
  sessionCount: s.sessionCount,
  documentCount: s.documentCount,
  createdAt: s.createdAt.toISOString(),
  updatedAt: s.updatedAt.toISOString(),
});

async function loadSummary(userId: string, id: string): Promise<SubjectSummary> {
  const [row] = await db
    .select({ ...getTableColumns(subjects), ...counts })
    .from(subjects)
    .where(and(eq(subjects.id, id), eq(subjects.userId, userId), isNull(subjects.deletedAt)));
  if (!row) throw new Error("subject vanished");
  return summary(row as SubjectRow);
}

export async function subjectRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/subjects", async (request): Promise<SubjectSummary[]> => {
    const user = currentUser(request);
    const rows = await db
      .select({ ...getTableColumns(subjects), ...counts })
      .from(subjects)
      .where(and(eq(subjects.userId, user.id), isNull(subjects.deletedAt)))
      .orderBy(asc(subjects.position), asc(subjects.createdAt));
    return rows.map((r) => summary(r as SubjectRow));
  });

  app.post("/subjects", async (request, reply) => {
    const user = currentUser(request);
    const input = createSubjectSchema.parse(request.body);
    const position = await nextPosition(db, subjects, subjectSiblings(user.id));
    const [row] = await db
      .insert(subjects)
      .values({ userId: user.id, title: input.title, description: input.description || null, position })
      .returning();
    reply.status(201);
    return loadSummary(user.id, row!.id);
  });

  app.get("/subjects/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await ownSubject(db, user.id, id);
    return loadSummary(user.id, id);
  });

  app.patch("/subjects/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = updateSubjectSchema.parse(request.body);
    await db.transaction(async (tx) => {
      await ownSubject(tx, user.id, id);
      const set: Partial<typeof subjects.$inferInsert> = {};
      if (input.title !== undefined) set.title = input.title;
      if (input.description !== undefined) set.description = input.description || null;
      if (Object.keys(set).length) await tx.update(subjects).set(set).where(eq(subjects.id, id));
      if (input.position !== undefined) await placeAt(tx, subjects, subjectSiblings(user.id), id, input.position);
    });
    return loadSummary(user.id, id);
  });

  app.delete("/subjects/:id", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await db.transaction(async (tx) => {
      await ownSubject(tx, user.id, id);
      await softDelete(tx, "subject", id);
    });
    return reply.status(204).send();
  });

  /** Folders, sessions and documents of a subject in one call (live items only). */
  app.get("/subjects/:id/tree", async (request): Promise<SubjectTree> => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await ownSubject(db, user.id, id);

    const [subject, folderRows, sessionRows, documentRows] = await Promise.all([
      loadSummary(user.id, id),
      db
        .select({ id: folders.id, parentId: folders.parentId, title: folders.title, position: folders.position })
        .from(folders)
        .where(and(eq(folders.subjectId, id), isNull(folders.deletedAt)))
        .orderBy(asc(folders.position), asc(folders.createdAt)),
      db
        .select({
          id: studySessions.id,
          folderId: studySessions.folderId,
          title: studySessions.title,
          position: studySessions.position,
          recordingLimitMin: studySessions.recordingLimitMin,
          updatedAt: studySessions.updatedAt,
          noteCount: sql<number>`(select count(*)::int from ${notes} n where n.session_id = "study_sessions"."id" and n.deleted_at is null)`,
          attemptCount: sql<number>`(select count(*)::int from ${attempts} a where a.session_id = "study_sessions"."id" and a.deleted_at is null)`,
          documentCount: sql<number>`(select count(*)::int from ${sourceDocuments} d where d.session_id = "study_sessions"."id" and d.deleted_at is null)`,
          recordedSeconds: sql<number>`(select coalesce(sum(r.duration_s), 0)::int from attempts a join recordings r on r.attempt_id = a.id
            where a.session_id = "study_sessions"."id" and a.deleted_at is null and r.status = 'ready')`,
        })
        .from(studySessions)
        .where(and(eq(studySessions.subjectId, id), isNull(studySessions.deletedAt)))
        .orderBy(asc(studySessions.position), asc(studySessions.createdAt)),
      db
        .select({
          id: sourceDocuments.id,
          folderId: sourceDocuments.folderId,
          sessionId: sourceDocuments.sessionId,
          title: sourceDocuments.title,
          status: sourceDocuments.status,
          failureReason: sourceDocuments.failureReason,
          pageCount: sourceDocuments.pageCount,
          parentDocumentId: sourceDocuments.parentDocumentId,
        })
        .from(sourceDocuments)
        .where(and(eq(sourceDocuments.subjectId, id), isNull(sourceDocuments.deletedAt)))
        .orderBy(asc(sourceDocuments.createdAt)),
    ]);

    return {
      subject,
      folders: folderRows satisfies FolderNode[],
      sessions: sessionRows.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() })) satisfies SessionNode[],
      documents: documentRows satisfies DocumentNode[],
    };
  });
}
