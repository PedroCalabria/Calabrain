import { limits, trashTypes, type TrashItem } from "@calabrain/shared";
import { purge, restore, trashRoots, trashState, type TrashKind } from "@calabrain/db/trash";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { currentUser, requireUser } from "../auth/session.ts";
import { db, type Tx } from "../db/client.ts";
import { HttpError, notFound } from "../lib/errors.ts";
import { deleteStorageObjects } from "../services/storage-cleanup.ts";

const itemParams = z.object({ type: z.enum(trashTypes), id: z.uuid() });
const DAY = 24 * 60 * 60 * 1000;

const parentLabel: Record<TrashKind, string> = {
  subject: "",
  folder: "the folder or subject it was in",
  session: "the folder or subject it was in",
  document: "the session, folder or subject it was in",
  note: "its session",
  attempt: "its session",
};

/** A trashed item of this user, as one of their trash entries (not a row deleted along with its parent). */
async function ownTrashed(tx: Tx, userId: string, type: TrashKind, id: string) {
  const roots = await trashRoots(tx, { userId });
  const root = roots.find((r) => r.type === type && r.id === id);
  if (!root) throw notFound("Item");
  return root;
}

export async function trashRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.get("/trash", async (request): Promise<TrashItem[]> => {
    const user = currentUser(request);
    const rows = await trashRoots(db, { userId: user.id });
    return rows.map((r) => ({
      type: r.type,
      id: r.id,
      title: r.title,
      location: r.location || null,
      deletedAt: r.deleted_at.toISOString(),
      purgeAt: new Date(r.deleted_at.getTime() + limits.trashRetentionDays * DAY).toISOString(),
    }));
  });

  app.post("/trash/:type/:id/restore", async (request, reply) => {
    const user = currentUser(request);
    const { type, id } = itemParams.parse(request.params);
    await db.transaction(async (tx) => {
      const root = await ownTrashed(tx, user.id, type, id);
      const state = await trashState(tx, type, id);
      if (state?.parentDeletedAt) {
        throw new HttpError(409, "parent_in_trash", `Restore ${parentLabel[type]} first; it's in the trash too.`);
      }
      await restore(tx, type, id, root.deleted_at);
    });
    return reply.status(204).send();
  });

  /** Erase now, before the 30 days run out. */
  app.delete("/trash/:type/:id", async (request, reply) => {
    const user = currentUser(request);
    const { type, id } = itemParams.parse(request.params);
    const keys = await db.transaction(async (tx) => {
      await ownTrashed(tx, user.id, type, id);
      return purge(tx, type, id);
    });
    await deleteStorageObjects(keys, request.log);
    return reply.status(204).send();
  });
}
