/** Ownership checks and ordering helpers for the Subject → Folder → Session tree. */
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db, schema, type Tx } from "../db/client.ts";
import { HttpError, notFound } from "../lib/errors.ts";

const { subjects, folders, studySessions } = schema;

export async function ownSubject(tx: Tx, userId: string, id: string) {
  const [row] = await tx
    .select()
    .from(subjects)
    .where(and(eq(subjects.id, id), eq(subjects.userId, userId), isNull(subjects.deletedAt)));
  if (!row) throw notFound("Subject");
  return row;
}

export async function ownFolder(tx: Tx, userId: string, id: string) {
  const [row] = await tx
    .select({ folder: folders })
    .from(folders)
    .innerJoin(subjects, eq(subjects.id, folders.subjectId))
    .where(and(eq(folders.id, id), eq(subjects.userId, userId), isNull(folders.deletedAt), isNull(subjects.deletedAt)));
  if (!row) throw notFound("Folder");
  return row.folder;
}

export async function ownSession(tx: Tx, userId: string, id: string) {
  const [row] = await tx
    .select({ session: studySessions })
    .from(studySessions)
    .innerJoin(subjects, eq(subjects.id, studySessions.subjectId))
    .where(
      and(eq(studySessions.id, id), eq(subjects.userId, userId), isNull(studySessions.deletedAt), isNull(subjects.deletedAt)),
    );
  if (!row) throw notFound("Session");
  return row.session;
}

/** A folder used as a destination: must be live and in the same subject. */
export async function destinationFolder(tx: Tx, userId: string, subjectId: string, folderId: string) {
  const folder = await ownFolder(tx, userId, folderId);
  if (folder.subjectId !== subjectId) {
    throw new HttpError(400, "different_subject", "Items can only move inside their own subject.");
  }
  return folder;
}

/** True when `candidate` is `folderId` itself or sits anywhere under it. */
export async function isSelfOrDescendant(tx: Tx, folderId: string, candidate: string): Promise<boolean> {
  const res = await tx.execute<{ found: boolean }>(sql`
    with recursive tree as (
      select id from folders where id = ${folderId}
      union all
      select f.id from folders f join tree on f.parent_id = tree.id
    ) select exists (select 1 from tree where id = ${candidate}) as found`);
  return !!res.rows[0]?.found;
}

type Positioned = PgTable & { id: PgColumn; position: PgColumn; createdAt: PgColumn; deletedAt: PgColumn };

/** Next position at the end of a sibling list. */
export async function nextPosition(tx: Tx, table: Positioned, siblings: SQL): Promise<number> {
  const res = await tx
    .select({ max: sql<number | null>`max(${table.position})` })
    .from(table)
    .where(and(siblings, isNull(table.deletedAt)));
  const max = res[0]?.max;
  return max === null || max === undefined ? 0 : Number(max) + 1;
}

/** Puts `id` at `index` among its siblings and renumbers them 0..n-1. */
export async function placeAt(tx: Tx, table: Positioned, siblings: SQL, id: string, index: number) {
  const rows = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(siblings, isNull(table.deletedAt)))
    .orderBy(asc(table.position), asc(table.createdAt));
  const order = rows.map((r) => r.id as string).filter((x) => x !== id);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  await writeOrder(tx, table, order);
}

/** Renumbers a sibling list 0..n-1 keeping its order (after an item left it). */
export async function renumber(tx: Tx, table: Positioned, siblings: SQL) {
  const rows = await tx
    .select({ id: table.id })
    .from(table)
    .where(and(siblings, isNull(table.deletedAt)))
    .orderBy(asc(table.position), asc(table.createdAt));
  await writeOrder(tx, table, rows.map((r) => r.id as string));
}

async function writeOrder(tx: Tx, table: Positioned, order: string[]) {
  for (const [i, rowId] of order.entries()) {
    await tx.update(table).set({ position: i } as never).where(eq(table.id, rowId));
  }
}

export const folderSiblings = (subjectId: string, parentId: string | null) =>
  and(eq(folders.subjectId, subjectId), parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId))!;

export const sessionSiblings = (subjectId: string, folderId: string | null) =>
  and(
    eq(studySessions.subjectId, subjectId),
    folderId ? eq(studySessions.folderId, folderId) : isNull(studySessions.folderId),
  )!;

export const subjectSiblings = (userId: string) => eq(subjects.userId, userId);

export { db };
