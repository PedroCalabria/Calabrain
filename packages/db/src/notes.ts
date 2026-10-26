/** Note versions (RF10): immutable rows; the note points at its newest one. */
import { docToText, type DocNode } from "@calabrain/shared";
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { Db, Tx } from "./index.ts";
import { notes, noteVersions } from "./schema.ts";

export async function currentVersionNumber(tx: Tx, noteId: string): Promise<number> {
  const res = await tx
    .select({ v: sql<number | null>`max(${noteVersions.version})` })
    .from(noteVersions)
    .where(eq(noteVersions.noteId, noteId));
  return Number(res[0]?.v ?? 0);
}

/** Appends a version with this content and makes it current. Returns its number. */
export async function createVersion(
  tx: Tx,
  noteId: string,
  content: DocNode,
  source: "editor" | "import" | "restore",
): Promise<number> {
  // Serialize version numbering per note.
  await tx.execute(sql`select id from notes where id = ${noteId} for update`);
  const version = (await currentVersionNumber(tx, noteId)) + 1;
  const [row] = await tx
    .insert(noteVersions)
    .values({ noteId, version, contentJson: content, contentText: docToText(content), source })
    .returning({ id: noteVersions.id });
  await tx
    .update(notes)
    .set({ currentVersionId: row!.id, draftJson: null, draftUpdatedAt: null })
    .where(eq(notes.id, noteId));
  return version;
}

/**
 * Turns drafts idle for longer than `idleMinutes` into versions (the safety net for tabs closed
 * without the browser saving). Returns how many notes got a version.
 */
export async function commitIdleDrafts(db: Db, idleMinutes: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - idleMinutes * 60 * 1000);
  const idle = await db
    .select({ id: notes.id, draft: notes.draftJson })
    .from(notes)
    .where(and(isNotNull(notes.draftJson), lt(notes.draftUpdatedAt, cutoff), isNull(notes.deletedAt)))
    .orderBy(desc(notes.draftUpdatedAt))
    .limit(500);
  let n = 0;
  for (const note of idle) {
    await db.transaction(async (tx) => {
      const [fresh] = await tx.select({ draft: notes.draftJson, at: notes.draftUpdatedAt }).from(notes).where(eq(notes.id, note.id));
      if (!fresh?.draft || !fresh.at || fresh.at >= cutoff) return;
      await createVersion(tx, note.id, fresh.draft as DocNode, "editor");
      n++;
    });
  }
  return n;
}
