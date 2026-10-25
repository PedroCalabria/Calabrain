import { createStorage, storageConfigFromEnv } from "@calabrain/storage";

export const storage = createStorage(storageConfigFromEnv());

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length) await storage.deleteMany(keys);
}
