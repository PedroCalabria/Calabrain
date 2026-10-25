/** Daily cleanup of uploads nobody finished or used: abort the multipart upload or delete the object. */
import { schema } from "@calabrain/db";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Deps } from "./documents.ts";

const { uploads } = schema;

export async function cleanupUploads({ db, storage }: Deps, now = new Date()): Promise<number> {
  const stale = await db
    .select()
    .from(uploads)
    .where(and(lt(uploads.expiresAt, now), isNull(uploads.usedAt), eq(uploads.status, "pending")))
    .limit(1000);
  const unused = await db
    .select()
    .from(uploads)
    .where(and(lt(uploads.expiresAt, now), isNull(uploads.usedAt), eq(uploads.status, "completed")))
    .limit(1000);
  for (const u of stale) {
    if (u.r2UploadId) await storage.abortMultipart(u.storageKey, u.r2UploadId);
    await db.update(uploads).set({ status: "aborted" }).where(eq(uploads.id, u.id));
  }
  if (unused.length) await storage.deleteMany(unused.map((u) => u.storageKey));
  for (const u of unused) await db.update(uploads).set({ status: "aborted" }).where(eq(uploads.id, u.id));
  return stale.length + unused.length;
}
