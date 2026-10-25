/**
 * Session (watch) page, from the approved designs: the recording with its markers on the left and,
 * on the right, the notes editor and the source documents in tabs (RF15). On small screens the
 * same pieces stack, with the tabs below the player.
 */
import { failureMessages, formatTime, limits, type AttemptSummary } from "@calabrain/shared";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import clsx from "clsx";
import { Bookmark, ChevronDown, ChevronRight, FileUp, Plus, Upload, Video } from "lucide-react";
import { Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { NameDialog } from "../../components/dialogs.tsx";
import { DocumentsPanel } from "../../components/documents.tsx";
import { MarkersPanel } from "../../components/markers.tsx";
import { NoteEditor } from "../../components/note-editor.tsx";
import { NotesPanel } from "../../components/notes.tsx";
import { Dialog, Menu, useToast } from "../../components/overlay.tsx";
import { Player, type PlayerHandle } from "../../components/player.tsx";
import { RECORDING_ACCEPT, useRecordingUpload, type UploadMode } from "../../components/recording-upload.tsx";
import { FormAlert, Spinner } from "../../components/ui.tsx";
import { attemptQuery, attemptsQuery, mutations, refreshTree, sessionNotesQuery, sessionQuery, treeQuery } from "../../lib/queries.ts";

const limitOptions = [5, 10, 15, 20, 25, 30].filter((m) => m <= limits.recordingMaxMinutes);
const day = (iso: string) => new Date(iso).toLocaleDateString("en", { month: "short", day: "numeric" });
const attemptLabel = (a: AttemptSummary) => `Attempt ${a.number} · ${day(a.createdAt)}`;

export function SessionPage() {
  const { sessionId } = useParams({ strict: false }) as { sessionId: string };
  const search = useSearch({ strict: false }) as { attempt?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data: session } = useSuspenseQuery(sessionQuery(sessionId));
  const { data: tree } = useSuspenseQuery(treeQuery(session.subjectId));
  const { data: attempts } = useSuspenseQuery(attemptsQuery(sessionId));
  const { data: notes } = useSuspenseQuery(sessionNotesQuery(sessionId));

  const selectedId = search.attempt && attempts.some((a) => a.id === search.attempt) ? search.attempt : attempts[0]?.id;
  const selected = attempts.find((a) => a.id === selectedId) ?? null;
  const attempt = useQuery({ ...attemptQuery(selectedId ?? "none"), enabled: !!selectedId });

  const player = useRef<PlayerHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(0);
  const [mode, setMode] = useState<UploadMode>({ kind: "new" });
  const [dialog, setDialog] = useState<null | "rename" | "limit" | "marker" | "replace">(null);
  const [markerAt, setMarkerAt] = useState(0);
  const [tab, setTab] = useState<"notes" | "documents">("notes");

  const upload = useRecordingUpload(session, (attemptId) =>
    navigate({ to: "/sessions/$sessionId", params: { sessionId }, search: { attempt: attemptId }, replace: true }),
  );
  const sessionDocs = tree.documents.filter((d) => d.sessionId === session.id);
  const rec = attempt.data?.recording ?? null;
  const ready = rec?.status === "ready" && !!attempt.data?.playbackUrl;

  // Keep the first playback URL of a recording: a refetch signs a new one, which would reload the video.
  const [src, setSrc] = useState<{ id: string; url: string } | null>(null);
  useEffect(() => {
    if (ready && rec && src?.id !== rec.id) setSrc({ id: rec.id, url: attempt.data!.playbackUrl! });
  }, [ready, rec, src?.id, attempt.data]);

  function pick(m: UploadMode) {
    setMode(m);
    upload.clearError();
    fileInput.current?.click();
  }

  const goAttempt = (id?: string) =>
    navigate({ to: "/sessions/$sessionId", params: { sessionId }, search: id ? { attempt: id } : {}, replace: true });

  async function trashSession() {
    await mutations.deleteSession(session.id);
    await refreshTree(qc);
    await navigate({ to: "/subjects/$subjectId", params: { subjectId: session.subjectId } });
    toast({
      message: `Moved “${session.title}” to the trash.`,
      action: { label: "Undo", onClick: async () => (await mutations.restore("session", session.id), await refreshTree(qc)) },
    });
  }

  async function trashAttempt(a: AttemptSummary) {
    await mutations.deleteAttempt(a.id);
    await refreshTree(qc);
    await goAttempt();
    toast({
      message: `Moved attempt ${a.number} to the trash.`,
      action: { label: "Undo", onClick: async () => (await mutations.restore("attempt", a.id), await refreshTree(qc)) },
    });
  }

  function addMarker() {
    setMarkerAt(Math.floor(player.current?.current() ?? 0));
    setDialog("marker");
  }

  return (
    <>
      <input
        ref={fileInput}
        type="file"
        hidden
        accept={RECORDING_ACCEPT}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload.start(f, mode);
          e.target.value = "";
        }}
      />

      <header className="fade relative z-20 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb">
            <ol className="flex flex-wrap items-center gap-1 text-[13px] leading-[18px] text-ink-muted lg:text-lg lg:leading-6">
              {session.breadcrumb.map((b, i) => (
                <li key={b.id} className="flex items-center gap-1">
                  {i > 0 ? <ChevronRight size={16} strokeWidth={1.75} aria-hidden /> : null}
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
          <h1 className="mt-1 text-2xl leading-8 font-medium tracking-[-0.01em] break-words lg:text-[28px] lg:leading-9">{session.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {attempts.length ? (
            <AttemptPicker
              attempts={attempts}
              selected={selected}
              onPick={goAttempt}
              onUpload={() => pick({ kind: "new" })}
              onReplace={() => setDialog("replace")}
              onTrash={() => selected && trashAttempt(selected)}
            />
          ) : null}
          <Menu
            label="Session actions"
            items={[
              { label: "Rename session", onSelect: () => setDialog("rename") },
              { label: `Recording limit (${session.recordingLimitMin} min)`, onSelect: () => setDialog("limit") },
              { label: "Move session to the trash", danger: true, onSelect: trashSession },
            ]}
          />
          {ready ? (
            <button type="button" className="btn btn-primary" onClick={addMarker}>
              <Bookmark size={16} strokeWidth={1.75} aria-hidden />
              Add marker
            </button>
          ) : !attempts.length ? (
            <button type="button" className="btn btn-primary" onClick={() => pick({ kind: "new" })} disabled={!!upload.progress}>
              <Upload size={16} strokeWidth={1.75} aria-hidden />
              Upload recording
            </button>
          ) : null}
        </div>
      </header>

      {upload.error ? (
        <div className="mt-4">
          <FormAlert>{upload.error}</FormAlert>
        </div>
      ) : null}

      {/* Small screens read player → notes → markers; wide screens put notes in the right column. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr]">
          <div className="rise min-w-0 lg:col-start-1 lg:row-start-1" style={{ "--i": 1 } as CSSProperties}>
            {upload.progress ? (
              <Stage>
                <Spinner />
                <span>
                  Uploading {upload.progress.name}… {Math.round(upload.progress.pct * 100)}%
                </span>
                <span className="mx-auto mt-2 block h-1.5 w-64 max-w-full overflow-hidden rounded-full bg-white/20">
                  <span className="block h-full bg-white transition-[width] duration-[250ms]" style={{ width: `${upload.progress.pct * 100}%` }} />
                </span>
                <button type="button" className="mt-2 text-xs text-white/80 underline underline-offset-3" onClick={upload.cancel}>
                  Cancel
                </button>
              </Stage>
            ) : !attempts.length ? (
              <Stage>
                <Video size={32} strokeWidth={1.5} aria-hidden />
                <span className="text-[15px] font-medium">Explain the chapter in your own words</span>
                <span className="max-w-[46ch] text-[13px] text-white/70">
                  Upload a video or audio file up to {session.recordingLimitMin} minutes: MP4, MOV, WebM, MP3, M4A or WAV. You'll rewatch it here next to your notes.
                </span>
                <button type="button" className="btn btn-secondary mt-2" onClick={() => pick({ kind: "new" })}>
                  <Upload size={16} strokeWidth={1.75} aria-hidden />
                  Choose a file
                </button>
              </Stage>
            ) : !rec ? (
              <Stage>
                <Spinner />
              </Stage>
            ) : rec.status === "processing" ? (
              <Stage>
                <Spinner />
                <span className="text-[15px] font-medium">Preparing your recording</span>
                <span className="max-w-[52ch] text-[13px] text-white/70">
                  Checking the length, converting it if your browser can't play it, and extracting the audio. This page updates on its own.
                </span>
              </Stage>
            ) : rec.status === "failed" ? (
              <Stage>
                <span className="text-[15px] font-medium">This recording couldn't be used</span>
                <span className="max-w-[52ch] text-[13px] text-white/75">{failureMessages[rec.failureReason ?? ""] ?? failureMessages.internal}</span>
                <button type="button" className="btn btn-secondary mt-2" onClick={() => selected && pick({ kind: "replace", attemptId: selected.id })}>
                  Upload again
                </button>
              </Stage>
            ) : src ? (
              <Player
                ref={player}
                key={src.id}
                src={src.url}
                kind={rec.kind}
                poster={attempt.data?.thumbnailUrl ?? null}
                duration={rec.durationS ?? 0}
                markers={attempt.data?.markers ?? []}
                onTime={setNow}
              />
            ) : null}
          </div>

        <section className="panel rise flex min-h-[480px] min-w-0 flex-col p-4 sm:p-5 lg:col-start-2 lg:row-span-2 lg:row-start-1" style={{ "--i": 3 } as CSSProperties} aria-label="Notes and documents">
          <div role="tablist" className="flex gap-6 border-b border-border">
            {(
              [
                ["notes", "Notes", notes.length],
                ["documents", "Source documents", sessionDocs.length],
              ] as const
            ).map(([id, label, n]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={clsx(
                  "relative -mb-px inline-flex items-center gap-1.5 pb-3 text-[13px] leading-[18px] font-medium transition-colors duration-[250ms]",
                  tab === id ? "text-brand" : "text-ink-muted hover:text-ink",
                )}
              >
                {label} <span className="text-xs">{n}</span>
                {tab === id ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-brand" /> : null}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col pt-4">
            {tab === "notes" ? (
              <NotesTab sessionId={session.id} />
            ) : (
              <DocumentsPanel
                bare
                title="Source documents"
                hint="The chapter you're studying. The whole subject's material also counts as context."
                subjectId={session.subjectId}
                target={{ sessionId: session.id }}
                documents={sessionDocs}
              />
            )}
          </div>
        </section>

        {ready && attempt.data ? (
          <div className="rise min-w-0 lg:col-start-1 lg:row-start-2" style={{ "--i": 2 } as CSSProperties}>
            <MarkersPanel
              attemptId={attempt.data.id}
              markers={attempt.data.markers}
              now={now}
              onJump={(t) => (player.current?.seek(t), player.current?.play())}
            />
          </div>
        ) : null}
      </div>

      <NameDialog
        open={dialog === "rename"}
        onClose={() => setDialog(null)}
        title="Rename session"
        label="Session name"
        initial={session.title}
        submitLabel="Save"
        onSubmit={async (title) => {
          await mutations.updateSession(session.id, { title });
          await refreshTree(qc);
        }}
      />
      <NameDialog
        open={dialog === "marker"}
        onClose={() => setDialog(null)}
        title={`Add marker at ${formatTime(markerAt)}`}
        label="What starts here"
        submitLabel="Add marker"
        onSubmit={async (label) => {
          if (!rec) return;
          await mutations.addMarker(rec.id, markerAt, label);
          await qc.invalidateQueries({ queryKey: ["attempts", selectedId] });
        }}
      />
      <Dialog open={dialog === "limit"} onClose={() => setDialog(null)} title="Recording limit">
        <p className="text-[13px] leading-[18px] text-ink-muted">Recordings for this session can run up to this length. Longer files are refused before they upload.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {limitOptions.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={m === session.recordingLimitMin}
              className={clsx("btn", m === session.recordingLimitMin ? "btn-primary" : "btn-secondary")}
              onClick={async () => {
                await mutations.updateSession(session.id, { recordingLimitMin: m });
                await refreshTree(qc);
                setDialog(null);
                toast({ message: `Recordings for this session can now run up to ${m} minutes.` });
              }}
            >
              {m} min
            </button>
          ))}
        </div>
      </Dialog>
      <Dialog open={dialog === "replace"} onClose={() => setDialog(null)} title={`Replace the recording of attempt ${selected?.number ?? ""}?`}>
        <p className="text-[13px] leading-[18px] text-ink-muted">
          The current recording, its files and its markers are erased for good. To keep it and compare later, upload a new attempt instead.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => (setDialog(null), pick({ kind: "new" }))}>
            Upload a new attempt
          </button>
          <button type="button" className="btn btn-primary" onClick={() => (setDialog(null), selected && pick({ kind: "replace", attemptId: selected.id }))}>
            Replace recording
          </button>
        </div>
      </Dialog>
    </>
  );
}

function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-[14px] bg-[#2b2520] p-6 text-center text-white">
      {children}
    </div>
  );
}

function AttemptPicker({
  attempts,
  selected,
  onPick,
  onUpload,
  onReplace,
  onTrash,
}: {
  attempts: AttemptSummary[];
  selected: AttemptSummary | null;
  onPick: (id: string) => void;
  onUpload: () => void;
  onReplace: () => void;
  onTrash: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2 rounded-[6px] px-3 py-2 text-left text-[13px] leading-[18px] transition-colors duration-[250ms] hover:bg-surface-sunken";
  return (
    <div ref={root} className="relative">
      <button type="button" className="btn btn-secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Video size={16} strokeWidth={1.75} aria-hidden />
        {selected ? attemptLabel(selected) : "Attempts"}
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="pop absolute top-full right-0 z-30 mt-1 w-64 rounded-[10px] bg-surface-raised p-1 shadow-pop">
          {attempts.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitemradio"
              aria-checked={a.id === selected?.id}
              className={clsx(item, a.id === selected?.id && "bg-surface-sunken font-medium")}
              onClick={() => (setOpen(false), onPick(a.id))}
            >
              <span className="min-w-0 flex-1 truncate">{attemptLabel(a)}</span>
              <span className="font-mono text-xs text-ink-muted">
                {a.recording?.status === "ready" && a.recording.durationS !== null
                  ? formatTime(a.recording.durationS)
                  : a.recording?.status === "failed"
                    ? "Failed"
                    : "…"}
              </span>
            </button>
          ))}
          <div className="my-1 h-px bg-border" />
          <button type="button" role="menuitem" className={item} onClick={() => (setOpen(false), onUpload())}>
            <Plus size={16} strokeWidth={1.75} aria-hidden /> Upload a new attempt
          </button>
          {selected ? (
            <>
              <button type="button" role="menuitem" className={item} onClick={() => (setOpen(false), onReplace())}>
                <FileUp size={16} strokeWidth={1.75} aria-hidden /> Replace this recording
              </button>
              <button type="button" role="menuitem" className={clsx(item, "text-wrong")} onClick={() => (setOpen(false), onTrash())}>
                Move attempt {selected.number} to the trash
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Notes of the session inside the side panel: pick one and write in the compact editor. */
function NotesTab({ sessionId }: { sessionId: string }) {
  const { data: notes } = useSuspenseQuery(sessionNotesQuery(sessionId));
  const [current, setCurrent] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const note = notes.find((n) => n.id === current && n.status === "ready") ?? notes.find((n) => n.status === "ready") ?? null;

  if (!note) return <NotesPanel sessionId={sessionId} bare />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-2 text-left text-lg leading-6 font-medium"
          aria-expanded={picking}
          onClick={() => setPicking((p) => !p)}
        >
          <span className="truncate">{note.title}</span>
          <ChevronDown size={16} strokeWidth={1.75} className={clsx("flex-none text-ink-muted transition-transform duration-[250ms]", picking && "rotate-180")} aria-hidden />
        </button>
        <Link to="/notes/$noteId" params={{ noteId: note.id }} className="flex-none text-xs text-ink-muted underline underline-offset-3 hover:text-ink">
          Open full page
        </Link>
      </div>
      {picking ? (
        <div className="mb-3 rounded-[10px] border border-border px-3 py-1">
          <NotesPanel sessionId={sessionId} bare onPick={(id) => (setCurrent(id), setPicking(false))} />
        </div>
      ) : null}
      <Suspense fallback={<Spinner />}>
        <NoteEditor key={note.id} noteId={note.id} compact />
      </Suspense>
    </div>
  );
}
