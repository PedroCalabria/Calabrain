import type { FolderNode, SubjectTree } from "@calabrain/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ApiRequestError } from "../lib/api.ts";
import { documentQuery, mutations, refreshTree } from "../lib/queries.ts";
import { Dialog, useToast } from "./overlay.tsx";
import { FormAlert, Spinner } from "./ui.tsx";

interface Row {
  key: string;
  on: boolean;
  title: string;
  pageStart: number;
  pageEnd: number;
  level: number;
}

function folderOptions(folders: FolderNode[]) {
  const out: { id: string; label: string }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parent).sort((a, b) => a.position - b.position)) {
      out.push({ id: f.id, label: `${" ".repeat(depth)}${f.title}` });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Split a book into chapter sessions, from its embedded table of contents or hand-made page ranges (RF08). */
export function SplitBookDialog({ open, onClose, tree }: { open: boolean; onClose: () => void; tree: SubjectTree }) {
  const qc = useQueryClient();
  const toast = useToast();
  const books = tree.documents.filter((d) => d.status === "ready" && !d.parentDocumentId && (d.pageCount ?? 0) > 1);
  const [bookId, setBookId] = useState<string>("");
  const [folderId, setFolderId] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setBookId(books[0]?.id ?? "");
      setFolderId("");
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const book = useQuery({ ...documentQuery(bookId), enabled: open && !!bookId });
  const pageCount = book.data?.pageCount ?? 0;

  useEffect(() => {
    if (!book.data) return;
    const outline = book.data.outline;
    if (!outline.length) {
      setRows([{ key: "r0", on: true, title: "Chapter 1", pageStart: 1, pageEnd: book.data.pageCount ?? 1, level: 1 }]);
      return;
    }
    // Pre-select the level with chapters: the second level when the book has parts, else the first.
    const levels = [...new Set(outline.map((o) => o.level))].sort();
    const pick = levels.find((l) => outline.filter((o) => o.level === l).length >= 2 && l > 1 && outline.some((o) => o.level < l)) ?? levels[0];
    setRows(
      outline.map((o, i) => ({
        key: `o${i}`,
        on: o.level === pick,
        title: o.title,
        pageStart: o.startPage,
        pageEnd: o.endPage ?? o.startPage,
        level: o.level,
      })),
    );
  }, [book.data]);

  const chosen = rows.filter((r) => r.on);
  const folders = useMemo(() => folderOptions(tree.folders), [tree.folders]);
  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await mutations.splitDocument(bookId, {
        folderId: folderId || null,
        chapters: chosen.map(({ title, pageStart, pageEnd }) => ({ title, pageStart, pageEnd })),
      });
      await refreshTree(qc);
      toast({ message: `Created ${res.created.length} ${res.created.length === 1 ? "session" : "sessions"}, each with its chapter.` });
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? (Object.values(err.fields ?? {})[0] ?? err.message) : "Couldn't split the book. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Split a book into sessions" width={640}>
      {!books.length ? (
        <p className="text-ink-muted">
          Upload the whole book as a subject document first. Once it's ready, you can split it here by its table of contents or by page
          ranges.
        </p>
      ) : (
        <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
          {error ? <FormAlert>{error}</FormAlert> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[13px] leading-[18px] font-medium">
              Book
              <select className="select-input w-full" value={bookId} onChange={(e) => setBookId(e.target.value)}>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} ({b.pageCount} pages)
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[13px] leading-[18px] font-medium">
              Put the sessions in
              <select className="select-input w-full" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
                <option value="">Top of the subject</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {book.isLoading ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-muted">
              <Spinner /> Reading the table of contents…
            </p>
          ) : (
            <>
              <p className="text-[13px] leading-[18px] text-ink-muted">
                {book.data?.outline.length
                  ? "Chapters from the book's table of contents. Pick the ones you'll study; adjust names or pages if needed."
                  : "This PDF has no table of contents. Add each chapter with its first and last page."}
              </p>
              <div className="max-h-[340px] overflow-y-auto rounded-[10px] border border-border">
                <table className="w-full text-[13px] leading-[18px]">
                  <thead className="sticky top-0 bg-surface-sunken text-left text-xs text-ink-muted">
                    <tr>
                      <th className="w-10 px-3 py-2">
                        <span className="sr-only">Include</span>
                      </th>
                      <th className="px-2 py-2 font-medium">Session name</th>
                      <th className="w-[72px] px-2 py-2 font-medium">From</th>
                      <th className="w-[72px] px-2 py-2 font-medium">To</th>
                      {!book.data?.outline.length ? <th className="w-10" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-border">
                        <td className="px-3 py-1.5">
                          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={r.on} aria-label={`Include ${r.title}`} onChange={(e) => set(r.key, { on: e.target.checked })} />
                        </td>
                        <td className="px-2 py-1.5" style={{ paddingLeft: 8 + (r.level - 1) * 14 }}>
                          <input className="field-input h-8 px-2 text-[13px]" value={r.title} aria-label="Session name" onChange={(e) => set(r.key, { title: e.target.value })} />
                        </td>
                        {(["pageStart", "pageEnd"] as const).map((k) => (
                          <td key={k} className="px-2 py-1.5">
                            <input
                              className="field-input h-8 px-2 text-[13px] tabular-nums"
                              inputMode="numeric"
                              aria-label={k === "pageStart" ? "First page" : "Last page"}
                              value={r[k]}
                              onChange={(e) => set(r.key, { [k]: Math.max(1, Math.min(pageCount, Number(e.target.value.replace(/\D/g, "")) || 1)) })}
                            />
                          </td>
                        ))}
                        {!book.data?.outline.length ? (
                          <td className="pr-2">
                            <button type="button" className="btn btn-ghost size-8 p-0" aria-label={`Remove ${r.title}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                              <Trash2 size={14} strokeWidth={1.75} aria-hidden />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="btn btn-ghost self-start"
                onClick={() => {
                  const last = rows[rows.length - 1];
                  const start = Math.min(pageCount, (last?.pageEnd ?? 0) + 1);
                  setRows((rs) => [...rs, { key: `m${Date.now()}`, on: true, title: `Chapter ${rs.length + 1}`, pageStart: start, pageEnd: pageCount, level: 1 }]);
                }}
              >
                <Plus size={16} strokeWidth={1.75} aria-hidden />
                Add a chapter by pages
              </button>
            </>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending || !chosen.length || !book.data}>
              {pending ? <Spinner /> : null}
              Create {chosen.length} {chosen.length === 1 ? "session" : "sessions"}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
