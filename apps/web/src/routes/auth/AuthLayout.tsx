import type { ReactNode } from "react";
import { Wordmark } from "../../components/ui.tsx";

/** Centered card on canvas shared by sign-in, sign-up and password screens. */
export function AuthLayout({ title, subtitle, children, footer }: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-10 sm:justify-center sm:py-16">
      <div className="w-full max-w-[400px]">
        <div className="rise mb-8 text-center" style={{ "--i": 0 } as React.CSSProperties}>
          <Wordmark />
        </div>
        <section className="card rise p-6 sm:p-8" style={{ "--i": 1 } as React.CSSProperties}>
          <h1 className="text-2xl leading-8 font-medium tracking-[-0.01em]">{title}</h1>
          {subtitle ? <p className="mt-1 text-ink-muted">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </section>
        {footer ? (
          <p className="fade mt-6 text-center text-[13px] text-ink-muted" style={{ "--i": 2 } as React.CSSProperties}>
            {footer}
          </p>
        ) : null}
      </div>
    </main>
  );
}
