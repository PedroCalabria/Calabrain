import { failureMessages, type DocumentNode, type ProcessingStatus } from "@calabrain/shared";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";
import { FileText, Plus, Upload, X } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { ApiRequestError } from "../lib/api.ts";
import { mutations, refreshTree } from "../lib/queries.ts";
import { formatBytes, uploadFile, UploadError } from "../lib/upload.ts";
import { NameDialog } from "./dialogs.tsx";
import { Menu, useToast } from "./overlay.tsx";

export function StatusChip({ status, reason }: { status: ProcessingStatus; reason?: string | null }) {
  const styles: Record<ProcessingStatus, string> = {
    processing: "bg-indigo-tint text-indigo",
    ready: "bg-success-tint text-success",
    failed: "bg-wrong-tint text-wrong",
  };
  const label = { processing: "Processing", ready: "Ready", failed: "Failed" }[status];
  return (
    <span
      className={clsx("inline-flex h-6 flex-none items-center gap-1.5 rounded-full px-2.5 text-xs leading-4 font-medium", styles[status])}
      title={status === "failed" && reason ? failureMessages[reason] ?? failureMessages.internal : undefined}
    >
      <span className={clsx("size-1.5 rounded-full bg-current", status === "processing" && "pulse")} aria-hidden />
      {label}
    </span>
  );
}

interface Pending {
  key: string;
  name: string;
  size: number;
  sent: number;
  error?: string;
  file: File;
  controller: AbortController;
  uploadId?: string;
}

/**
 * A list of source documents with upload (button or drag and drop).
 * `target` says where new PDFs are attached: the subject, a folder or a session.
 */
