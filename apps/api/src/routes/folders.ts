import { createFolderSchema, updateFolderSchema, type FolderNode } from "@calabrain/shared";
import { softDelete } from "@calabrain/db/trash";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { currentUser, requireUser } from "../auth/session.ts";
import { db, schema } from "../db/client.ts";
import { HttpError } from "../lib/errors.ts";
import {
  destinationFolder,
  folderSiblings,
  isSelfOrDescendant,
  nextPosition,
  ownFolder,
  ownSubject,
  placeAt,
  renumber,
} from "../services/tree.ts";
import { idParam } from "./subjects.ts";

const { folders } = schema;

const node = (f: typeof folders.$inferSelect): FolderNode => ({
  id: f.id,
  parentId: f.parentId,
  title: f.title,
  position: f.position,
});

export async function folderRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireUser);

  app.post("/folders", async (request, reply) => {
    const user = currentUser(request);
    const input = createFolderSchema.parse(request.body);
    const parentId = input.parentId ?? null;
    const row = await db.transaction(async (tx) => {
      await ownSubject(tx, user.id, input.subjectId);
      if (parentId) await destinationFolder(tx, user.id, input.subjectId, parentId);
      const position = await nextPosition(tx, folders, folderSiblings(input.subjectId, parentId));
      const [created] = await tx
        .insert(folders)
        .values({ subjectId: input.subjectId, parentId, title: input.title, position })
        .returning();
      return created!;
    });
    reply.status(201);
    return node(row);
  });

  /** Rename, move (parentId) and/or reorder (position). */
  app.patch("/folders/:id", async (request) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    const input = updateFolderSchema.parse(request.body);
    const row = await db.transaction(async (tx) => {
      const folder = await ownFolder(tx, user.id, id);
      const moving = input.parentId !== undefined && input.parentId !== folder.parentId;
      const parentId = input.parentId !== undefined ? input.parentId : folder.parentId;

      if (moving && parentId) {
        await destinationFolder(tx, user.id, folder.subjectId, parentId);
        if (await isSelfOrDescendant(tx, id, parentId)) {
          throw new HttpError(400, "invalid_move", "A folder can't go inside itself or one of its own folders.");
        }
      }

      const set: Partial<typeof folders.$inferInsert> = {};
      if (input.title !== undefined) set.title = input.title;
      if (moving) {
        set.parentId = parentId;
        set.position = await nextPosition(tx, folders, folderSiblings(folder.subjectId, parentId));
      }
      if (Object.keys(set).length) await tx.update(folders).set(set).where(eq(folders.id, id));
      if (input.position !== undefined) {
        await placeAt(tx, folders, folderSiblings(folder.subjectId, parentId), id, input.position);
      }
      if (moving) await renumber(tx, folders, folderSiblings(folder.subjectId, folder.parentId));
      const [updated] = await tx.select().from(folders).where(eq(folders.id, id));
      return updated!;
    });
    return node(row);
  });

  app.delete("/folders/:id", async (request, reply) => {
    const user = currentUser(request);
    const { id } = idParam.parse(request.params);
    await db.transaction(async (tx) => {
      await ownFolder(tx, user.id, id);
      await softDelete(tx, "folder", id);
    });
    return reply.status(204).send();
  });
}
