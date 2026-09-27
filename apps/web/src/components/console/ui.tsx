"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ButtonHTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import type { Failure } from "@/lib/failure";
import { short } from "@/lib/format";
import { cn } from "@/lib/utils";

/*
 * Console primitives. They extend the public page's system (docs/DESIGN-SYSTEM.md)
 * rather than adding a second one: zero radius, hairline rules instead of
 * shadows, mono only for machine values, and status always carried by a word
 * as well as a color.
 */

export const EASE: [number, number, number, number] = [0.23, 1, 0.32, 1];

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type Tone = "ok" | "pending" | "fail" | "idle" | "signal";

const TONE_PAPER: Record<Tone, { text: string; dot: string }> = {
  ok: { text: "text-ok-ink", dot: "bg-ok-ink" },
  pending: { text: "text-pending-ink", dot: "bg-statuspending" },
  fail: { text: "text-fail-ink", dot: "bg-fail-ink" },
  idle: { text: "text-fog", dot: "bg-rule" },
  signal: { text: "text-signal-ink", dot: "bg-signal" },
};

const TONE_INK: Record<Tone, { text: string; dot: string }> = {
  ok: { text: "text-statusok", dot: "bg-statusok" },
  pending: { text: "text-statuspending", dot: "bg-statuspending" },
  fail: { text: "text-statusfail", dot: "bg-statusfail" },
  idle: { text: "text-paper/50", dot: "bg-paper/30" },
  signal: { text: "text-signal", dot: "bg-signal" },
};

/** A 6px square plus the status word. Pending blinks; nothing else moves. */
export function Status({
  tone,
  children,
  dark = false,
  className,
}: {
  tone: Tone;
  children: ReactNode;
  dark?: boolean;
  className?: string;
}) {
  const palette = (dark ? TONE_INK : TONE_PAPER)[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]",
        palette.text,
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0",
          palette.dot,
          tone === "pending" && "motion-safe:animate-blink",
        )}
      />
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Labels and facts                                                    */
/* ------------------------------------------------------------------ */

export function Label({
  children,
  className,
  dark = false,
}: {
  children: ReactNode;
  className?: string;
  dark?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-mono text-[11px] uppercase tracking-[0.16em]",
        dark ? "text-paper/50" : "text-fog",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** One machine fact: a label, a mono value, and an optional plain note. */
export function Fact({
  label,
  value,
  note,
  dark = false,
  emphasis = false,
}: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  dark?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] items-baseline gap-x-5 border-b py-3",
        dark ? "border-ruleinvert" : "border-rule",
      )}
    >
      <dt
        className={cn(
          "font-mono text-[12px]",
          dark ? "text-paper/50" : "text-fog",
        )}
      >
        {label}
      </dt>
      <dd className="min-w-0">
        <div
          className={cn(
            "break-words font-mono",
            emphasis ? "text-[15px] font-medium" : "text-[13px]",
            dark ? "text-paper/90" : "text-ink",
          )}
        >
          {value}
        </div>
        {note ? (
          <div
            className={cn(
              "mt-1 [overflow-wrap:anywhere] text-[13px] leading-snug",
              dark ? "text-paper/55" : "text-fog",
            )}
          >
            {note}
          </div>
        ) : null}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

export function Panel({
  label,
  aside,
  children,
  dark = false,
  className,
  id,
}: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  dark?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={typeof label === "string" ? label : undefined}
      className={cn(
        "min-w-0 border",
        dark
          ? "on-dark rain border-ruleinvert bg-ink text-paper"
          : "border-rule bg-paper text-ink",
        className,
      )}
    >
      <header
        className={cn(
          "flex min-h-12 items-center justify-between gap-4 border-b px-5 py-3 md:px-6",
          dark ? "border-ruleinvert" : "border-rule",
        )}
      >
        <Label dark={dark}>{label}</Label>
        {aside}
      </header>
      <div className="min-w-0 px-5 py-5 md:px-6 md:py-6">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "signal" | "ghost" | "danger" | "ghost-dark";

const BUTTON: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-paper hover:bg-signal hover:text-ink disabled:bg-rule disabled:text-fog",
  signal:
    "bg-signal text-ink hover:bg-ink hover:text-paper disabled:bg-rule disabled:text-fog",
  ghost:
    "border border-rule text-ink hover:border-ink disabled:text-fog disabled:hover:border-rule",
  danger:
    "border border-fail-ink/40 text-fail-ink hover:bg-fail-ink hover:text-paper disabled:border-rule disabled:text-fog disabled:hover:bg-transparent",
  "ghost-dark":
    "border border-ruleinvert text-paper hover:border-paper disabled:text-paper/40",
};

