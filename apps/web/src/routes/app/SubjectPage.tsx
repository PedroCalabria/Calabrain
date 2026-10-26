import type { FolderNode, SessionNode, SubjectTree, TrashType } from "@calabrain/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import clsx from "clsx";
import { BookOpen, Check, ChevronDown, Clock, FileText, Folder, FolderOpen, Layers, Plus, Scissors, Search } from "lucide-react";
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { MoveDialog, NameDialog, SubjectDialog } from "../../components/dialogs.tsx";
import { DocumentsPanel } from "../../components/documents.tsx";
import { Dialog, Menu, useToast, type MenuItem } from "../../components/overlay.tsx";
import { SplitBookDialog } from "../../components/split.tsx";
import { ApiRequestError } from "../../lib/api.ts";
import { mutations, refreshTree, treeQuery } from "../../lib/queries.ts";

type Target =
  | { kind: "new-folder"; parentId: string | null }
  | { kind: "new-session"; folderId: string | null }
  | { kind: "rename-folder"; folder: FolderNode }
  | { kind: "rename-session"; session: SessionNode }
  | { kind: "move-folder"; folder: FolderNode }
  | { kind: "move-session"; session: SessionNode }
  | { kind: "folder-documents"; folder: FolderNode }
  | { kind: "split" }
  | { kind: "edit-subject" };

function descendants(folders: FolderNode[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) (out.add(f.id), (grew = true));
  }
  return out;
}

