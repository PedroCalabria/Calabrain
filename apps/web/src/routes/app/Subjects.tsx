import type { SubjectSummary } from "@calabrain/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, Plus } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { SubjectDialog } from "../../components/dialogs.tsx";
import { mutations, refreshTree, subjectsQuery } from "../../lib/queries.ts";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function SubjectCard({ subject, index }: { subject: SubjectSummary; index: number }) {
  return (
    <li className="rise" style={{ "--i": Math.min(index + 1, 6) } as CSSProperties}>
      <Link
        to="/subjects/$subjectId"
        params={{ subjectId: subject.id }}
        className="card group flex h-full items-start gap-4 p-5 text-ink no-underline transition-shadow duration-[250ms] hover:shadow-pop"
      >
        <span className="grid size-11 flex-none place-items-center rounded-full bg-brand-tint text-brand">
          <BookOpen size={20} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] leading-5 font-medium">{subject.title}</span>
          <span className="mt-1 block text-xs leading-4 text-ink-muted">
            {plural(subject.sessionCount, "session")} · {plural(subject.folderCount, "folder")} ·{" "}
            {plural(subject.documentCount, "document")}
          </span>
          {subject.description ? (
            <span className="mt-2 line-clamp-2 block text-[13px] leading-[18px] text-ink-muted">{subject.description}</span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

export function useCreateSubject() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async ({ title, description }: { title: string; description: string }) => {
    const created = await mutations.createSubject({ title, ...(description.trim() ? { description } : {}) });
    await refreshTree(qc);
    await navigate({ to: "/subjects/$subjectId", params: { subjectId: created.id } });
  };
}

export function Subjects() {
  const { data: subjects } = useSuspenseQuery(subjectsQuery);
  const [creating, setCreating] = useState(false);
  const create = useCreateSubject();

  return (
    <>
      <header className="rise flex flex-wrap items-start justify-between gap-4" style={{ "--i": 0 } as CSSProperties}>
        <div>
          <h1 className="text-[28px] leading-9 font-medium tracking-[-0.01em]">Subjects</h1>
          <p className="mt-1 text-ink-muted">Each subject holds the folders, sessions and documents of one course or book.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          New subject
        </button>
      </header>

      {subjects.length ? (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {subjects.map((s, i) => (
            <SubjectCard key={s.id} subject={s} index={i} />
          ))}
        </ul>
      ) : (
        <section className="panel rise mt-6 p-8 text-center" style={{ "--i": 1 } as CSSProperties}>
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-brand-tint text-brand">
            <BookOpen size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className="mt-4 text-lg leading-6 font-medium">No subjects yet</h2>
          <p className="mx-auto mt-1 max-w-[44ch] text-ink-muted">
            Create one for each course or book you're studying. You'll add folders and a session per chapter inside it.
          </p>
        </section>
      )}

      <SubjectDialog open={creating} onClose={() => setCreating(false)} onSubmit={create} />
    </>
  );
}
