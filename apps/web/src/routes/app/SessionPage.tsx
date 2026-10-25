import { limits } from "@calabrain/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ChevronRight, NotebookPen, Video } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { NameDialog } from "../../components/dialogs.tsx";
import { Menu, useToast } from "../../components/overlay.tsx";
import { DocumentsPanel } from "../../components/documents.tsx";
import { mutations, refreshTree, sessionQuery, treeQuery } from "../../lib/queries.ts";

const limitOptions = [5, 10, 15, 20, 25, 30].filter((m) => m <= limits.recordingMaxMinutes);

export function SessionPage() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string };
  const { data: session } = useSuspenseQuery(sessionQuery(sessionId));
  const { data: tree } = useSuspenseQuery(treeQuery(session.subjectId));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [savingLimit, setSavingLimit] = useState(false);

  async function setLimit(min: number) {
    setSavingLimit(true);
    try {
      await mutations.updateSession(session.id, { recordingLimitMin: min });
      await refreshTree(qc);
      toast({ message: `Recordings for this session can now run up to ${min} minutes.` });
    } finally {
      setSavingLimit(false);
    }
  }

  async function trash() {
    await mutations.deleteSession(session.id);
    await refreshTree(qc);
    await navigate({ to: "/subjects/$subjectId", params: { subjectId: session.subjectId } });
    toast({
      message: `Moved “${session.title}” to the trash.`,
      action: {
        label: "Undo",
        onClick: async () => {
          await mutations.restore("session", session.id);
          await refreshTree(qc);
        },
      },
    });
  }

  const options = limitOptions.includes(session.recordingLimitMin)
    ? limitOptions
    : [...limitOptions, session.recordingLimitMin].sort((a, b) => a - b);

  return (
    <>
      <header className="rise" style={{ "--i": 0 } as CSSProperties}>
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-[13px] leading-[18px] text-ink-muted">
            {session.breadcrumb.map((b, i) => (
              <li key={b.id} className="flex items-center gap-1">
                {i > 0 ? <ChevronRight size={14} strokeWidth={1.75} aria-hidden /> : null}
                {b.type === "subject" ? (
                  <Link to="/subjects/$subjectId" params={{ subjectId: b.id }} className="text-ink-muted no-underline hover:text-ink">
                    {b.title}
                  </Link>
                ) : (
                  <span>{b.title}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <h1 className="min-w-0 text-[28px] leading-9 font-medium tracking-[-0.01em] break-words">{session.title}</h1>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-[13px] text-ink-muted">
              Recording limit
              <select
                className="select-input"
                value={session.recordingLimitMin}
                disabled={savingLimit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {options.map((m) => (
                  <option key={m} value={m}>
                    {m} min
                  </option>
                ))}
              </select>
            </label>
            <Menu
              label="Session actions"
              items={[
                { label: "Rename", onSelect: () => setRenaming(true) },
                { label: "Move to the trash", danger: true, onSelect: trash },
              ]}
            />
          </div>
        </div>
      </header>

      <div className="rise mt-6" style={{ "--i": 1 } as CSSProperties}>
        <DocumentsPanel
          title="Source documents"
          hint="The chapter you're studying. The whole subject's material also counts as context."
          subjectId={session.subjectId}
          target={{ sessionId: session.id }}
          documents={tree.documents.filter((d) => d.sessionId === session.id)}
        />
      </div>

      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {[
          { icon: NotebookPen, tone: "bg-amber-tint text-amber", title: "Notes", text: "Write and version your notes here, after documents." },
          { icon: Video, tone: "bg-brand-tint text-brand", title: "Recordings", text: "Upload your explanation and rewatch it, after notes." },
        ].map(({ icon: Icon, tone, title, text }, i) => (
          <li key={title} className="panel rise flex items-start gap-4 p-5" style={{ "--i": i + 2 } as CSSProperties}>
            <span className={`grid size-11 flex-none place-items-center rounded-full ${tone}`}>
              <Icon size={20} strokeWidth={1.75} aria-hidden />
            </span>
            <span>
              <span className="block text-[13px] leading-[18px] font-medium">{title}</span>
              <span className="mt-1 block text-xs leading-4 text-ink-muted">{text}</span>
            </span>
          </li>
        ))}
      </ul>

      <NameDialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Rename session"
        label="Session name"
        initial={session.title}
        submitLabel="Save"
        onSubmit={async (title) => {
          await mutations.updateSession(session.id, { title });
          await refreshTree(qc);
        }}
      />
    </>
  );
}
