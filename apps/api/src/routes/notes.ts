import {
  createNoteSchema,
  createVersionSchema,
  emptyDoc,
  jobs,
  saveDraftSchema,
  updateNoteSchema,
  type DocNode,
  type NoteDetail,
  type NoteSummary,
  type NoteVersionDetail,
  type NoteVersionInfo,
} from "@calabrain/shared";
import { createVersion, currentVersionNumber } from "@calabrain/db/notes";
import { softDelete } from "@calabrain/db/trash";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/session.ts";
import { db, schema, type Tx } from "../db/client.ts";
import { HttpError, notFound } from "../lib/errors.ts";
import { enqueue } from "../lib/queue.ts";
import { nextPosition, ownSession, placeAt } from "../services/tree.ts";
import { idParam } from "./subjects.ts";
import { usableUpload } from "./uploads.ts";

const { notes, noteVersions, studySessions, subjects } = schema;

export async function ownNote(tx: Tx, userId: string, id: string) {
  const [row] = await tx
    .select({ note: notes })
    .from(notes)
    .innerJoin(studySessions, eq(studySessions.id, notes.sessionId))
    .innerJoin(subjects, eq(subjects.id, studySessions.subjectId))
    .where(
      and(
        eq(notes.id, id),
        eq(subjects.userId, userId),
        isNull(notes.deletedAt),
        isNull(studySessions.deletedAt),
        isNull(subjects.deletedAt),
      ),
    );
  if (!row) throw notFound("Note");
  return row.note;
}

const versionNumber = sql<number>`coalesce((select max(v.version) from note_versions v where v.note_id = "notes"."id"), 0)`;

function summary(n: typeof notes.$inferSelect, version: number): NoteSummary {
  return {
    id: n.id,
    sessionId: n.sessionId,
    title: n.title,
    position: n.position,
    status: n.status,
    failureReason: n.failureReason,
    version,
    updatedAt: (n.draftUpdatedAt ?? n.updatedAt).toISOString(),
  };
}

async function detail(tx: Tx, n: typeof notes.$inferSelect): Promise<NoteDetail> {
  const version = await currentVersionNumber(tx, n.id);
  let content: DocNode = emptyDoc();
  if (n.draftJson) content = n.draftJson as DocNode;
  else if (n.currentVersionId) {
    const [v] = await tx.select({ c: noteVersions.contentJson }).from(noteVersions).where(eq(noteVersions.id, n.currentVersionId));
    if (v) content = v.c as DocNode;
  }
  return {
    ...summary(n, version),
    content,
    hasUnversionedDraft: !!n.draftJson,
    draftUpdatedAt: n.draftUpdatedAt?.toISOString() ?? null,
  };
}

const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);
const versionParams = z.object({ id: z.uuid(), v: z.coerce.number().int().min(1) });

function conflict(current: number): HttpError {
  return new HttpError(
    409,
    "version_conflict",
    `This note was saved in another tab or device (version ${current}). Reload it, or save yours as a new version.`,
  );
}

