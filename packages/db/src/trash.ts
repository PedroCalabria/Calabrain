/**
 * Trash (RF03): deleting marks deleted_at on the item and everything under it with ONE timestamp.
 * Restoring clears exactly the rows that carry that timestamp, so items deleted earlier on their
 * own stay in the trash as separate entries. A daily job erases what passed the retention window.
 */
import { sql, type SQL } from "drizzle-orm";
import type { Tx } from "./index.ts";

export type TrashKind = "subject" | "folder" | "session" | "document" | "note" | "attempt";

const tables: Record<TrashKind, string> = {
  subject: "subjects",
  folder: "folders",
  session: "study_sessions",
  document: "source_documents",
  note: "notes",
  attempt: "attempts",
};

interface Subtree {
  subjects: string[];
  folders: string[];
  sessions: string[];
  documents: string[];
  notes: string[];
  attempts: string[];
}

/** Binds a list as ONE array parameter (drizzle would otherwise spread it into $1, $2...). */
const uuidArray = (ids: string[]) => sql`${sql.param(ids)}::uuid[]`;
const textArray = (list: string[]) => sql`${sql.param(list)}::text[]`;

async function ids(tx: Tx, query: SQL): Promise<string[]> {
  const res = await tx.execute<{ id: string }>(query);
  return res.rows.map((r) => r.id);
}

/** Every row that sits under (and includes) the given item, deleted or not. */
export async function collectSubtree(tx: Tx, kind: TrashKind, id: string): Promise<Subtree> {
  const t: Subtree = { subjects: [], folders: [], sessions: [], documents: [], notes: [], attempts: [] };
  const one = [id];

  if (kind === "subject") {
    t.subjects = one;
    t.folders = await ids(tx, sql`select id from folders where subject_id = ${id}`);
    t.sessions = await ids(tx, sql`select id from study_sessions where subject_id = ${id}`);
    t.documents = await ids(tx, sql`select id from source_documents where subject_id = ${id}`);
  } else if (kind === "folder") {
    t.folders = await ids(
      tx,
      sql`with recursive tree as (
            select id from folders where id = ${id}
            union all
            select f.id from folders f join tree on f.parent_id = tree.id
          ) select id from tree`,
    );
    t.sessions = await ids(tx, sql`select id from study_sessions where folder_id = any(${uuidArray(t.folders)})`);
    t.documents = await ids(
      tx,
      sql`select id from source_documents
          where folder_id = any(${uuidArray(t.folders)}) or session_id = any(${uuidArray(t.sessions)})`,
    );
  } else if (kind === "session") {
    t.sessions = one;
    t.documents = await ids(tx, sql`select id from source_documents where session_id = ${id}`);
  } else if (kind === "document") {
    t.documents = one;
  } else if (kind === "note") {
    t.notes = one;
  } else {
    t.attempts = one;
  }

  if (kind === "subject" || kind === "folder" || kind === "session") {
    const s = uuidArray(t.sessions);
    t.notes = await ids(tx, sql`select id from notes where session_id = any(${s})`);
    t.attempts = await ids(tx, sql`select id from attempts where session_id = any(${s})`);
  }
  return t;
}

const entries = (t: Subtree): [string, string[]][] => [
  ["subjects", t.subjects],
  ["folders", t.folders],
  ["study_sessions", t.sessions],
  ["source_documents", t.documents],
  ["notes", t.notes],
  ["attempts", t.attempts],
];

/** Moves an item and everything under it to the trash. Returns the timestamp used. */
export async function softDelete(tx: Tx, kind: TrashKind, id: string, now = new Date()): Promise<Date> {
  const tree = await collectSubtree(tx, kind, id);
  for (const [table, list] of entries(tree)) {
    if (!list.length) continue;
    await tx.execute(
      sql`update ${sql.identifier(table)} set deleted_at = ${now} where id = any(${uuidArray(list)}) and deleted_at is null`,
    );
  }
  return now;
}

/** The trash state of an item: when it was deleted, and whether its parent is in the trash too. */
export async function trashState(tx: Tx, kind: TrashKind, id: string) {
  const parent: Record<TrashKind, SQL> = {
    subject: sql`null::timestamptz`,
    folder: sql`coalesce((select p.deleted_at from folders p where p.id = x.parent_id), (select s.deleted_at from subjects s where s.id = x.subject_id))`,
    session: sql`coalesce((select f.deleted_at from folders f where f.id = x.folder_id), (select s.deleted_at from subjects s where s.id = x.subject_id))`,
    document: sql`coalesce((select ss.deleted_at from study_sessions ss where ss.id = x.session_id), (select f.deleted_at from folders f where f.id = x.folder_id), (select s.deleted_at from subjects s where s.id = x.subject_id))`,
    note: sql`(select ss.deleted_at from study_sessions ss where ss.id = x.session_id)`,
    attempt: sql`(select ss.deleted_at from study_sessions ss where ss.id = x.session_id)`,
  };
  const res = await tx.execute<{ deleted_at: Date | null; parent_deleted_at: Date | null }>(
    sql`select x.deleted_at, ${parent[kind]} as parent_deleted_at from ${sql.identifier(tables[kind])} x where x.id = ${id}`,
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    parentDeletedAt: row.parent_deleted_at ? new Date(row.parent_deleted_at) : null,
  };
}

