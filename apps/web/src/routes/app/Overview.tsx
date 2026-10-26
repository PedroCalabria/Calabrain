import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpen, FileText, Plus, Video } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { SubjectDialog } from "../../components/dialogs.tsx";
import { subjectsQuery } from "../../lib/queries.ts";
import { firstName, greeting, meQuery } from "../../lib/session.ts";
import { SubjectCard, useCreateSubject } from "./Subjects.tsx";

const steps = [
  { icon: BookOpen, tone: "bg-brand-tint text-brand", title: "Create a subject", text: "One per course or book, with folders and a session per chapter." },
  { icon: FileText, tone: "bg-indigo-tint text-indigo", title: "Add your sources", text: "Upload the PDFs you study from and take notes next to them." },
  { icon: Video, tone: "bg-amber-tint text-amber", title: "Explain it on video", text: "Record yourself explaining the chapter and rewatch how you did." },
];

export function Overview() {
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: subjects } = useSuspenseQuery(subjectsQuery);
  const [creating, setCreating] = useState(false);
  const create = useCreateSubject();

  return (
    <>
      <header className="rise flex flex-wrap items-start justify-between gap-4" style={{ "--i": 0 } as CSSProperties}>
        <div>
          <h1 className="text-[28px] leading-9 font-medium tracking-[-0.01em]">
            {greeting()}, {firstName(me?.name ?? "")}
          </h1>
          <p className="mt-1 text-ink-muted">Pick up where you left off.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          New subject
        </button>
      </header>

      {subjects.length ? (
        <section className="mt-6" aria-labelledby="subjects-title">
          <div className="rise mb-3 flex items-center justify-between" style={{ "--i": 1 } as CSSProperties}>
            <h2 id="subjects-title" className="text-lg leading-6 font-medium">
              Your subjects
            </h2>
            <Link to="/subjects" className="text-[13px] font-medium text-ink underline underline-offset-3">
              View all
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {subjects.slice(0, 6).map((s, i) => (
              <SubjectCard key={s.id} subject={s} index={i + 1} />
            ))}
          </ul>
        </section>
      ) : (
        <section className="panel rise mt-6 p-5 sm:p-6" style={{ "--i": 1 } as CSSProperties} aria-labelledby="start-title">
          <h2 id="start-title" className="text-lg leading-6 font-medium">
            Start your first subject
          </h2>
          <p className="mt-1 max-w-[65ch] text-ink-muted">
            Your study space is ready. Create a subject, then add folders and a session for each chapter.
          </p>
          <ol className="mt-5 grid gap-4 sm:grid-cols-3">
            {steps.map(({ icon: Icon, tone, title, text }, n) => (
              <li key={title} className="card flex items-start gap-4 p-5">
                <span className={`grid size-11 flex-none place-items-center rounded-full ${tone}`}>
                  <Icon size={20} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] leading-[18px] font-medium">
                    {n + 1}. {title}
                  </span>
                  <span className="mt-1 block text-xs leading-4 text-ink-muted">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <SubjectDialog open={creating} onClose={() => setCreating(false)} onSubmit={create} />
    </>
  );
}
