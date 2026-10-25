import {
  createDocumentSchema,
  jobs,
  limits,
  splitSchema,
  type DocumentDetail,
  type DocumentPage,
} from "@calabrain/shared";
import { softDelete } from "@calabrain/db/trash";
import { and, asc, between, eq, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/session.ts";
import { db, schema, type Tx } from "../db/client.ts";
import { HttpError, notFound } from "../lib/errors.ts";
import { enqueue } from "../lib/queue.ts";
import { storage } from "../lib/storage.ts";
import { destinationFolder, nextPosition, ownSession, ownSubject, sessionSiblings } from "../services/tree.ts";
import { idParam } from "./subjects.ts";
import { usableUpload } from "./uploads.ts";

const { sourceDocuments, documentPages, documentOutline, studySessions, subjects } = schema;

export async function ownDocument(tx: Tx, userId: string, id: string) {
  const [row] = await tx
    .select({ doc: sourceDocuments })
    .from(sourceDocuments)
    .innerJoin(subjects, eq(subjects.id, sourceDocuments.subjectId))
    .where(
      and(
        eq(sourceDocuments.id, id),
        eq(sourceDocuments.userId, userId),
        isNull(sourceDocuments.deletedAt),
        isNull(subjects.deletedAt),
      ),
    );
  if (!row) throw notFound("Document");
  return row.doc;
}

async function detail(tx: Tx, d: typeof sourceDocuments.$inferSelect): Promise<DocumentDetail> {
  const outline = await tx
    .select({
      title: documentOutline.title,
      level: documentOutline.level,
      startPage: documentOutline.startPage,
      endPage: documentOutline.endPage,
    })
    .from(documentOutline)
    .where(eq(documentOutline.documentId, d.id))
    .orderBy(asc(documentOutline.position));
  return {
    id: d.id,
    subjectId: d.subjectId,
    folderId: d.folderId,
    sessionId: d.sessionId,
    title: d.title,
    sizeBytes: d.sizeBytes,
    pageCount: d.pageCount,
    status: d.status,
    failureReason: d.failureReason,
    parentDocumentId: d.parentDocumentId,
    pageStart: d.pageStart,
    pageEnd: d.pageEnd,
    createdAt: d.createdAt.toISOString(),
    outline,
  };
}

const titleFrom = (filename: string) => filename.replace(/\.[^.]+$/, "").trim() || filename;
const pagesQuery = z.object({ from: z.coerce.number().int().min(1).default(1), to: z.coerce.number().int().min(1).optional() });

export async function documentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /** Attach an uploaded PDF to a subject, folder or session (RF04); processing starts in the worker. */
  app.post("/documents", async (request, reply) => {
    const user = currentUser(request);
    const input = createDocumentSchema.parse(request.body);
    const doc = await db.transaction(async (tx) => {
      await ownSubject(tx, user.id, input.subjectId);
      let folderId: string | null = null;
      let sessionId: string | null = null;
      if (input.sessionId) {
        const session = await ownSession(tx, user.id, input.sessionId);
        if (session.subjectId !== input.subjectId) throw new HttpError(400, "different_subject", "That session is in another subject.");
        sessionId = session.id;
      } else if (input.folderId) {
        folderId = (await destinationFolder(tx, user.id, input.subjectId, input.folderId)).id;
      }
      const upload = await usableUpload(tx, user.id, input.uploadId, "source_document");
      const [row] = await tx
        .insert(sourceDocuments)
        .values({
          userId: user.id,
          subjectId: input.subjectId,
          folderId,
          sessionId,
          title: input.title ?? titleFrom(upload.filename),
          storageKey: upload.storageKey,
          sha256: "",
          sizeBytes: upload.sizeBytes,
        })
        .returning();
      return row!;
    });
    await enqueue(jobs.processDocument, { documentId: doc.id });
    reply.status(201);
    return detail(db, doc);
  });

  app.get("/documents/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    return detail(db, await ownDocument(db, user.id, id));
  });

  app.patch("/documents/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const { title } = z.object({ title: z.string().trim().min(1, { message: "Give the document a name." }).max(200) }).parse(request.body);
    await ownDocument(db, user.id, id);
    const [row] = await db.update(sourceDocuments).set({ title }).where(eq(sourceDocuments.id, id)).returning();
    return detail(db, row!);
  });

  /** Extracted text, by page (RF05). */
  app.get("/documents/:id/pages", async (request): Promise<{ pages: DocumentPage[] }> => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const q = pagesQuery.parse(request.query);
    const doc = await ownDocument(db, user.id, id);
    const to = Math.min(q.to ?? q.from + 49, q.from + 199);
    const pages = await db
      .select({ pageNumber: documentPages.pageNumber, text: documentPages.text })
      .from(documentPages)
      .where(and(eq(documentPages.documentId, doc.id), between(documentPages.pageNumber, q.from, to)))
      .orderBy(asc(documentPages.pageNumber));
    return { pages };
  });

  /** Short-lived read URL for the viewer (RF06). */
  app.get("/documents/:id/file", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const doc = await ownDocument(db, user.id, id);
    if (doc.status !== "ready") throw new HttpError(409, "not_ready", "This document is still being processed.");
    // 15 minutes: the viewer reads large PDFs in ranges while you page through.
    const url = await storage.presignGet(doc.storageKey, 900, { filename: `${doc.title}.pdf`, contentType: "application/pdf" });
    return { url, expiresIn: 900 };
  });

  /** Split a book into chapter documents, each in a new session (RF08). */
  app.post("/documents/:id/split", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = splitSchema.parse(request.body);
    const created = await db.transaction(async (tx) => {
      const book = await ownDocument(tx, user.id, id);
      if (book.status !== "ready" || !book.pageCount) {
        throw new HttpError(409, "not_ready", "Wait until the book finishes processing, then split it.");
      }
      const bad = input.chapters.findIndex((c) => c.pageEnd > book.pageCount!);
      if (bad >= 0) {
        throw new HttpError(400, "invalid_range", `“${input.chapters[bad]!.title}” ends after the last page (${book.pageCount}).`, {
          [`chapters.${bad}.pageEnd`]: `The book has ${book.pageCount} pages.`,
        });
      }
      if (input.folderId) await destinationFolder(tx, user.id, book.subjectId, input.folderId);

      const out: { sessionId: string; documentId: string }[] = [];
      for (const chapter of input.chapters) {
        const position = await nextPosition(tx, studySessions, sessionSiblings(book.subjectId, input.folderId));
        const [session] = await tx
          .insert(studySessions)
          .values({
            subjectId: book.subjectId,
            folderId: input.folderId,
            title: chapter.title,
            position,
            recordingLimitMin: limits.recordingDefaultMinutes,
          })
          .returning();
        const [child] = await tx
          .insert(sourceDocuments)
          .values({
            userId: user.id,
            subjectId: book.subjectId,
            sessionId: session!.id,
            title: `${book.title} · ${chapter.title}`,
            // Replaced by the worker once the chapter file exists.
            storageKey: book.storageKey,
            sha256: "",
            sizeBytes: 0,
            parentDocumentId: book.id,
            pageStart: chapter.pageStart,
            pageEnd: chapter.pageEnd,
          })
          .returning();
        out.push({ sessionId: session!.id, documentId: child!.id });
      }
      return out;
    });
    for (const c of created) await enqueue(jobs.splitDocument, { documentId: c.documentId });
    reply.status(201);
    return { created };
  });

  app.delete("/documents/:id", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await db.transaction(async (tx) => {
      await ownDocument(tx, user.id, id);
      await softDelete(tx, "document", id);
    });
    return reply.status(204).send();
  });
}
