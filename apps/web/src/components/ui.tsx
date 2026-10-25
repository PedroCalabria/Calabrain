import clsx from "clsx";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode } from "react";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={clsx("wordmark", className)}>
      Calabrain<i>.</i>
    </span>
  );
}

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | undefined;
  trailing?: ReactNode;
}

/** Labelled input with hint or error, per the design system's TextField. */
export function TextField({ label, hint, error, trailing, id, className, ...rest }: TextFieldProps) {
  const auto = useId();
  const inputId = id ?? auto;
  const noteId = `${inputId}-note`;
  const note = error ?? hint;
  return (
    <div className={clsx("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={inputId} className="text-[13px] leading-[18px] font-medium">
          {label}
        </label>
        {trailing}
      </div>
      <input
        id={inputId}
        className="field-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={note ? noteId : undefined}
        {...rest}
      />
      {note ? (
        <span id={noteId} className={clsx("text-xs leading-4", error ? "text-wrong" : "text-ink-muted")}>
          {note}
        </span>
      ) : null}
    </div>
  );
}

export function FormAlert({ tone = "error", children }: { tone?: "error" | "success"; children: ReactNode }) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={clsx(
        "flex items-start gap-2 rounded-[10px] px-3 py-2.5 text-[13px] leading-[18px]",
        tone === "error" ? "bg-wrong-tint text-wrong" : "bg-success-tint text-success",
      )}
    >
      <Icon size={16} strokeWidth={1.75} className="mt-px flex-none" aria-hidden />
      <span>{children}</span>
    </div>
  );
}

export function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}