export async function noteRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /** Recent notes across all subjects (the Notes page). */
  app.get("/notes", async (request): Promise<NoteSummary[]> => {
    const user = currentUser(request);
    const rows = await db
      .select({ note: notes, version: versionNumber, sessionTitle: studySessions.title, subjectId: subjects.id, subjectTitle: subjects.title })
      .from(notes)
      .innerJoin(studySessions, eq(studySessions.id, notes.sessionId))
      .innerJoin(subjects, eq(subjects.id, studySessions.subjectId))
      .where(and(eq(subjects.userId, user.id), isNull(notes.deletedAt), isNull(studySessions.deletedAt), isNull(subjects.deletedAt)))
      .orderBy(desc(sql`coalesce(${notes.draftUpdatedAt}, ${notes.updatedAt})`))
      .limit(100);
    return rows.map((r) => ({ ...summary(r.note, r.version), sessionTitle: r.sessionTitle, subjectId: r.subjectId, subjectTitle: r.subjectTitle }));
  });

  app.get("/sessions/:id/notes", async (request): Promise<NoteSummary[]> => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await ownSession(db, user.id, id);
    const rows = await db
      .select({ note: notes, version: versionNumber })
      .from(notes)
      .where(and(eq(notes.sessionId, id), isNull(notes.deletedAt)))
      .orderBy(asc(notes.position), asc(notes.createdAt));
    return rows.map((r) => summary(r.note, r.version));
  });

  /** A blank note, or an import of a .txt, .md, .docx or PDF file (RF09, RF11). */
  app.post("/sessions/:id/notes", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = createNoteSchema.parse(request.body ?? {});
    const note = await db.transaction(async (tx) => {
      await ownSession(tx, user.id, id);
      const position = await nextPosition(tx, notes, eq(notes.sessionId, id));
      if (input.uploadId) {
        const upload = await usableUpload(tx, user.id, input.uploadId, "note_import");
        const [row] = await tx
          .insert(notes)
          .values({
            sessionId: id,
            title: input.title ?? (upload.filename.replace(/\.[^.]+$/, "").trim() || "Imported note"),
            position,
            status: "processing",
          })
          .returning();
        return { row: row!, uploadId: upload.id };
      }
      const [row] = await tx.insert(notes).values({ sessionId: id, title: input.title ?? "Untitled note", position }).returning();
      await createVersion(tx, row!.id, emptyDoc(), "editor");
      return { row: row!, uploadId: null };
    });
    if (note.uploadId) await enqueue(jobs.importNote, { noteId: note.row.id, uploadId: note.uploadId });
    reply.status(201);
    const [fresh] = await db.select().from(notes).where(eq(notes.id, note.row.id));
    return detail(db, fresh!);
  });

  app.get("/notes/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    return detail(db, await ownNote(db, user.id, id));
  });

  app.patch("/notes/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = updateNoteSchema.parse(request.body);
    const note = await ownNote(db, user.id, id);
    await db.transaction(async (tx) => {
      if (input.title !== undefined) await tx.update(notes).set({ title: input.title }).where(eq(notes.id, id));
      if (input.position !== undefined) await placeAt(tx, notes, eq(notes.sessionId, note.sessionId), id, input.position);
    });
    const [fresh] = await db.select().from(notes).where(eq(notes.id, id));
    return detail(db, fresh!);
  });

  app.delete("/notes/:id", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await db.transaction(async (tx) => {
      await ownNote(tx, user.id, id);
      await softDelete(tx, "note", id);
    });
    return reply.status(204).send();
  });

  /** Autosave (RF10). Refused with 409 when another tab created a version since the editor loaded. */
  app.put("/notes/:id/draft", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = saveDraftSchema.parse(request.body);
    return db.transaction(async (tx) => {
      const note = await ownNote(tx, user.id, id);
      if (note.status === "processing") throw new HttpError(409, "importing", "This note is still being imported.");
      await tx.execute(sql`select id from notes where id = ${id} for update`);
      const current = await currentVersionNumber(tx, id);
      if (input.baseVersion !== current) throw conflict(current);
      const now = new Date();
      await tx.update(notes).set({ draftJson: input.content, draftUpdatedAt: now }).where(eq(notes.id, id));
      return { savedAt: now.toISOString(), version: current };
    });
  });

  /** Turns the draft (or the given content) into a new immutable version. */
  app.post("/notes/:id/versions", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = createVersionSchema.parse(request.body);
    const out = await db.transaction(async (tx) => {
      const note = await ownNote(tx, user.id, id);
      await tx.execute(sql`select id from notes where id = ${id} for update`);
      const current = await currentVersionNumber(tx, id);
      if (input.baseVersion !== current && !input.force) throw conflict(current);
      const content = input.content ?? (note.draftJson as DocNode | null);
      if (!content) return { version: current, created: false };
      const version = await createVersion(tx, id, content, "editor");
      return { version, created: true };
    });
    reply.status(out.created ? 201 : 200);
    return out;
  });

  app.get("/notes/:id/versions", async (request): Promise<NoteVersionInfo[]> => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await ownNote(db, user.id, id);
    const rows = await db
      .select({ version: noteVersions.version, source: noteVersions.source, createdAt: noteVersions.createdAt, text: noteVersions.contentText })
      .from(noteVersions)
      .where(eq(noteVersions.noteId, id))
      .orderBy(desc(noteVersions.version));
    return rows.map((r) => ({ version: r.version, source: r.source, createdAt: r.createdAt.toISOString(), words: words(r.text) }));
  });

  app.get("/notes/:id/versions/:v", async (request): Promise<NoteVersionDetail> => {
    const user = currentUser(request);
    const { id, v } = versionParams.parse(request.params);
    await ownNote(db, user.id, id);
    const [row] = await db
      .select()
      .from(noteVersions)
      .where(and(eq(noteVersions.noteId, id), eq(noteVersions.version, v)));
    if (!row) throw notFound("Version");
    return {
      version: row.version,
      source: row.source,
      createdAt: row.createdAt.toISOString(),
      words: words(row.contentText),
      content: row.contentJson as DocNode,
      text: row.contentText,
    };
  });

  /** Restoring creates a new version with the old content; nothing is overwritten. */
  app.post("/notes/:id/versions/:v/restore", async (request, reply) => {
    const user = currentUser(request);
    const { id, v } = versionParams.parse(request.params);
    const version = await db.transaction(async (tx) => {
      await ownNote(tx, user.id, id);
      const [row] = await tx
        .select({ c: noteVersions.contentJson })
        .from(noteVersions)
        .where(and(eq(noteVersions.noteId, id), eq(noteVersions.version, v)));
      if (!row) throw notFound("Version");
      return createVersion(tx, id, row.c as DocNode, "restore");
    });
    reply.status(201);
    return { version };
  });
}
