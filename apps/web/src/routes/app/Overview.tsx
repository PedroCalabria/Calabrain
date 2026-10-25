import { useSuspenseQuery } from "@tanstack/react-query";
import { BookOpen, FileText, Video } from "lucide-react";
import type { CSSProperties } from "react";
import { firstName, greeting, meQuery } from "../../lib/session.ts";

const steps = [
  { icon: BookOpen, tone: "bg-brand-tint text-brand", title: "Create a subject", text: "One per course or book, with folders and a session per chapter." },
  { icon: FileText, tone: "bg-indigo-tint text-indigo", title: "Add your sources", text: "Upload the PDFs you study from and take notes next to them." },
  { icon: Video, tone: "bg-amber-tint text-amber", title: "Explain it on video", text: "Record yourself explaining the chapter and rewatch how you did." },
];

export function Overview() {
  const { data: me } = useSuspenseQuery(meQuery);
  return (
    <>
      <header className="rise" style={{ "--i": 0 } as CSSProperties}>
        <h1 className="text-[28px] leading-9 font-medium tracking-[-0.01em]">
          {greeting()}, {firstName(me?.name ?? "")}
        </h1>
        <p className="mt-1 text-ink-muted">Pick up where you left off.</p>
      </header>

      <section className="panel rise mt-6 p-5 sm:p-6" style={{ "--i": 1 } as CSSProperties} aria-labelledby="start-title">
        <h2 id="start-title" className="text-lg leading-6 font-medium">
          Start your first subject
        </h2>
        <p className="mt-1 max-w-[65ch] text-ink-muted">
          Your study space is ready. Subjects, folders and sessions come in the next update, followed by documents,
          notes and recordings.
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
    </>
  );
}