export function Button({
  variant = "primary",
  busy = false,
  arrow = false,
  children,
  className,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  busy?: boolean;
  arrow?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "group pressable relative inline-flex min-h-12 items-center justify-center gap-3 overflow-hidden whitespace-nowrap px-6 text-[15px] font-medium disabled:cursor-not-allowed disabled:active:scale-100",
        BUTTON[variant],
        className,
      )}
    >
      {children}
      {arrow ? (
        <span
          aria-hidden
          className="arrow font-mono group-hover:translate-x-1 group-disabled:translate-x-0"
        >
          &#8594;
        </span>
      ) : null}
      {busy ? <Scan /> : null}
    </button>
  );
}

/** In-flight indicator: a short signal bar crossing the bottom edge. */
export function Scan({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden",
        className,
      )}
    >
      <span className="block h-full w-1/4 bg-signal motion-safe:animate-scan" />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Failure                                                             */
/* ------------------------------------------------------------------ */

/** A refusal or error, always with its code and its sentence (PRD-F-016). */
export function FailureNotice({
  failure,
  onRetry,
  retryLabel = "Try again",
  dark = false,
}: {
  failure: Failure;
  onRetry?: () => void;
  retryLabel?: string;
  dark?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "border-l-2 py-3 pl-4",
        dark ? "border-statusfail" : "border-fail-ink",
      )}
    >
      <Status tone="fail" dark={dark}>
        {failure.code}
      </Status>
      <p
        className={cn(
          "mt-2 max-w-[60ch] leading-relaxed",
          dark ? "text-paper/90" : "text-ink",
        )}
      >
        {failure.sentence}
      </p>
      {failure.detail ? (
        <p
          className={cn(
            "mt-1 max-w-[60ch] break-words font-mono text-[12px]",
            dark ? "text-paper/55" : "text-fog",
          )}
        >
          {failure.detail}
        </p>
      ) : null}
      {onRetry && failure.retry ? (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "pressable mt-3 font-mono text-[11px] uppercase tracking-[0.16em] underline decoration-1 underline-offset-4",
            dark
              ? "text-paper hover:text-signal"
              : "text-ink hover:text-signal-ink",
          )}
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hashes and links                                                    */
/* ------------------------------------------------------------------ */

export function Hash({
  value,
  href,
  dark = false,
  full = false,
}: {
  value: string;
  href?: string | null;
  dark?: boolean;
  full?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_400);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <span className="inline-flex max-w-full items-baseline gap-2 font-mono">
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          title={value}
          className={cn(
            "min-w-0 truncate underline decoration-1 underline-offset-4",
            dark
              ? "decoration-paper/30 hover:text-signal"
              : "decoration-rule hover:text-signal-ink hover:decoration-signal-ink",
          )}
        >
          {full ? value : short(value, 10, 8)}
        </a>
      ) : (
        <span title={value} className="min-w-0 truncate">
          {full ? value : short(value, 10, 8)}
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => setCopied(true));
        }}
        aria-label={`Copy ${value}`}
        className={cn(
          "pressable shrink-0 text-[10px] uppercase tracking-[0.16em]",
          dark ? "text-paper/40 hover:text-paper" : "text-fog hover:text-ink",
        )}
      >
        {copied ? "copied" : "copy"}
      </button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/** Seconds until `target` (unix seconds), ticking once a second. */
export function useSecondsUntil(target: number | null): number | null {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (target === null) return;
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1_000,
    );
    return () => clearInterval(timer);
  }, [target]);
  return target === null ? null : target - now;
}

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

/** State-change swap: the outgoing view lifts away, the incoming one settles. */
export function Swap({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={id}
        className={className}
        initial={reduced ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
        transition={{ duration: 0.22, ease: EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
