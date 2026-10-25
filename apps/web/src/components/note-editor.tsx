/**
 * Note editor (RF09–RF10): TipTap with the shared note schema. The draft autosaves a second after
 * typing stops; a version is made after 5 minutes idle or when you leave. If another tab saved a
 * version meanwhile the API answers 409 and the editor offers to reload or keep yours as a new version.
 */
import { noteExtensions } from "@calabrain/editor";
import { limits, type DocNode, type NoteDetail } from "@calabrain/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import clsx from "clsx";
import {
  Bold,
  Check,
  Code2,
  Heading2,
  Heading3,
  History,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Table2,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL, ApiRequestError } from "../lib/api.ts";
import { mutations, noteQuery } from "../lib/queries.ts";
import { NoteHistoryDialog } from "./note-history.tsx";
import { FormAlert, Spinner } from "./ui.tsx";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

function ToolButton({ icon: Icon, label, active, onClick, disabled }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={clsx(
        "grid size-8 place-items-center rounded-[6px] transition-colors duration-[250ms] hover:bg-surface-sunken disabled:opacity-40",
        active ? "bg-surface-sunken text-ink" : "text-ink-muted",
      )}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      code: e.isActive("codeBlock"),
      link: e.isActive("link"),
      table: e.isActive("table"),
    }),
  });
  const c = () => editor.chain().focus();
  function link() {
    if (s.link) return c().unsetLink().run();
    const url = window.prompt("Link address", "https://");
    if (url && url !== "https://") c().extendMarkRange("link").setLink({ href: url }).run();
  }
  return (
    <div role="toolbar" aria-label="Format" className="flex flex-wrap items-center gap-0.5">
      <ToolButton icon={Heading2} label="Heading" active={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()} />
      <ToolButton icon={Heading3} label="Subheading" active={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()} />
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton icon={Bold} label="Bold" active={s.bold} onClick={() => c().toggleBold().run()} />
      <ToolButton icon={Italic} label="Italic" active={s.italic} onClick={() => c().toggleItalic().run()} />
      <ToolButton icon={Link2} label={s.link ? "Remove link" : "Link"} active={s.link} onClick={link} />
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolButton icon={List} label="Bulleted list" active={s.bullet} onClick={() => c().toggleBulletList().run()} />
      <ToolButton icon={ListOrdered} label="Numbered list" active={s.ordered} onClick={() => c().toggleOrderedList().run()} />
      <ToolButton icon={Quote} label="Quote" active={s.quote} onClick={() => c().toggleBlockquote().run()} />
      <ToolButton icon={Code2} label="Code block" active={s.code} onClick={() => c().toggleCodeBlock().run()} />
      <ToolButton
        icon={Table2}
        label={s.table ? "Delete table" : "Table"}
        active={s.table}
        onClick={() => (s.table ? c().deleteTable().run() : c().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run())}
      />
    </div>
  );
}

export function NoteEditor({ noteId, compact = false }: { noteId: string; compact?: boolean }) {
  const qc = useQueryClient();
  const { data: note } = useSuspenseQuery(noteQuery(noteId));
  const [epoch, setEpoch] = useState(0);
  const reload = useCallback(async () => {
    await qc.refetchQueries({ queryKey: noteQuery(noteId).queryKey });
    setEpoch((e) => e + 1);
  }, [qc, noteId]);
  if (note.status === "processing") {
    return (
      <p className="flex items-center gap-2 py-8 text-ink-muted">
        <Spinner /> Importing the file into an editable note…
      </p>
    );
  }
  if (note.status === "failed") {
    return <FormAlert>We couldn't import this file. Check that it opens on your computer, then import it again.</FormAlert>;
  }
  return <LoadedEditor key={`${note.id}-${epoch}`} note={note} compact={compact} onReload={reload} />;
}

