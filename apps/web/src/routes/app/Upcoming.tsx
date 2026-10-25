import type { CSSProperties } from "react";

/** Placeholder for sections whose features land in a later stage of phase 1. */
export function Upcoming({ title, text }: { title: string; text: string }) {
  return (
    <>
      <h1 className="rise text-[28px] leading-9 font-medium tracking-[-0.01em]" style={{ "--i": 0 } as CSSProperties}>
        {title}
      </h1>
      <section className="panel rise mt-6 p-5 sm:p-6" style={{ "--i": 1 } as CSSProperties}>
        <p className="max-w-[65ch] text-ink-muted">{text}</p>
      </section>
    </>
  );
}
