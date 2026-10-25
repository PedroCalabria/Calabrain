import { formatTime, type Marker } from "@calabrain/shared";
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Play } from "lucide-react";
import { useState } from "react";
import { mutations } from "../lib/queries.ts";
import { NameDialog } from "./dialogs.tsx";
import { Menu } from "./overlay.tsx";

/** Time markers of a recording (RF15): select one to jump there. */
export function MarkersPanel({
  attemptId,
  markers,
  now,
  onJump,
}: {
  attemptId: string;
  markers: Marker[];
  now: number;
  onJump: (t: number) => void;
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState<Marker | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["attempts", attemptId] });
  const currentIndex = markers.reduce((acc, m, i) => (m.tSeconds <= now ? i : acc), -1);

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="markers-title">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="markers-title" className="text-lg leading-6 font-medium">
          Markers
        </h2>
        <span className="text-xs text-ink-muted">{markers.length ? "Select one to jump there" : ""}</span>
      </div>
      {markers.length ? (
        <ul className="-mx-3">
          {markers.map((m, i) => (
            <li key={m.id} className={clsx("group flex items-center gap-2 rounded-[10px] pr-1 transition-colors duration-[250ms] hover:bg-surface-sunken", i === currentIndex && "bg-surface-sunken")}>
              <button type="button" className="flex min-w-0 flex-1 items-center gap-4 px-3 py-2.5 text-left" onClick={() => onJump(m.tSeconds)}>
                <span className={clsx("min-w-11 font-mono text-xs tabular-nums", i === currentIndex ? "text-ink" : "text-ink-muted")}>{formatTime(m.tSeconds)}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium">{m.label}</span>
                {i === currentIndex ? <span className="hidden text-xs text-ink-muted sm:inline">Playing now</span> : null}
                <Play size={16} strokeWidth={1.75} className={i === currentIndex ? "text-ink" : "text-ink-muted"} aria-hidden />
              </button>
              <Menu
                label={`Actions for marker ${m.label}`}
                items={[
                  { label: "Rename", onSelect: () => setRenaming(m) },
                  { label: "Delete marker", danger: true, onSelect: async () => (await mutations.deleteMarker(m.id), await refresh()) },
                ]}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-[13px] leading-[18px] text-ink-muted">
          No markers yet. While watching, use “Add marker” to mark where each topic starts.
        </p>
      )}
      <NameDialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename marker"
        label="Marker name"
        initial={renaming?.label ?? ""}
        submitLabel="Save"
        onSubmit={async (label) => {
          if (!renaming) return;
          await mutations.updateMarker(renaming.id, label);
          await refresh();
        }}
      />
    </section>
  );
}
