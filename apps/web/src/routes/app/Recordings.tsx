import { formatTime } from "@calabrain/shared";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AudioLines, Video } from "lucide-react";
import type { CSSProperties } from "react";
import { StatusChip } from "../../components/documents.tsx";
import { recordingsQuery } from "../../lib/queries.ts";

export function Recordings() {
  const { data: items } = useSuspenseQuery(recordingsQuery);
  return (
    <>
      <header className="rise" style={{ "--i": 0 } as CSSProperties}>
        <h1 className="text-[28px] leading-9 font-medium tracking-[-0.01em]">Recordings</h1>
        <p className="mt-1 text-ink-muted">Every attempt you've uploaded, newest first. Open one to rewatch it next to your notes.</p>
      </header>
      {items.length ? (
        <ul className="panel rise mt-6 divide-y divide-border overflow-hidden" style={{ "--i": 1 } as CSSProperties}>
          {items.map((a) => {
            const Icon = a.recording?.kind === "audio" ? AudioLines : Video;
            return (
              <li key={a.id}>
                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: a.sessionId }}
                  search={{ attempt: a.id }}
                  className="flex items-center gap-3 bg-surface-raised px-4 py-3 text-ink no-underline transition-colors duration-[250ms] hover:bg-surface-sunken sm:px-5"
                >
                  <span className="grid size-9 flex-none place-items-center rounded-full bg-brand-tint text-brand">
                    <Icon size={16} strokeWidth={1.75} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] leading-[18px] font-medium">
                      {a.sessionTitle} · attempt {a.number}
                    </span>
                    <span className="block truncate text-xs leading-4 text-ink-muted">
                      {a.subjectTitle} · {new Date(a.createdAt).toLocaleDateString("en", { month: "short", day: "numeric" })}
                    </span>
                  </span>
                  {a.recording?.status === "ready" ? (
                    <span className="font-mono text-xs text-ink-muted">{formatTime(a.recording.durationS ?? 0)}</span>
                  ) : a.recording ? (
                    <StatusChip status={a.recording.status} reason={a.recording.failureReason} />
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="panel rise mt-6 p-8 text-center text-ink-muted" style={{ "--i": 1 } as CSSProperties}>
          No recordings yet. Open a session and upload your explanation.
        </section>
      )}
    </>
  );
}
