import { noteExtensions } from "@calabrain/editor";
import { useQuery } from "@tanstack/react-query";
import { EditorContent, useEditor } from "@tiptap/react";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { mutations, noteVersionQuery, noteVersionsQuery } from "../lib/queries.ts";
import { Dialog } from "./overlay.tsx";
import { Spinner } from "./ui.tsx";

const sourceLabel = { editor: "Edited", import: "Imported", restore: "Restored" } as const;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Every version of a note, with a read-only preview and restore (RF10). */
export function NoteHistoryDialog({
  open,
  onClose,
  noteId,
  current,
  onRestored,
}: {
  open: boolean;
  onClose: () => void;
  noteId: string;
  current: number;
  onRestored: () => void;
}) {
  const versions = useQuery({ ...noteVersionsQuery(noteId), enabled: open });
  const [selected, setSelected] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  useEffect(() => {
    if (open) setSelected(current);
  }, [open, current]);
  const detail = useQuery({ ...noteVersionQuery(noteId, selected ?? 1), enabled: open && selected !== null });

  const preview = useEditor({ extensions: noteExtensions, editable: false, content: null, immediatelyRender: true, editorProps: { attributes: { class: "note-content" } } });
  useEffect(() => {
    if (preview && detail.data) preview.commands.setContent(detail.data.content);
  }, [preview, detail.data]);

  async function restore() {
    if (selected === null) return;
    setRestoring(true);
    try {
      await mutations.restoreVersion(noteId, selected);
      onRestored();
      onClose();
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Version history" width={820}>
      <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
        <ul className="max-h-[420px] overflow-y-auto rounded-[10px] border border-border p-1" aria-label="Versions">
          {versions.data?.map((v) => (
            <li key={v.version}>
              <button
                type="button"
                aria-current={selected === v.version}
                onClick={() => setSelected(v.version)}
                className={clsx(
                  "flex w-full flex-col rounded-[6px] px-3 py-2 text-left transition-colors duration-[250ms]",
                  selected === v.version ? "bg-surface-sunken" : "hover:bg-surface-sunken",
                )}
              >
                <span className="text-[13px] leading-[18px] font-medium">
                  Version {v.version}
                  {v.version === current ? <span className="font-normal text-ink-muted"> · current</span> : null}
                </span>
                <span className="text-xs leading-4 text-ink-muted">
                  {sourceLabel[v.source]} · {when(v.createdAt)} · {v.words} words
                </span>
              </button>
            </li>
          )) ?? (
            <li className="p-3">
              <Spinner />
            </li>
          )}
        </ul>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="max-h-[360px] min-h-[200px] overflow-y-auto rounded-[10px] border border-border bg-surface px-5 py-4">
            {detail.isLoading ? <Spinner /> : <EditorContent editor={preview} />}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
            <button type="button" className="btn btn-primary" disabled={selected === null || selected === current || restoring} onClick={restore}>
              {restoring ? <Spinner /> : null}
              Restore this version
            </button>
          </div>
          <p className="text-xs leading-4 text-ink-muted">Restoring makes a new version with this content; nothing is overwritten.</p>
        </div>
      </div>
    </Dialog>
  );
}