export function DocumentsPanel({
  title,
  hint,
  subjectId,
  target,
  documents,
  bare = false,
}: {
  title: string;
  hint?: string;
  subjectId: string;
  target: { folderId?: string; sessionId?: string };
  documents: DocumentNode[];
  /** Inside another panel (the session's side tabs): no frame, smaller heading. */
  bare?: boolean;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [renaming, setRenaming] = useState<DocumentNode | null>(null);

  const update = (key: string, patch: Partial<Pending>) =>
    setPending((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function send(item: Pending) {
    update(item.key, { error: undefined });
    try {
      const uploadId = await uploadFile(item.file, "source_document", (p) => update(item.key, { sent: p.sent }), {
        signal: item.controller.signal,
        ...(item.uploadId ? { resumeId: item.uploadId } : {}),
      });
      update(item.key, { uploadId });
      await mutations.createDocument({ uploadId, subjectId, ...target });
      setPending((list) => list.filter((p) => p.key !== item.key));
      await refreshTree(qc);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const message =
        err instanceof UploadError || err instanceof ApiRequestError ? err.message : "The upload failed. Try again.";
      update(item.key, { error: message });
    }
  }

  function add(files: FileList | File[]) {
    const items = [...files].map((file) => ({
      key: `${file.name}-${file.size}-${Math.random()}`,
      name: file.name,
      size: file.size,
      sent: 0,
      file,
      controller: new AbortController(),
    }));
    setPending((list) => [...list, ...items]);
    items.forEach(send);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  }

  async function trash(doc: DocumentNode) {
    await mutations.deleteDocument(doc.id);
    await refreshTree(qc);
    toast({
      message: `Moved “${doc.title}” to the trash.`,
      action: { label: "Undo", onClick: async () => (await mutations.restore("document", doc.id), await refreshTree(qc)) },
    });
  }

  return (
    <section
      className={clsx(!bare && "panel p-4 sm:p-5", "rounded-[14px] transition-colors duration-[250ms]", dragging && "bg-surface-sunken")}
      aria-label={title}
      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="flex items-center justify-between gap-3">
        {bare ? <span className="sr-only">{title}</span> : <h2 className="text-lg leading-6 font-medium">{title}</h2>}
        <button type="button" className={clsx("btn btn-secondary h-8 px-3 text-[13px]", bare && "ml-auto")} onClick={() => input.current?.click()}>
          <Plus size={16} strokeWidth={1.75} aria-hidden />
          Add
        </button>
        <input
          ref={input}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {hint ? <p className="mt-1 text-xs leading-4 text-ink-muted">{hint}</p> : null}

      <ul className="mt-3 flex flex-col">
        {documents.map((doc) => (
          <li key={doc.id} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
            <span className="grid size-9 flex-none place-items-center rounded-[6px] bg-indigo-tint text-indigo">
              <FileText size={16} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              {doc.status === "ready" ? (
                <Link
                  to="/documents/$documentId"
                  params={{ documentId: doc.id }}
                  className="block truncate text-[13px] leading-[18px] font-medium text-ink no-underline hover:underline hover:underline-offset-3"
                >
                  {doc.title}
                </Link>
              ) : (
                <span className="block truncate text-[13px] leading-[18px] font-medium">{doc.title}</span>
              )}
              <span className={clsx("block truncate text-xs leading-4", doc.status === "failed" ? "text-wrong" : "text-ink-muted")}>
                {doc.status === "failed"
                  ? failureMessages[doc.failureReason ?? ""] ?? failureMessages.internal
                  : doc.pageCount
                    ? `${doc.pageCount} pages`
                    : "Reading the text…"}
              </span>
            </span>
            <StatusChip status={doc.status} reason={doc.failureReason} />
            <Menu
              label={`Actions for ${doc.title}`}
              items={[
                { label: "Rename", onSelect: () => setRenaming(doc) },
                { label: "Move to the trash", danger: true, onSelect: () => trash(doc) },
              ]}
            />
          </li>
        ))}

        {pending.map((p) => (
          <li key={p.key} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
            <span className="grid size-9 flex-none place-items-center rounded-[6px] bg-surface-sunken text-ink-muted">
              <Upload size={16} strokeWidth={1.75} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] leading-[18px] font-medium">{p.name}</span>
              {p.error ? (
                <span className="block text-xs leading-4 text-wrong">{p.error}</span>
              ) : (
                <span className="mt-1.5 flex items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={p.size} aria-valuenow={p.sent} aria-label={`Uploading ${p.name}`}>
                    <span className="block h-full rounded-full bg-brand transition-[width] duration-[250ms]" style={{ width: `${(p.sent / p.size) * 100}%` }} />
                  </span>
                  <span className="text-xs leading-4 text-ink-muted tabular-nums">
                    {formatBytes(p.sent)} / {formatBytes(p.size)}
                  </span>
                </span>
              )}
            </span>
            {p.error ? (
              <button type="button" className="btn btn-ghost" onClick={() => send(p)}>
                Retry
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-ghost size-8 p-0"
              aria-label={`Cancel ${p.name}`}
              onClick={() => {
                p.controller.abort();
                setPending((list) => list.filter((x) => x.key !== p.key));
              }}
            >
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      {!documents.length && !pending.length ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="mt-1 flex w-full flex-col items-center gap-1 rounded-[10px] border border-dashed border-border-strong px-4 py-6 text-center text-[13px] leading-[18px] text-ink-muted transition-colors duration-[250ms] hover:bg-surface-sunken"
        >
          <Upload size={18} strokeWidth={1.75} aria-hidden />
          <span>
            <span className="font-medium text-ink">Upload PDFs</span> or drop them here
          </span>
          <span className="text-xs">PDFs with selectable text, up to 200 MB each</span>
        </button>
      ) : null}

      <NameDialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename document"
        label="Document name"
        initial={renaming?.title ?? ""}
        submitLabel="Save"
        onSubmit={async (title) => {
          if (!renaming) return;
          await mutations.renameDocument(renaming.id, title);
          await refreshTree(qc);
        }}
      />
    </section>
  );
}
