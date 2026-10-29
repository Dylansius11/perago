"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import { Label } from "../ui";
import type { DiffLine, Mode } from "./diff";

/*
 * Form parts for the policy editor. Each field owns its label, its unit, and
 * its inline error so the rule that failed is read beside the value that
 * broke it, never in a banner somewhere else.
 */

const MODE_TEXT: Record<Mode, { label: string; note: string; dot: string }> = {
  active: {
    label: "Active",
    note: "Perago may spend this token, up to the limits below.",
    dot: "bg-signal",
  },
  protected: {
    label: "Protected",
    note: "Never spendable. No task can use it as input.",
    dot: "bg-ok-ink",
  },
  off: {
    label: "Off",
    note: "Not spendable, and not protected. Leaving a token off removes that protection.",
    dot: "bg-fog",
  },
};

const MODES = ["active", "protected", "off"] as const;

export function ModeControl({
  symbol,
  mode,
  disabled,
  onChange,
}: {
  symbol: string;
  mode: Mode;
  disabled: boolean;
  onChange: (mode: Mode) => void;
}) {
  const name = useId();
  return (
    <div>
      <div
        role="radiogroup"
        aria-label={`${symbol} role in this policy`}
        className="grid grid-cols-3 border border-rule"
      >
        {MODES.map((option) => {
          const selected = option === mode;
          return (
            <label
              key={option}
              className={cn(
                "pressable relative flex min-h-11 cursor-pointer items-center justify-center gap-2 border-l border-rule px-2 font-mono text-[11px] uppercase tracking-[0.14em] first:border-l-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-signal-ink",
                selected
                  ? "bg-ink text-paper"
                  : "text-fog hover:bg-ink/[0.03] hover:text-ink",
                disabled && "cursor-not-allowed opacity-60",
              )}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option)}
              />
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0",
                  selected ? MODE_TEXT[option].dot : "bg-rule",
                )}
              />
              {MODE_TEXT[option].label}
            </label>
          );
        })}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-fog">
        {MODE_TEXT[mode].note}
      </p>
    </div>
  );
}

export function AmountField({
  label,
  unit,
  value,
  error,
  disabled,
  hint,
  hideLabel = false,
  inputMode = "decimal",
  onChange,
  onMax,
}: {
  label: string;
  unit: string;
  value: string;
  error?: string | undefined;
  disabled: boolean;
  hint?: string | undefined;
  /** Keep the label for assistive tech only, when the row already names the field. */
  hideLabel?: boolean;
  inputMode?: "decimal" | "numeric";
  onChange: (value: string) => void;
  /** Adds a MAX control that fills the field with the largest allowed value. */
  onMax?: () => void;
}) {
  const id = useId();
  const note = `${id}-note`;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "block"}>
        <Label>{label}</Label>
      </label>
      <div
        className={cn(
          hideLabel ? "" : "mt-1.5",
          "flex items-stretch border focus-within:border-ink",
          error ? "border-fail-ink" : "border-rule",
          disabled && "bg-ink/[0.03]",
        )}
      >
        <input
          id={id}
          inputMode={inputMode}
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? note : undefined}
          onChange={(event) => onChange(event.target.value.trim())}
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[15px] tabular-nums outline-none disabled:text-fog"
        />
        {onMax ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onMax}
            aria-label={`Use the full ${unit} balance`}
            className="pressable border-l border-rule px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-fog hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Max
          </button>
        ) : null}
        <span className="flex items-center border-l border-rule px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
          {unit}
        </span>
      </div>
      <p
        id={note}
        className={cn(
          "mt-1.5 min-h-4 text-[12px] leading-snug",
          error ? "text-fail-ink" : "text-fog",
        )}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

/** Quick picks for a numeric field; the typed value always wins. */
export function Presets({
  label,
  options,
  current,
  disabled,
  onPick,
}: {
  label: string;
  options: { value: string; text: string }[];
  current: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <fieldset
      disabled={disabled}
      className="flex min-w-0 flex-wrap items-center gap-2 border-0 p-0"
    >
      <legend className="sr-only">{label}</legend>
      <Label>Quick set</Label>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          disabled={disabled}
          aria-pressed={current === option.value}
          onClick={() => onPick(option.value)}
          className={cn(
            "pressable min-h-8 border px-2.5 font-mono text-[11px] uppercase tracking-[0.12em] disabled:cursor-not-allowed disabled:opacity-60",
            current === option.value
              ? "border-ink bg-ink text-paper"
              : "border-rule text-fog hover:border-ink hover:text-ink",
          )}
        >
          {option.text}
        </button>
      ))}
    </fieldset>
  );
}

/** The exact changes the owner is about to review, old value first. */
export function DiffSummary({
  lines,
  baseVersion,
}: {
  lines: DiffLine[];
  baseVersion: string | null;
}) {
  return (
    <section aria-label="Changes from the active policy" aria-live="polite">
      <div className="border border-rule">
        <div className="flex items-center justify-between gap-4 border-b border-rule px-4 py-2.5">
          <Label>
            {baseVersion ? `Changes from v${baseVersion}` : "Your first policy"}
          </Label>
          <span className="font-mono text-[11px] text-fog">
            {lines.length === 0
              ? "none"
              : `${lines.length} change${lines.length === 1 ? "" : "s"}`}
          </span>
        </div>
        {lines.length === 0 ? (
          <p className="px-4 py-3 text-[14px] leading-snug text-fog">
            No limits differ from v{baseVersion}. Activating again would renew
            the 24-hour session without changing what Perago may do.
          </p>
        ) : (
          <dl>
            {lines.map((line) => (
              <div
                key={line.label}
                className="grid grid-cols-1 gap-x-4 gap-y-0.5 border-b border-rule px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]"
              >
                <dt className="font-mono text-[12px] text-fog">{line.label}</dt>
                <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 font-mono text-[13px] tabular-nums">
                  <span className="text-fog">{line.from}</span>
                  <span aria-hidden className="text-fog">
                    &#8594;
                  </span>
                  <span className="sr-only">to</span>
                  <span className="font-medium text-ink">{line.to}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </section>
  );
}
