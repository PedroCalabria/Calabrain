import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { NotebookPen } from "lucide-react";
import type { CSSProperties } from "react";
import { ago } from "../../components/notes.tsx";
import { notesQuery } from "../../lib/queries.ts";

export function Notes() {
  const { data: notes } = useSuspenseQuery(notesQuery);
  return (
    <>
      <header className="rise" style={{ "--i": 0 } as CSSProperties}>
        <h1 className="text-[28px] leading-9 font-medium tracking-[-0.01em]">Notes</h1>
        <p className="mt-1 text-ink-muted">Your latest notes across every subject. Create new ones inside a session.</p>
      </header>
      {notes.length ? (
        <ul className="panel rise mt-6 divide-y divide-border overflow-hidden" style={{ "--i": 1 } as CSSProperties}>
          {notes.map((n) => (
            <li key={n.id}>
              <Link to="/notes/$noteId" params={{ noteId: n.id }} className="flex items-center gap-3 bg-surface-raised px-4 py-3 text-ink no-underline transition-colors duration-[250ms] hover:bg-surface-sunken sm:px-5">
                <span className="grid size-9 flex-none place-items-center rounded-full bg-amber-tint text-amber">
                  <NotebookPen size={16} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-[18px] font-medium">{n.title}</span>
                  <span className="block truncate text-xs leading-4 text-ink-muted">
                    {n.subjectTitle} › {n.sessionTitle}
                  </span>
                </span>
                <span className="flex-none text-xs text-ink-muted">{ago(n.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <section className="panel rise mt-6 p-8 text-center text-ink-muted" style={{ "--i": 1 } as CSSProperties}>
          No notes yet. Open a session and choose “New note”.
        </section>
      )}
    </>
  );
}
