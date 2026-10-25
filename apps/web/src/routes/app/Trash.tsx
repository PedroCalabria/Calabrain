import type { TrashItem, TrashType } from "@calabrain/shared";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { BookOpen, FileText, Folder, Layers, NotebookPen, RotateCcw, Trash2, Video, type LucideIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useToast } from "../../components/overlay.tsx";
import { Spinner } from "../../components/ui.tsx";
import { ApiRequestError } from "../../lib/api.ts";
import { mutations, refreshTree, trashQuery } from "../../lib/queries.ts";

const kinds: Record<TrashType, { label: string; icon: LucideIcon }> = {
  subject: { label: "Subject", icon: Layers },
  folder: { label: "Folder", icon: Folder },
  session: { label: "Session", icon: BookOpen },
  document: { label: "Document", icon: FileText },
  note: { label: "Note", icon: NotebookPen },
  attempt: { label: "Attempt", icon: Video },
};

function daysLeft(purgeAt: string) {
  const d = Math.ceil((new Date(purgeAt).getTime() - Date.now()) / 86_400_000);
  return d <= 1 ? "Erased within a day" : `Erased in ${d} days`;
}

export function Trash() {
  const { data: items } = useSuspenseQuery(trashQuery);
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function run(item: TrashItem, action: "restore" | "erase") {
    setBusy(item.id);
    try {
      if (action === "restore") await mutations.restore(item.type, item.id);
      else await mutations.erase(item.type, item.id);
      await refreshTree(qc);
      toast({ message: action === "restore" ? `Restored “${item.title}”.` : `Erased “${item.title}” for good.` });
    } catch (err) {
      toast({ tone: "error", message: err instanceof ApiRequestError ? err.message : "That didn't work. Try again." });
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  return (
    <>
      <header className="rise" style={{ "--i": 0 } as CSSProperties}>
        <h1 className="text-[28px] leading-9 font-medium tracking-[-0.01em]">Trash</h1>
        <p className="mt-1 max-w-[65ch] text-ink-muted">
          Deleted items wait here for 30 days with everything that was inside them, then they're erased for good, files
          included.
        </p>
      </header>

      {items.length ? (
        <ul className="panel rise mt-6 divide-y divide-border overflow-hidden" style={{ "--i": 1 } as CSSProperties}>
          {items.map((item) => {
            const { label, icon: Icon } = kinds[item.type];
            const isBusy = busy === item.id;
            return (
              <li key={`${item.type}-${item.id}`} className="flex flex-wrap items-center gap-3 bg-surface-raised px-4 py-3 sm:flex-nowrap sm:px-5">
                <span className="grid size-9 flex-none place-items-center rounded-full bg-surface-sunken text-ink-muted">
                  <Icon size={16} strokeWidth={1.75} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-[18px] font-medium">{item.title}</span>
                  <span className="block truncate text-xs leading-4 text-ink-muted">
                    {label}
                    {item.location ? ` · ${item.location}` : ""} · {daysLeft(item.purgeAt)}
                  </span>
                </span>
                {confirming === item.id ? (
                  <span className="flex w-full items-center justify-end gap-2 sm:w-auto">
                    <span className="text-xs text-ink-muted">Erase it and its files? This can't be undone.</span>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                    <button type="button" className="btn btn-ghost text-wrong" disabled={isBusy} onClick={() => run(item, "erase")}>
                      {isBusy ? <Spinner /> : null}
                      Erase
                    </button>
                  </span>
                ) : (
                  <span className="flex w-full items-center justify-end gap-1 sm:w-auto">
                    <button type="button" className="btn btn-ghost" disabled={isBusy} onClick={() => run(item, "restore")}>
                      {isBusy ? <Spinner /> : <RotateCcw size={16} strokeWidth={1.75} aria-hidden />}
                      Restore
                    </button>
                    <button type="button" className="btn btn-ghost text-ink-muted" onClick={() => setConfirming(item.id)}>
                      Erase now
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="panel rise mt-6 p-8 text-center" style={{ "--i": 1 } as CSSProperties}>
          <span className="mx-auto grid size-11 place-items-center rounded-full bg-surface-sunken text-ink-muted">
            <Trash2 size={20} strokeWidth={1.75} aria-hidden />
          </span>
          <h2 className="mt-4 text-lg leading-6 font-medium">The trash is empty</h2>
          <p className="mx-auto mt-1 max-w-[44ch] text-ink-muted">Anything you delete shows up here first, so you can bring it back.</p>
        </section>
      )}
    </>
  );
}