/** Brings back an item and what was deleted together with it. The caller checks the parent first. */
export async function restore(tx: Tx, kind: TrashKind, id: string, deletedAt: Date): Promise<void> {
  const tree = await collectSubtree(tx, kind, id);
  for (const [table, list] of entries(tree)) {
    if (!list.length) continue;
    await tx.execute(
      sql`update ${sql.identifier(table)} set deleted_at = null where id = any(${uuidArray(list)}) and deleted_at = ${deletedAt}`,
    );
  }
}

/** Storage objects owned by rows in a subtree (documents, recordings and their derived files). */
async function storageKeys(tx: Tx, tree: Subtree): Promise<string[]> {
  const res = await tx.execute<{ key: string | null }>(sql`
    select storage_key as key from source_documents where id = any(${uuidArray(tree.documents)})
    union all
    select unnest(array[r.storage_key, r.audio_key, r.thumbnail_key]) as key
      from recordings r where r.attempt_id = any(${uuidArray(tree.attempts)})`);
  return [...new Set(res.rows.map((r) => r.key).filter((k): k is string => !!k))];
}

/**
 * Erases an item for good (foreign keys cascade to what is under it).
 * Returns the storage keys that no remaining row references, for the caller to delete from storage.
 */
export async function purge(tx: Tx, kind: TrashKind, id: string): Promise<string[]> {
  const tree = await collectSubtree(tx, kind, id);
  const keys = await storageKeys(tx, tree);
  await tx.execute(sql`delete from ${sql.identifier(tables[kind])} where id = ${id}`);
  return unreferenced(tx, keys);
}

/** Keys from the list that no document or recording points at any more (dedupe shares objects). */
export async function unreferenced(tx: Tx, keys: string[]): Promise<string[]> {
  if (!keys.length) return [];
  const res = await tx.execute<{ key: string }>(sql`
    select k as key from unnest(${textArray(keys)}) as k
    where not exists (select 1 from source_documents d where d.storage_key = k)
      and not exists (select 1 from recordings r where k in (r.storage_key, r.audio_key, r.thumbnail_key))`);
  return res.rows.map((r) => r.key);
}

export type TrashRow = {
  type: TrashKind;
  id: string;
  user_id: string;
  title: string;
  location: string | null;
  deleted_at: Date;
};

/**
 * Trash entries: items deleted on their own, not the rows deleted along with their parent.
 * Pass userId to list one user's trash, or a cutoff to find what is due for purge.
 */
export async function trashRoots(tx: Tx, filter: { userId?: string; deletedBefore?: Date }): Promise<TrashRow[]> {
  const where = sql.join(
    [
      sql`x.deleted_at is not null`,
      sql`(x.parent_deleted_at is null or x.parent_deleted_at <> x.deleted_at)`,
      ...(filter.userId ? [sql`x.user_id = ${filter.userId}`] : []),
      ...(filter.deletedBefore ? [sql`x.deleted_at < ${filter.deletedBefore}`] : []),
    ],
    sql` and `,
  );
  const res = await tx.execute<TrashRow>(sql`
    with items as (
      select 'subject' as type, s.id, s.user_id, s.title, null::text as location, s.deleted_at, null::timestamptz as parent_deleted_at
        from subjects s
      union all
      select 'folder', f.id, s.user_id, f.title,
             concat_ws(' › ', s.title, p.title), f.deleted_at, coalesce(p.deleted_at, s.deleted_at)
        from folders f join subjects s on s.id = f.subject_id left join folders p on p.id = f.parent_id
      union all
      select 'session', ss.id, s.user_id, ss.title,
             concat_ws(' › ', s.title, f.title), ss.deleted_at, coalesce(f.deleted_at, s.deleted_at)
        from study_sessions ss join subjects s on s.id = ss.subject_id left join folders f on f.id = ss.folder_id
      union all
      select 'document', d.id, d.user_id, d.title,
             concat_ws(' › ', s.title, f.title, ss.title), d.deleted_at, coalesce(ss.deleted_at, f.deleted_at, s.deleted_at)
        from source_documents d join subjects s on s.id = d.subject_id
        left join folders f on f.id = d.folder_id left join study_sessions ss on ss.id = d.session_id
      union all
      select 'note', n.id, s.user_id, n.title, concat_ws(' › ', s.title, ss.title), n.deleted_at, ss.deleted_at
        from notes n join study_sessions ss on ss.id = n.session_id join subjects s on s.id = ss.subject_id
      union all
      select 'attempt', a.id, s.user_id, concat('Attempt ', a.number), concat_ws(' › ', s.title, ss.title), a.deleted_at, ss.deleted_at
        from attempts a join study_sessions ss on ss.id = a.session_id join subjects s on s.id = ss.subject_id
    )
    select x.type, x.id, x.user_id, x.title, x.location, x.deleted_at from items x
    where ${where}
    order by x.deleted_at desc`);
  return res.rows.map((r) => ({ ...r, deleted_at: new Date(r.deleted_at) }));
}

/**
 * Erases every trash entry older than the retention window (the daily job).
 * Returns the storage keys to delete, gathered across all purged entries.
 */
export async function purgeExpired(db: import("./index.ts").Db, retentionDays: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const due = await trashRoots(db, { deletedBefore: cutoff });
  const keys: string[] = [];
  for (const item of due) {
    keys.push(...(await db.transaction((tx) => purge(tx, item.type, item.id))));
  }
  return { purged: due.length, keys: [...new Set(keys)] };
}