function LoadedEditor({ note, compact, onReload }: { note: NoteDetail; compact: boolean; onReload: () => Promise<void> }) {
  const qc = useQueryClient();
  const conflicted = useRef(false);
  const base = useRef(note.version);
  const pendingContent = useRef<DocNode | null>(null);
  const unversioned = useRef(note.hasUnversionedDraft);
  const [state, setState] = useState<SaveState>(note.hasUnversionedDraft ? "saved" : "idle");
  const [version, setVersion] = useState(note.version);
  const [history, setHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onConflict = (err: unknown) => {
    if (err instanceof ApiRequestError && err.status === 409) {
      conflicted.current = true;
      setState("conflict");
      return true;
    }
    return false;
  };

  const saveDraft = useCallback(async () => {
    const content = pendingContent.current;
    if (!content || conflicted.current) return;
    setState("saving");
    try {
      await mutations.saveDraft(note.id, content, base.current);
      if (pendingContent.current === content) pendingContent.current = null;
      unversioned.current = true;
      setState("saved");
    } catch (err) {
      if (!onConflict(err)) setState("error");
    }
  }, [note.id]);

  const makeVersion = useCallback(async () => {
    clearTimeout(draftTimer.current);
    if (pendingContent.current) await saveDraft();
    if (!unversioned.current || conflicted.current) return;
    try {
      const res = await mutations.createVersion(note.id, base.current);
      base.current = res.version;
      unversioned.current = false;
      setVersion(res.version);
      qc.setQueryData(noteQuery(note.id).queryKey, (old) => (old ? { ...old, version: res.version, hasUnversionedDraft: false } : old));
      qc.invalidateQueries({ queryKey: ["notes", note.id, "versions"] });
    } catch (err) {
      onConflict(err);
    }
  }, [note.id, qc, saveDraft]);

  const editor = useEditor({
    extensions: noteExtensions,
    content: note.content,
    immediatelyRender: true,
    editorProps: { attributes: { class: "note-content", "aria-label": "Note", spellcheck: "true" } },
    onUpdate: ({ editor }) => {
      pendingContent.current = editor.getJSON() as DocNode;
      setState((s) => (s === "conflict" ? s : "dirty"));
      clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(saveDraft, 1000);
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(makeVersion, limits.noteVersionIdleMinutes * 60 * 1000);
    },
  });

  // Leaving the page (or hiding the tab) makes a version, sent even while the page unloads.
  useEffect(() => {
    const flush = () => {
      if ((!pendingContent.current && !unversioned.current) || conflicted.current) return;
      const content = pendingContent.current ?? undefined;
      void fetch(`${API_URL}/notes/${note.id}/versions`, {
        method: "POST",
        credentials: "include",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseVersion: base.current, ...(content ? { content } : {}) }),
      })
        .then(async (r) => {
          if (r.ok) {
            const { version } = (await r.json()) as { version: number };
            base.current = version;
            pendingContent.current = null;
            unversioned.current = false;
            setVersion(version);
          }
        })
        .catch(() => undefined);
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
      clearTimeout(draftTimer.current);
      clearTimeout(idleTimer.current);
      flush(); // route change inside the app
    };
  }, [note.id]);

  async function reload() {
    pendingContent.current = null;
    unversioned.current = false;
    conflicted.current = true; // nothing from this editor is sent while it is replaced
    await onReload();
  }

  async function keepMine() {
    if (!editor) return;
    try {
      const res = await mutations.createVersion(note.id, base.current, editor.getJSON() as DocNode, true);
      base.current = res.version;
      pendingContent.current = null;
      unversioned.current = false;
      setVersion(res.version);
      conflicted.current = false;
      setState("idle");
    } catch {
      setError("Couldn't save your version. Check your connection and try again.");
    }
  }

  const status: Record<SaveState, string> = {
    idle: `Saved · version ${version}`,
    dirty: "Editing…",
    saving: "Saving…",
    saved: "Draft saved",
    error: "Not saved. Check your connection.",
    conflict: "Changed elsewhere",
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className={clsx("flex flex-wrap items-center justify-between gap-2", compact ? "pb-2" : "border-b border-border pb-3")}>
        {editor ? <Toolbar editor={editor} /> : <span />}
        <div className="flex items-center gap-1">
          <span
            className={clsx("inline-flex items-center gap-1 text-xs leading-4", state === "error" ? "text-wrong" : "text-ink-muted")}
            aria-live="polite"
          >
            {state === "idle" ? <Check size={14} strokeWidth={1.75} aria-hidden /> : null}
            {status[state]}
          </span>
          <button type="button" className="btn btn-ghost size-8 p-0 text-ink-muted" aria-label="Version history" title="Version history" onClick={async () => (await makeVersion(), setHistory(true))}>
            <History size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>

      {state === "conflict" ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[10px] bg-amber-tint px-4 py-3 text-[13px] leading-[18px] text-partial" role="alert">
          <span className="min-w-0 flex-1">This note was saved in another tab or device. Reload it, or keep what you have here as a new version.</span>
          <button type="button" className="btn btn-secondary h-8 px-3 text-[13px]" onClick={reload}>
            Reload
          </button>
          <button type="button" className="btn btn-ghost h-8 text-[13px]" onClick={keepMine}>
            Save mine as a new version
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <FormAlert>{error}</FormAlert>
        </div>
      ) : null}

      <EditorContent editor={editor} className={clsx("min-h-0 flex-1", compact ? "pt-1" : "pt-4")} />

      <NoteHistoryDialog
        open={history}
        onClose={() => setHistory(false)}
        noteId={note.id}
        current={version}
        onRestored={reload}
      />
    </div>
  );
}
