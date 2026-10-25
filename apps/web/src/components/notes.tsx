import { failureMessages, type NoteSummary } from "@calabrain/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { FileUp, NotebookPen, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { ApiRequestError } from "../lib/api.ts";
import { mutations, refreshTree, sessionNotesQuery } from "../lib/queries.ts";
import { uploadFile, UploadError } from "../lib/upload.ts";
import { StatusChip } from "./documents.tsx";
import { Menu, useToast } from "./overlay.tsx";
import { NameDialog } from "./dialogs.tsx";
import { FormAlert, Spinner } from "./ui.tsx";

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
};

/** The notes of a session: create, import (.txt, .md, .docx, PDF), rename, reorder, trash. */
export function NotesPanel({ sessionId }: { sessionId: string }) {
  const { data: notes } = useSuspenseQuery(sessionNotesQuery(sessionId));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ name: string; pct: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<NoteSummary | null>(null);

  async function create() {
    const note = await mutations.createNote(sessionId, {});
    await refreshTree(qc);
    await navigate({ to: "/notes/$noteId", params: { noteId: note.id } });
  }

  async function importFile(file: File) {
    setError(null);
    setImporting({ name: file.name, pct: 0 });
    try {
      const uploadId = await uploadFile(file, "note_import", (p) => setImporting({ name: file.name, pct: p.sent / p.total }));
      await mutations.createNote(sessionId, { uploadId });
      await refreshTree(qc);
    } catch (err) {
      setError(err instanceof UploadError || err instanceof ApiRequestError ? err.message : "The import failed. Try again.");
    } finally {
      setImporting(null);
    }
  }

  async function trash(n: NoteSummary) {
    await mutations.deleteNote(n.id);
    await refreshTree(qc);
    toast({
      message: `Moved “${n.title}” to the trash.`,
      action: { label: "Undo", onClick: async () => (await mutations.restore("note", n.id), await refreshTree(qc)) },
    });
  }

  return (
    <section className="panel p-4 sm:p-5" aria-label="Notes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg leading-6 font-medium">Notes</h2>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-ghost h-8 text-[13px]" onClick={() => input.current?.click()} disabled={!!importing}>
            <FileUp size={16} strokeWidth={1.75} aria-hidden />
            Import
          </button>
          <button type="button" className="btn btn-secondary h-8 px-3 text-[13px]" onClick={create}>
            <Plus size={16} strokeWidth={1.75} aria-hidden />
            New note
          </button>
          <input
            ref={input}
            type="file"
            hidden
            accept=".txt,.md,.markdown,.docx,.pdf,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <p className="mt-1 text-xs leading-4 text-ink-muted">Saved as you type, with a version after 5 minutes idle or when you leave.</p>
      {error ? (
        <div className="mt-3">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}

      <ul className="mt-3">
        {notes.map((n) => (
          <li key={n.id} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-amber-tint text-amber">
              <NotebookPen size={16} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <Link to="/notes/$noteId" params={{ noteId: n.id }} className="block truncate text-[13px] leading-[18px] font-medium text-ink no-underline hover:underline hover:underline-offset-3">
                {n.title}
              </Link>
              <span className={n.status === "failed" ? "block truncate text-xs text-wrong" : "block truncate text-xs leading-4 text-ink-muted"}>
                {n.status === "failed"
                  ? failureMessages[n.failureReason ?? ""] ?? failureMessages.internal
                  : n.status === "processing"
                    ? "Importing…"
                    : `Version ${n.version} · edited ${ago(n.updatedAt)}`}
              </span>
            </span>
            {n.status !== "ready" ? <StatusChip status={n.status} reason={n.failureReason} /> : null}
            <Menu
              label={`Actions for ${n.title}`}
              items={[
                { label: "Rename", onSelect: () => setRenaming(n) },
                { label: "Move up", disabled: n === notes[0], onSelect: async () => (await mutations.moveNote(n.id, notes.indexOf(n) - 1), await refreshTree(qc)) },
                { label: "Move down", disabled: n === notes[notes.length - 1], onSelect: async () => (await mutations.moveNote(n.id, notes.indexOf(n) + 1), await refreshTree(qc)) },
                { label: "Move to the trash", danger: true, onSelect: () => trash(n) },
              ]}
            />
          </li>
        ))}
        {importing ? (
          <li className="flex items-center gap-3 border-t border-border py-3 text-[13px] first:border-t-0">
            <Spinner /> Uploading {importing.name}… {Math.round(importing.pct * 100)}%
          </li>
        ) : null}
      </ul>
      {!notes.length && !importing ? (
        <p className="mt-1 rounded-[10px] border border-dashed border-border-strong px-4 py-6 text-center text-[13px] text-ink-muted">
          No notes yet. Write one here, or import a .txt, .md, .docx or PDF file.
        </p>
      ) : null}

      <NameDialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename note"
        label="Note name"
        initial={renaming?.title ?? ""}
        submitLabel="Save"
        onSubmit={async (title) => {
          if (!renaming) return;
          await mutations.renameNote(renaming.id, title);
          await refreshTree(qc);
        }}
      />
    </section>
  );
}
