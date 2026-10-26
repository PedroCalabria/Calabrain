import type { FolderNode } from "@calabrain/shared";
import clsx from "clsx";
import { Folder, FolderOpen } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { ApiRequestError } from "../lib/api.ts";
import { Dialog } from "./overlay.tsx";
import { FormAlert, Spinner, TextField } from "./ui.tsx";

function useSubmit(onSubmit: () => Promise<void>, onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFields({});
    try {
      await onSubmit();
      onDone();
    } catch (err) {
      if (err instanceof ApiRequestError && err.fields) setFields(err.fields);
      else setError(err instanceof ApiRequestError ? err.message : "Something went wrong on our side. Try again.");
    } finally {
      setPending(false);
    }
  }
  return { pending, fields, error, submit };
}

/** Create or rename anything with a title (folder, session). */
export function NameDialog({
  open,
  onClose,
  title,
  label,
  initial = "",
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  label: string;
  initial?: string;
  submitLabel: string;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const { pending, fields, error, submit } = useSubmit(() => onSubmit(value), onClose);

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <TextField label={label} value={value} autoFocus error={fields.title ?? Object.values(fields)[0]} onChange={(e) => setValue(e.target.value)} />
        <DialogActions onCancel={onClose} pending={pending} submitLabel={submitLabel} />
      </form>
    </Dialog>
  );
}

export function SubjectDialog({
  open,
  onClose,
  initial,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  initial?: { title: string; description: string | null };
  onSubmit: (v: { title: string; description: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (open) {
      setTitle(initial?.title ?? "");
      setDescription(initial?.description ?? "");
    }
  }, [open, initial]);
  const { pending, fields, error, submit } = useSubmit(() => onSubmit({ title, description }), onClose);

  return (
    <Dialog open={open} onClose={onClose} title={initial ? "Edit subject" : "New subject"}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <TextField
          label="Name"
          placeholder="e.g. Distributed Systems"
          value={title}
          autoFocus
          error={fields.title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label htmlFor="subject-description" className="text-[13px] leading-[18px] font-medium">
            Description <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <textarea
            id="subject-description"
            rows={3}
            className="field-input h-auto py-2.5"
            placeholder="What it covers and where the material comes from."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            aria-invalid={fields.description ? true : undefined}
          />
          {fields.description ? <span className="text-xs text-wrong">{fields.description}</span> : null}
        </div>
        <DialogActions onCancel={onClose} pending={pending} submitLabel={initial ? "Save" : "Create subject"} />
      </form>
    </Dialog>
  );
}

/** Pick a folder of the subject (or its top level) as the destination of a move. */
export function MoveDialog({
  open,
  onClose,
  itemTitle,
  folders,
  current,
  excluded,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  itemTitle: string;
  folders: FolderNode[];
  current: string | null;
  /** Folder ids that can't be a destination (a folder and its own subfolders). */
  excluded: Set<string>;
  onSubmit: (folderId: string | null) => Promise<void>;
}) {
  const [target, setTarget] = useState<string | null>(current);
  useEffect(() => {
    if (open) setTarget(current);
  }, [open, current]);
  const { pending, error, submit } = useSubmit(() => onSubmit(target), onClose);

  const rows: { folder: FolderNode; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parentId).sort((a, b) => a.position - b.position)) {
      if (excluded.has(f.id)) continue;
      rows.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);

  const option = (id: string | null, label: string, depth: number) => (
    <li key={id ?? "root"}>
      <button
        type="button"
        role="radio"
        aria-checked={target === id}
        onClick={() => setTarget(id)}
        className={clsx(
          "flex w-full items-center gap-2 rounded-[6px] py-2 pr-3 text-left text-[13px] leading-[18px] transition-colors duration-[250ms]",
          target === id ? "bg-surface-sunken font-medium" : "hover:bg-surface-sunken",
        )}
        style={{ paddingLeft: 12 + depth * 20 }}
      >
        {target === id ? <FolderOpen size={16} strokeWidth={1.75} aria-hidden /> : <Folder size={16} strokeWidth={1.75} className="text-ink-muted" aria-hidden />}
        <span className="truncate">{label}</span>
        {id === current ? <span className="ml-auto text-xs font-normal text-ink-muted">Current</span> : null}
      </button>
    </li>
  );

  return (
    <Dialog open={open} onClose={onClose} title={`Move “${itemTitle}”`}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        {error ? <FormAlert>{error}</FormAlert> : null}
        <ul role="radiogroup" aria-label="Destination" className="max-h-[320px] overflow-y-auto rounded-[10px] border border-border p-1">
          {option(null, "Top of the subject", 0)}
          {rows.map(({ folder, depth }) => option(folder.id, folder.title, depth + 1))}
        </ul>
        <DialogActions onCancel={onClose} pending={pending} submitLabel="Move here" disabled={target === current} />
      </form>
    </Dialog>
  );
}

function DialogActions({
  onCancel,
  pending,
  submitLabel,
  disabled,
}: {
  onCancel: () => void;
  pending: boolean;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="mt-2 flex justify-end gap-2">
      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" className="btn btn-primary" disabled={pending || disabled}>
        {pending ? <Spinner /> : null}
        {submitLabel}
      </button>
    </div>
  );
}
