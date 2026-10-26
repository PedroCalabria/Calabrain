import {
  checkUpload,
  limits,
  partsRequestSchema,
  resolveContentType,
  startUploadSchema,
  type UploadStarted,
  type UploadState,
} from "@calabrain/shared";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentUser, requireUser } from "../auth/session.ts";
import { db, schema, type Tx } from "../db/client.ts";
import { HttpError, notFound } from "../lib/errors.ts";
import { storage } from "../lib/storage.ts";
import { idParam } from "./subjects.ts";

const { uploads } = schema;
const DAY = 24 * 60 * 60 * 1000;

const extension = (filename: string) => {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return /^[a-z0-9]{1,8}$/.test(ext) ? `.${ext}` : "";
};

export async function ownUpload(tx: Tx, userId: string, id: string) {
  const [row] = await tx.select().from(uploads).where(and(eq(uploads.id, id), eq(uploads.userId, userId)));
  if (!row) throw notFound("Upload");
  return row;
}

/** A finished upload of this user, not yet taken by anything, of the expected kind. */
export async function usableUpload(tx: Tx, userId: string, id: string, kind: (typeof uploads.$inferSelect)["kind"]) {
  const upload = await ownUpload(tx, userId, id);
  if (upload.kind !== kind) throw new HttpError(400, "wrong_upload", "This upload is for something else.");
  if (upload.status !== "completed") throw new HttpError(409, "upload_incomplete", "The upload hasn't finished yet.");
  if (upload.usedAt) throw new HttpError(409, "upload_used", "This upload was already used.");
  await tx.update(uploads).set({ usedAt: new Date() }).where(eq(uploads.id, id));
  return upload;
}

export async function uploadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  /** Starts a multipart upload straight to storage. */
  app.post("/uploads", async (request, reply): Promise<UploadStarted> => {
    const user = currentUser(request);
    const input = startUploadSchema.parse(request.body);
    const problem = checkUpload(input.kind, input.filename, input.contentType ?? "", input.sizeBytes);
    if (problem) throw new HttpError(400, "invalid_file", problem, { file: problem });

    const id = crypto.randomUUID();
    const contentType = resolveContentType(input.filename, input.contentType);
    const storageKey = `u/${user.id}/${id}${extension(input.filename)}`;
    const uploadId = await storage.createMultipart(storageKey, contentType);
    await db.insert(uploads).values({
      id,
      userId: user.id,
      storageKey,
      r2UploadId: uploadId,
      kind: input.kind,
      filename: input.filename,
      contentType,
      sizeBytes: input.sizeBytes,
      expiresAt: new Date(Date.now() + DAY),
    });
    reply.status(201);
    return { id, partSize: limits.uploadPartBytes, partCount: Math.ceil(input.sizeBytes / limits.uploadPartBytes) };
  });

  /** Presigned URLs for some parts (the client asks in batches). */
  app.post("/uploads/:id/parts", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const { partNumbers } = partsRequestSchema.parse(request.body);
    const upload = await ownUpload(db, user.id, id);
    if (upload.status !== "pending" || !upload.r2UploadId) throw new HttpError(409, "upload_closed", "This upload is closed.");
    const max = Math.ceil(upload.sizeBytes / limits.uploadPartBytes);
    if (partNumbers.some((n) => n > max)) throw new HttpError(400, "invalid_part", "Part number out of range.");
    return { parts: await storage.presignParts(upload.storageKey, upload.r2UploadId, partNumbers) };
  });

  /** What the bucket already has, so an interrupted upload resends only missing parts. */
  app.get("/uploads/:id", async (request): Promise<UploadState> => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const upload = await ownUpload(db, user.id, id);
    const uploadedParts =
      upload.status === "pending" && upload.r2UploadId
        ? (await storage.listParts(upload.storageKey, upload.r2UploadId)).map((p) => p.PartNumber!).sort((a, b) => a - b)
        : [];
    return { id, status: upload.status, uploadedParts };
  });

  app.post("/uploads/:id/complete", async (request): Promise<UploadState> => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const upload = await ownUpload(db, user.id, id);
    if (upload.status === "completed") return { id, status: "completed", uploadedParts: [] };
    if (upload.status !== "pending" || !upload.r2UploadId) throw new HttpError(409, "upload_closed", "This upload is closed.");

    const expected = Math.ceil(upload.sizeBytes / limits.uploadPartBytes);
    const parts = await storage.listParts(upload.storageKey, upload.r2UploadId);
    if (parts.length !== expected) {
      throw new HttpError(409, "upload_incomplete", `Only ${parts.length} of ${expected} parts arrived. Send the rest and try again.`);
    }
    const { size } = await storage.completeMultipart(upload.storageKey, upload.r2UploadId);
    if (size !== upload.sizeBytes) {
      await storage.deleteMany([upload.storageKey]);
      await db.update(uploads).set({ status: "aborted" }).where(eq(uploads.id, id));
      throw new HttpError(400, "size_mismatch", "The file that arrived doesn't match the one you chose. Upload it again.");
    }
    await db.update(uploads).set({ status: "completed" }).where(eq(uploads.id, id));
    return { id, status: "completed", uploadedParts: [] };
  });

  app.delete("/uploads/:id", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const upload = await ownUpload(db, user.id, id);
    if (upload.status === "pending" && upload.r2UploadId) await storage.abortMultipart(upload.storageKey, upload.r2UploadId);
    if (upload.status === "completed" && !upload.usedAt) await storage.deleteMany([upload.storageKey]);
    if (!upload.usedAt) await db.update(uploads).set({ status: "aborted" }).where(eq(uploads.id, id));
    return reply.status(204).send();
  });
}
