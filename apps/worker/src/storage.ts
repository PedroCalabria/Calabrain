/** Object storage access for the worker. Wired to R2/MinIO in stage 3, with uploads. */
export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length) console.warn("[worker] storage cleanup not wired yet:", keys.length, "key(s)");
}
