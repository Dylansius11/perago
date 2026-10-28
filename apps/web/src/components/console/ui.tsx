"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Route } from "next";
import Link from "next/link";
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
/* Glyphs and badges                                                   */
/* ------------------------------------------------------------------ */

export type GlyphName =
  | "check"
  | "cross"
  | "block"
  | "clock"
  | "draft"
  | "minus"
  | "arrow"
  | "dot";

/* Square caps and miter joins keep the marks inside the zero-radius system. */
const GLYPH: Record<GlyphName, ReactNode> = {
  check: <path d="M2 6.5 4.8 9.2 10 3" />,
  cross: <path d="M2.5 2.5 9.5 9.5M9.5 2.5 2.5 9.5" />,
  block: (
    <>
      <rect x="1.5" y="1.5" width="9" height="9" />
      <path d="M2 10 10 2" />
    </>
  ),
  clock: (
    <>
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6l1.8 1.2" />
    </>
  ),
  draft: <rect x="1.5" y="1.5" width="9" height="9" strokeDasharray="2 1.6" />,
  minus: <path d="M2.5 6h7" />,
  arrow: <path d="M2 6h8M7 3l3 3-3 3" />,
  dot: (
    <rect
      x="3.5"
      y="3.5"
      width="5"
      height="5"
      fill="currentColor"
      stroke="none"
    />
  ),
};

/** A 12px mark that carries meaning next to a word, so color is never the only signal. */
export function Glyph({
  name,
  className,
}: {
  name: GlyphName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={cn("size-3 shrink-0", className)}
    >
      {GLYPH[name]}
    </svg>
  );
}

const BADGE_PAPER: Record<Tone, string> = {
  ok: "border-ok-ink/30 bg-ok-ink/[0.07] text-ok-ink",
  pending: "border-pending-ink/30 bg-pending-ink/[0.07] text-pending-ink",
  fail: "border-fail-ink/35 bg-fail-ink/[0.07] text-fail-ink",
  idle: "border-rule bg-ink/[0.03] text-fog",
  signal: "border-signal-ink/35 bg-signal/10 text-signal-ink",
};

const BADGE_INK: Record<Tone, string> = {
  ok: "border-statusok/35 bg-statusok/10 text-statusok",
  pending: "border-statuspending/35 bg-statuspending/10 text-statuspending",
  fail: "border-statusfail/35 bg-statusfail/10 text-statusfail",
  idle: "border-ruleinvert text-paper/60",
  signal: "border-signal/40 bg-signal/10 text-signal",
};

/** A status as a hairline chip: a mark and a word, tinted by tone. `live` blinks the mark only. */
export function StatusBadge({
  tone,
  glyph,
  children,
  dark = false,
  live = false,
  className,
}: {
  tone: Tone;
  glyph: GlyphName;
  children: ReactNode;
  dark?: boolean;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em]",
        (dark ? BADGE_INK : BADGE_PAPER)[tone],
        className,
      )}
    >
      <Glyph name={glyph} className={cn(live && "motion-safe:animate-blink")} />
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

function Chevron({ dark = false }: { dark?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      className={cn(
        "size-3 shrink-0 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none",
        dark ? "text-paper/50" : "text-fog",
      )}
    >
      <path d="M4.5 2.5 8 6 4.5 9.5" />
    </svg>
  );
}

/**
 * A hairline panel. `collapsible` turns the header into the disclosure
 * summary; `defaultOpen` is read once, so a page that polls never closes
 * a panel the reader is looking at.
 */
export function Panel({
  label,
  aside,
  children,
  dark = false,
  className,
  id,
  collapsible = false,
  defaultOpen = true,
}: {
  label: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  dark?: boolean;
  className?: string;
  id?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [initiallyOpen] = useState(defaultOpen);
  const shell = cn(
    "min-w-0 border",
    dark
      ? "on-dark rain border-ruleinvert bg-ink text-paper"
      : "border-rule bg-paper text-ink",
    className,
  );
  if (collapsible) {
    return (
      <details id={id} open={initiallyOpen} className={cn("group", shell)}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 md:px-6 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-3">
            <Chevron dark={dark} />
            <Label dark={dark}>{label}</Label>
          </span>
          {aside}
        </summary>
        <div
          className={cn(
            "min-w-0 border-t px-5 py-5 md:px-6 md:py-6",
            dark ? "border-ruleinvert" : "border-rule",
          )}
        >
          {children}
        </div>
      </details>
    );
  }
  return (
    <section
      id={id}
      aria-label={typeof label === "string" ? label : undefined}
      className={shell}
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

/** An inline disclosure under a hairline, for the rest of a list the reader may not need. */
export function Disclosure({
  label,
  hint,
  defaultOpen = false,
  children,
  dark = false,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  dark?: boolean;
  className?: string;
}) {
  const [initiallyOpen] = useState(defaultOpen);
  return (
    <details
      open={initiallyOpen}
      className={cn(
        "group border-t",
        dark ? "border-ruleinvert" : "border-rule",
        className,
      )}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.12em]",
            dark ? "text-signal" : "text-signal-ink",
          )}
        >
          <Chevron dark={dark} />
          {label}
        </span>
        {hint ? (
          <span
            className={cn(
              "font-mono text-[11px]",
              dark ? "text-paper/50" : "text-fog",
            )}
          >
            {hint}
          </span>
        ) : null}
      </summary>
      <div>{children}</div>
    </details>
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

function buttonClass(variant: ButtonVariant, className?: string) {
  return cn(
    "group pressable relative inline-flex min-h-12 items-center justify-center gap-3 overflow-hidden whitespace-nowrap px-6 text-[15px] font-medium disabled:cursor-not-allowed disabled:active:scale-100",
    BUTTON[variant],
    className,
  );
}

function ArrowMark() {
  return (
    <span
      aria-hidden
      className="arrow font-mono group-hover:translate-x-1 group-disabled:translate-x-0"
    >
      &#8594;
    </span>
  );
}

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
      className={buttonClass(variant, className)}
    >
      {children}
      {arrow ? <ArrowMark /> : null}
      {busy ? <Scan /> : null}
    </button>
  );
}

/** A link with button styling: in-app navigation by default, a new tab when `external`. */
export function ButtonLink({
  href,
  variant = "primary",
  arrow = false,
  external = false,
  children,
  className,
}: {
  href: string;
  variant?: ButtonVariant;
  arrow?: boolean;
  external?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const content = (
    <>
      {children}
      {arrow ? <ArrowMark /> : null}
    </>
  );
  return external ? (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={buttonClass(variant, className)}
    >
      {content}
    </a>
  ) : (
    <Link href={href as Route} className={buttonClass(variant, className)}>
      {content}
    </Link>
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
  wrap = false,
}: {
  value: string;
  href?: string | null;
  dark?: boolean;
  full?: boolean;
  /** Break a full value across lines instead of truncating it. */
  wrap?: boolean;
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
            wrap ? "min-w-0 break-all" : "min-w-0 truncate",
            "underline decoration-1 underline-offset-4",
            dark
              ? "decoration-paper/30 hover:text-signal"
              : "decoration-rule hover:text-signal-ink hover:decoration-signal-ink",
          )}
        >
          {full ? value : short(value, 10, 8)}
        </a>
      ) : (
        <span
          title={value}
          className={wrap ? "min-w-0 break-all" : "min-w-0 truncate"}
        >
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
          "pressable -my-3 shrink-0 px-1 py-3 text-[10px] uppercase tracking-[0.16em]",
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
