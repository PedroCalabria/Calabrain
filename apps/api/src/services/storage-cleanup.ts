import type { FastifyBaseLogger } from "fastify";
import { storage } from "../lib/storage.ts";

/** Deletes objects from storage after their rows were erased. Failures are logged, not thrown. */
export async function deleteStorageObjects(keys: string[], log: FastifyBaseLogger): Promise<void> {
  if (!keys.length) return;
  try {
    await storage.deleteMany(keys);
  } catch (err) {
    log.error({ err, keys }, "storage cleanup failed");
  }
}