export function SubjectPage() {
  const { subjectId } = useParams({ strict: false }) as { subjectId: string };
  const { data: tree } = useSuspenseQuery(treeQuery(subjectId));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [target, setTarget] = useState<Target | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const close = () => setTarget(null);
  const { subject, folders, sessions } = tree;

  const refresh = () => refreshTree(qc);

  async function trash(type: TrashType, id: string, title: string) {
    try {
      if (type === "folder") await mutations.deleteFolder(id);
      else if (type === "session") await mutations.deleteSession(id);
      else await mutations.deleteSubject(id);
      await refresh();
      if (type === "subject") await navigate({ to: "/subjects" });
      toast({
        message: `Moved “${title}” to the trash.`,
        action: {
          label: "Undo",
          onClick: async () => {
            await mutations.restore(type, id);
            await refresh();
            if (type === "subject") await navigate({ to: "/subjects/$subjectId", params: { subjectId: id } });
          },
        },
      });
    } catch (err) {
      toast({ tone: "error", message: err instanceof ApiRequestError ? err.message : "Couldn't delete it. Try again." });
    }
  }

  async function reorder(type: "folder" | "session", id: string, position: number) {
    if (type === "folder") await mutations.updateFolder(id, { position });
    else await mutations.updateSession(id, { position });
    await refresh();
  }

  const stats = useMemo(() => {
    const recorded = sessions.filter((s) => s.attemptCount > 0).length;
    const attempts = sessions.reduce((n, s) => n + s.attemptCount, 0);
    const minutes = Math.round(sessions.reduce((n, s) => n + s.recordedSeconds, 0) / 60);
    return { recorded, attempts, minutes };
  }, [sessions]);

  const excluded = target?.kind === "move-folder" ? descendants(folders, target.folder.id) : new Set<string>();

  return (
    <>
      <header className="rise flex flex-wrap items-start justify-between gap-4" style={{ "--i": 0 } as CSSProperties}>
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-1 text-[13px] text-ink-muted">
            <Link to="/subjects" className="text-ink-muted no-underline hover:text-ink">
              Subjects
            </Link>
          </nav>
          <h1 className="text-[28px] leading-9 font-medium tracking-[-0.01em] break-words">{subject.title}</h1>
          {subject.description ? <p className="mt-1 max-w-[65ch] text-ink-muted">{subject.description}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Menu
            label="Subject actions"
            items={[
              { label: "Edit subject", onSelect: () => setTarget({ kind: "edit-subject" }) },
              { label: "Move subject to the trash", danger: true, onSelect: () => trash("subject", subject.id, subject.title) },
            ]}
          />
          <button type="button" className="btn btn-secondary" onClick={() => setTarget({ kind: "split" })}>
            <Scissors size={16} strokeWidth={1.75} aria-hidden />
            Split a book
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setTarget({ kind: "new-session", folderId: null })}>
            <Plus size={16} strokeWidth={1.75} aria-hidden />
            Create session
          </button>
        </div>
      </header>

      <ul className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat i={1} icon={<Check size={20} strokeWidth={1.75} />} tone="bg-amber-tint text-amber" label="Sessions recorded">
          {stats.recorded}
          <span className="text-ink-muted">/{sessions.length}</span>
        </Stat>
        <Stat i={2} icon={<Layers size={20} strokeWidth={1.75} />} tone="bg-success-tint text-success" label="Attempts">
          {stats.attempts}
        </Stat>
        <Stat i={3} icon={<FileText size={20} strokeWidth={1.75} />} tone="bg-indigo-tint text-indigo" label="All documents">
          {subject.documentCount}
        </Stat>
        <Stat i={4} icon={<Clock size={20} strokeWidth={1.75} />} tone="bg-brand-tint text-brand" label="Recorded time">
          {stats.minutes} min
        </Stat>
      </ul>

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="panel rise min-w-0 p-4 sm:p-5" style={{ "--i": 5 } as CSSProperties} aria-labelledby="contents-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 id="contents-title" className="text-lg leading-6 font-medium">
            Contents
          </h2>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <label className="relative min-w-0 flex-1 sm:w-[220px] sm:flex-none">
              <span className="sr-only">Find a session</span>
              <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-subtle" aria-hidden />
              <input
                type="search"
                className="field-input h-9 pl-9 text-[13px]"
                placeholder="Find a session"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button type="button" className="btn btn-secondary h-9 px-4" onClick={() => setTarget({ kind: "new-folder", parentId: null })}>
              <Plus size={16} strokeWidth={1.75} aria-hidden />
              Add folder
            </button>
          </div>
        </div>

        {folders.length || sessions.length ? (
          <ContentsTable
            tree={tree}
            query={query.trim().toLowerCase()}
            collapsed={collapsed}
            onToggle={(id) =>
              setCollapsed((c) => {
                const n = new Set(c);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            folderMenu={(f, index, count) => [
              { label: "New session here", onSelect: () => setTarget({ kind: "new-session", folderId: f.id }) },
              { label: "New folder inside", onSelect: () => setTarget({ kind: "new-folder", parentId: f.id }) },
              { label: "Documents in this folder", onSelect: () => setTarget({ kind: "folder-documents", folder: f }) },
              { label: "Rename", onSelect: () => setTarget({ kind: "rename-folder", folder: f }) },
              { label: "Move to…", onSelect: () => setTarget({ kind: "move-folder", folder: f }) },
              { label: "Move up", disabled: index === 0, onSelect: () => reorder("folder", f.id, index - 1) },
              { label: "Move down", disabled: index === count - 1, onSelect: () => reorder("folder", f.id, index + 1) },
              { label: "Move to the trash", danger: true, onSelect: () => trash("folder", f.id, f.title) },
            ]}
            sessionMenu={(s, index, count) => [
              { label: "Rename", onSelect: () => setTarget({ kind: "rename-session", session: s }) },
              { label: "Move to…", onSelect: () => setTarget({ kind: "move-session", session: s }) },
              { label: "Move up", disabled: index === 0, onSelect: () => reorder("session", s.id, index - 1) },
              { label: "Move down", disabled: index === count - 1, onSelect: () => reorder("session", s.id, index + 1) },
              { label: "Move to the trash", danger: true, onSelect: () => trash("session", s.id, s.title) },
            ]}
          />
        ) : (
          <div className="rounded-[10px] border border-dashed border-border-strong px-6 py-10 text-center">
            <p className="font-medium">This subject is empty</p>
            <p className="mx-auto mt-1 max-w-[52ch] text-[13px] leading-[18px] text-ink-muted">
              Add a folder for each book or lecture series, then a session for each chapter you'll study and explain.
            </p>
          </div>
        )}
      </section>
      <div className="rise" style={{ "--i": 6 } as CSSProperties}>
        <DocumentsPanel
          title="Subject documents"
          hint="Shared by every session, like a whole book or the syllabus. Chapter PDFs go in their sessions."
          subjectId={subjectId}
          target={{}}
          documents={tree.documents.filter((d) => !d.folderId && !d.sessionId)}
        />
      </div>
      </div>

      {/* Dialogs */}
      <SplitBookDialog open={target?.kind === "split"} onClose={close} tree={tree} />
      <Dialog
        open={target?.kind === "folder-documents"}
        onClose={close}
        title={target?.kind === "folder-documents" ? `Documents in “${target.folder.title}”` : "Documents"}
        width={520}
      >
        {target?.kind === "folder-documents" ? (
          <DocumentsPanel
            title="Folder documents"
            hint="Used by every session inside this folder."
            subjectId={subjectId}
            target={{ folderId: target.folder.id }}
            documents={tree.documents.filter((d) => d.folderId === target.folder.id)}
          />
        ) : null}
      </Dialog>
      <SubjectDialog
        open={target?.kind === "edit-subject"}
        onClose={close}
        initial={subject}
        onSubmit={async ({ title, description }) => {
          await mutations.updateSubject(subject.id, { title, description: description.trim() || null });
          await refresh();
        }}
      />
      <NameDialog
        open={target?.kind === "new-folder"}
        onClose={close}
        title="New folder"
        label="Folder name"
        submitLabel="Add folder"
        onSubmit={async (title) => {
          if (target?.kind !== "new-folder") return;
          await mutations.createFolder({ subjectId, parentId: target.parentId, title });
          if (target.parentId) setCollapsed((c) => (c.delete(target.parentId!), new Set(c)));
          await refresh();
        }}
      />
      <NameDialog
        open={target?.kind === "new-session"}
        onClose={close}
        title="New session"
        label="Session name"
        submitLabel="Create session"
        onSubmit={async (title) => {
          if (target?.kind !== "new-session") return;
          await mutations.createSession({ subjectId, folderId: target.folderId, title });
          if (target.folderId) setCollapsed((c) => (c.delete(target.folderId!), new Set(c)));
          await refresh();
        }}
      />
      <NameDialog
        open={target?.kind === "rename-folder" || target?.kind === "rename-session"}
        onClose={close}
        title="Rename"
        label="Name"
        initial={target?.kind === "rename-folder" ? target.folder.title : target?.kind === "rename-session" ? target.session.title : ""}
        submitLabel="Save"
        onSubmit={async (title) => {
          if (target?.kind === "rename-folder") await mutations.updateFolder(target.folder.id, { title });
          if (target?.kind === "rename-session") await mutations.updateSession(target.session.id, { title });
          await refresh();
        }}
      />
      <MoveDialog
        open={target?.kind === "move-folder" || target?.kind === "move-session"}
        onClose={close}
        itemTitle={target?.kind === "move-folder" ? target.folder.title : target?.kind === "move-session" ? target.session.title : ""}
        folders={folders}
        current={target?.kind === "move-folder" ? target.folder.parentId : target?.kind === "move-session" ? target.session.folderId : null}
        excluded={excluded}
        onSubmit={async (dest) => {
          if (target?.kind === "move-folder") await mutations.updateFolder(target.folder.id, { parentId: dest });
          if (target?.kind === "move-session") await mutations.updateSession(target.session.id, { folderId: dest });
          await refresh();
        }}
      />
    </>
  );
}

function Stat({ i, icon, tone, label, children }: { i: number; icon: ReactNode; tone: string; label: string; children: ReactNode }) {
  return (
    <li className="card rise flex items-center gap-4 p-4 sm:p-5" style={{ "--i": i } as CSSProperties}>
      <span className={clsx("grid size-11 flex-none place-items-center rounded-full", tone)} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl leading-7 font-semibold tabular-nums">{children}</span>
        <span className="block truncate text-[13px] leading-[18px] text-ink-muted">{label}</span>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Contents table: folders (collapsible, any depth) and sessions
// ---------------------------------------------------------------------------

interface Row {
  key: string;
  depth: number;
  folder?: FolderNode;
  session?: SessionNode;
  index: number;
  count: number;
  totals: { documents: number; notes: number; attempts: number };
}

function ContentsTable({
  tree,
  query,
  collapsed,
  onToggle,
  folderMenu,
  sessionMenu,
}: {
  tree: SubjectTree;
  query: string;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  folderMenu: (f: FolderNode, index: number, count: number) => MenuItem[];
  sessionMenu: (s: SessionNode, index: number, count: number) => MenuItem[];
}) {
  const rows = useMemo(() => {
    const { folders, sessions, documents } = tree;
    const byParent = (id: string | null) => folders.filter((f) => f.parentId === id).sort((a, b) => a.position - b.position);
    const sessionsIn = (id: string | null) => sessions.filter((s) => s.folderId === id).sort((a, b) => a.position - b.position);
    const matches = (s: SessionNode) => !query || s.title.toLowerCase().includes(query);

    // Totals per folder, counting everything beneath it.
    const totals = new Map<string, Row["totals"]>();
    const sum = (id: string): Row["totals"] => {
      const own = sessionsIn(id);
      const t = {
        documents: documents.filter((d) => d.folderId === id && !d.sessionId).length + own.reduce((n, s) => n + s.documentCount, 0),
        notes: own.reduce((n, s) => n + s.noteCount, 0),
        attempts: own.reduce((n, s) => n + s.attemptCount, 0),
      };
      for (const c of byParent(id)) {
        const ct = sum(c.id);
        t.documents += ct.documents;
        t.notes += ct.notes;
        t.attempts += ct.attempts;
      }
      totals.set(id, t);
      return t;
    };
    byParent(null).forEach((f) => sum(f.id));

    const hasMatch = (id: string): boolean => sessionsIn(id).some(matches) || byParent(id).some((c) => hasMatch(c.id));

    const out: Row[] = [];
    const walk = (parentId: string | null, depth: number) => {
      const fs = byParent(parentId);
      fs.forEach((f, index) => {
        if (query && !hasMatch(f.id)) return;
        out.push({ key: f.id, depth, folder: f, index, count: fs.length, totals: totals.get(f.id)! });
        if (query || !collapsed.has(f.id)) walk(f.id, depth + 1);
      });
      const ss = sessionsIn(parentId);
      ss.forEach((s, index) => {
        if (!matches(s)) return;
        out.push({
          key: s.id,
          depth,
          session: s,
          index,
          count: ss.length,
          totals: { documents: s.documentCount, notes: s.noteCount, attempts: s.attemptCount },
        });
      });
    };
    walk(null, 0);
    return out;
  }, [tree, query, collapsed]);

  if (!rows.length) {
    return <p className="px-2 py-8 text-center text-[13px] text-ink-muted">No session matches “{query}”.</p>;
  }

  return (
    <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-[560px] border-separate border-spacing-0 text-[13px] leading-[18px]">
        <thead>
          <tr className="text-left text-xs leading-4 font-medium text-ink-muted">
            <th className="rounded-l-[6px] bg-surface-sunken px-4 py-2.5 font-medium">Folders and sessions</th>
            <th className="w-[96px] bg-surface-sunken px-4 py-2.5 text-right font-medium">Documents</th>
            <th className="w-[72px] bg-surface-sunken px-4 py-2.5 text-right font-medium">Notes</th>
            <th className="w-[88px] bg-surface-sunken px-4 py-2.5 text-right font-medium">Attempts</th>
            <th className="w-[48px] rounded-r-[6px] bg-surface-sunken px-2 py-2.5">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const open = row.folder ? query !== "" || !collapsed.has(row.folder.id) : false;
            const cell = "border-b border-border bg-surface-raised px-4 py-3";
            return (
              <tr key={row.key} className="group">
                <td className={cell}>
                  <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: row.depth * 24 }}>
                    {row.folder ? (
                      <>
                        <button
                          type="button"
                          className="grid size-6 flex-none place-items-center rounded-[6px] text-ink-muted transition-colors duration-[250ms] hover:bg-surface-sunken"
                          aria-label={open ? `Collapse ${row.folder.title}` : `Expand ${row.folder.title}`}
                          aria-expanded={open}
                          onClick={() => onToggle(row.folder!.id)}
                        >
                          <ChevronDown size={16} strokeWidth={1.75} className={clsx("transition-transform duration-[250ms]", !open && "-rotate-90")} aria-hidden />
                        </button>
                        {open ? (
                          <FolderOpen size={16} strokeWidth={1.75} className="flex-none text-ink-muted" aria-hidden />
                        ) : (
                          <Folder size={16} strokeWidth={1.75} className="flex-none text-ink-muted" aria-hidden />
                        )}
                        <span className="truncate font-medium">{row.folder.title}</span>
                      </>
                    ) : (
                      <>
                        <span className="size-6 flex-none" aria-hidden />
                        <BookOpen size={16} strokeWidth={1.75} className="flex-none text-ink-muted" aria-hidden />
                        <Link
                          to="/sessions/$sessionId"
                          params={{ sessionId: row.session!.id }}
                          className="truncate text-ink no-underline hover:underline hover:underline-offset-3"
                        >
                          {row.session!.title}
                        </Link>
                      </>
                    )}
                  </div>
                </td>
                <Num className={cell} n={row.totals.documents} />
                <Num className={cell} n={row.totals.notes} />
                <Num className={cell} n={row.totals.attempts} />
                <td className={clsx(cell, "px-2 py-1.5")}>
                  <Menu
                    label={`Actions for ${row.folder?.title ?? row.session?.title}`}
                    items={row.folder ? folderMenu(row.folder, row.index, row.count) : sessionMenu(row.session!, row.index, row.count)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const Num = ({ n, className }: { n: number; className: string }) => (
  <td className={clsx(className, "text-right tabular-nums", n === 0 && "text-ink-muted")}>{n}</td>
);
