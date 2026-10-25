import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import clsx from "clsx";
import {
  BookOpen,
  CalendarDays,
  LayoutGrid,
  Menu,
  NotebookPen,
  Settings,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Wordmark } from "../../components/ui.tsx";

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
}

const main: NavEntry[] = [
  { to: "/", label: "Overview", icon: LayoutGrid },
  { to: "/subjects", label: "Subjects", icon: BookOpen },
  { to: "/notes", label: "Notes", icon: NotebookPen },
  { to: "/recordings", label: "Recordings", icon: Video },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/trash", label: "Trash", icon: Trash2 },
];
const footer: NavEntry[] = [{ to: "/settings", label: "Settings", icon: Settings }];

function NavList({ items }: { items: NavEntry[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map(({ to, label, icon: Icon }) => (
        <li key={to}>
          <Link to={to} className="nav-item" activeOptions={{ exact: to === "/" }}>
            <Icon size={18} strokeWidth={1.75} aria-hidden />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Sidebar() {
  return (
    <nav aria-label="Main" className="flex h-full flex-col px-5 pt-8 pb-6">
      <Link to="/" className="mb-8 px-3 no-underline" aria-label="Calabrain, go to Overview">
        <Wordmark />
      </Link>
      <NavList items={main} />
      <div className="mt-auto">
        <NavList items={footer} />
      </div>
    </nav>
  );
}

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh border-r border-border bg-surface lg:block">
        <Sidebar />
      </aside>

      {/* Mobile / tablet top bar */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-1 lg:hidden">
        <Link to="/" className="no-underline">
          <Wordmark />
        </Link>
        <button
          type="button"
          className="btn btn-bare -mr-2.5"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu size={20} strokeWidth={1.75} aria-hidden />
        </button>
      </header>

      {/* Drawer */}
      <div
        className={clsx("fixed inset-0 z-30 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          className={clsx(
            "absolute inset-0 bg-black/30 transition-opacity duration-[250ms]",
            open ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={clsx(
            "absolute inset-y-0 left-0 w-[280px] max-w-[85vw] bg-surface shadow-pop transition-[transform,visibility] duration-[250ms] ease-[cubic-bezier(.33,1,.68,1)]",
            open ? "visible translate-x-0" : "invisible -translate-x-full shadow-none",
          )}
        >
          <button
            type="button"
            className="btn btn-bare absolute top-5 right-3"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            tabIndex={open ? 0 : -1}
          >
            <X size={20} strokeWidth={1.75} aria-hidden />
          </button>
          {open ? <Sidebar /> : null}
        </div>
      </div>

      <main className="min-w-0 px-4 pt-6 pb-10 sm:px-8 lg:pt-10">
        <div className="mx-auto max-w-[1200px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
