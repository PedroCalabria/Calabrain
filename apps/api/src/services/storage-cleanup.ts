import type { FastifyBaseLogger } from "fastify";

/**
 * Deletes objects from storage after their rows were erased.
 * Storage arrives with uploads (stage 3); until then there is nothing to delete.
 */
export async function deleteStorageObjects(keys: string[], log: FastifyBaseLogger): Promise<void> {
  if (keys.length) log.warn({ keys }, "storage cleanup not wired yet");
}
