/** Dialog, menu and toast: the small overlays the tree screens need. */
import clsx from "clsx";
import { MoreHorizontal, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// ---------------------------------------------------------------------------
// Dialog (native <dialog>: focus trap and Escape for free)
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  children,
  width = 440,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="dialog m-auto w-[calc(100%-32px)] rounded-[14px] bg-surface-raised p-0 text-ink shadow-pop backdrop:bg-black/30"
      style={{ maxWidth: width }}
    >
      {open ? (
        <div className="p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <h2 id={titleId} className="text-lg leading-6 font-medium">
              {title}
            </h2>
            <button type="button" className="btn btn-bare -mt-2.5 -mr-3 size-10" aria-label="Close" onClick={onClose}>
              <X size={18} strokeWidth={1.75} aria-hidden />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Menu (row actions)
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ label, items, className }: { label: string; items: MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number; up: boolean }>({ top: 0, right: 0, up: false });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const menuId = useId();

  // Fixed position, so a scrolling table never clips the menu. Opens upward near the bottom edge.
  const place = useCallback(() => {
    if (!trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 40 * items.length + 16;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, right: window.innerWidth - r.right, up });
  }, [items.length]);

  function toggle() {
    if (!open) place();
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !popup.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onScroll = () => place();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    popup.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, place]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = [...(popup.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
  }

  return (
    <div ref={root} className={clsx("relative", className)}>
      <button
        ref={trigger}
        type="button"
        className="btn btn-ghost size-8 p-0"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
      >
        <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden />
      </button>
      {open
        ? createPortal(
        <div
          ref={popup}
          id={menuId}
          role="menu"
          onKeyDown={onKeyDown}
          className="pop fixed z-40 min-w-[180px] rounded-[10px] bg-surface-raised p-1 shadow-pop"
          style={{ right: pos.right, ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }) }}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={clsx(
                "flex w-full items-center rounded-[6px] px-3 py-2 text-left text-[13px] leading-[18px] transition-colors duration-[250ms] hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none disabled:cursor-not-allowed disabled:text-ink-subtle disabled:hover:bg-transparent",
                item.danger ? "text-wrong" : "text-ink",
              )}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast (bottom, with an optional action such as Undo)
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  message: string;
  tone: "neutral" | "error";
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<(t: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, "id" | "tone"> & { tone?: Toast["tone"] }) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-2), { ...t, tone: t.tone ?? "neutral", id }]);
      setTimeout(() => dismiss(id), 6000);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              "pop pointer-events-auto flex max-w-[480px] items-center gap-4 rounded-[10px] px-4 py-3 text-[13px] leading-[18px] shadow-pop",
              t.tone === "error" ? "bg-wrong text-white" : "bg-nav-active text-on-nav-active",
            )}
          >
            <span>{t.message}</span>
            {t.action ? (
              <button
                type="button"
                className="font-medium underline underline-offset-3"
                onClick={() => {
                  dismiss(t.id);
                  t.action!.onClick();
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
