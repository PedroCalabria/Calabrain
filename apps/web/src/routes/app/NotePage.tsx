import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Suspense, useState, type CSSProperties } from "react";
import { NoteEditor } from "../../components/note-editor.tsx";
import { Spinner } from "../../components/ui.tsx";
import { mutations, noteQuery, refreshTree, sessionQuery } from "../../lib/queries.ts";

export function NotePage() {
  const { noteId } = useParams({ strict: false }) as { noteId: string };
  const { data: note } = useSuspenseQuery(noteQuery(noteId));
  const { data: session } = useSuspenseQuery(sessionQuery(note.sessionId));
  const qc = useQueryClient();
  const [title, setTitle] = useState(note.title);

  async function rename() {
    const t = title.trim();
    if (!t || t === note.title) return setTitle(note.title);
    await mutations.renameNote(note.id, t);
    qc.setQueryData(noteQuery(note.id).queryKey, (old) => (old ? { ...old, title: t } : old));
    await qc.invalidateQueries({ queryKey: ["notes", "session"] });
    await refreshTree(qc).catch(() => undefined);
  }

  return (
    <>
      <header className="rise" style={{ "--i": 0 } as CSSProperties}>
        <Link to="/sessions/$sessionId" params={{ sessionId: session.id }} className="inline-flex items-center gap-1 text-[13px] text-ink-muted no-underline hover:text-ink">
          <ChevronLeft size={14} strokeWidth={1.75} aria-hidden />
          {session.breadcrumb[0]?.title} · {session.title}
        </Link>
        <input
          aria-label="Note name"
          className="mt-1 w-full rounded-[6px] bg-transparent text-[28px] leading-9 font-medium tracking-[-0.01em] outline-none focus-visible:outline-2"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </header>
      <section className="panel rise mt-5 p-4 sm:p-6" style={{ "--i": 1 } as CSSProperties}>
        <Suspense fallback={<Spinner />}>
          <NoteEditor noteId={note.id} />
        </Suspense>
      </section>
    </>
  );
}
