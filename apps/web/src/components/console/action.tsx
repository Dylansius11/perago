"use client";

import { motion, useReducedMotion } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { type Failure, toFailure } from "@/lib/failure";
import { cn } from "@/lib/utils";
import { EASE, Status } from "./ui";

/*
 * Every write the console makes is a staged action: a fixed list of steps,
 * each either a wallet prompt or a chain/API wait, shown before the first
 * prompt appears so the owner knows exactly what will be asked and in which
 * order. A declined prompt is its own recoverable state, never a crash.
 */

export type Step = {
  id: string;
  title: string;
  /** What the wallet or chain will show, in plain words. */
  detail: string;
  /** A wallet prompt, as opposed to waiting on the chain or the API. */
  prompt?: boolean;
};

export type ActionState<T> =
  | { phase: "idle" }
  | { phase: "running"; step: string }
  | { phase: "done"; result: T }
  | { phase: "failed"; step: string; failure: Failure };

export function useStagedAction<T>() {
  const [state, setState] = useState<ActionState<T>>({ phase: "idle" });
  const current = useRef<string>("");

  const run = useCallback(
    async (fn: (advance: (step: string) => void) => Promise<T>) => {
      const advance = (step: string) => {
        current.current = step;
        setState({ phase: "running", step });
      };
      try {
        const result = await fn(advance);
        setState({ phase: "done", result });
        return result;
      } catch (error) {
        setState({
          phase: "failed",
          step: current.current,
          failure: toFailure(error),
        });
        return null;
      }
    },
    [],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { state, run, reset, busy: state.phase === "running" };
}

/**
 * The ordered steps of one action with live progress. Completed steps keep a
 * check, the active one shows who is waiting (you, or the chain), and a
 * failed step keeps its place so a retry resumes from what the owner saw.
 */
export function StepList<T>({
  steps,
  state,
  dark = false,
}: {
  steps: Step[];
  state: ActionState<T>;
  dark?: boolean;
}) {
  const reduced = useReducedMotion();
  const activeIndex =
    state.phase === "running" || state.phase === "failed"
      ? steps.findIndex((step) => step.id === state.step)
      : state.phase === "done"
        ? steps.length
        : -1;

  return (
    <ol className={cn("border-t", dark ? "border-ruleinvert" : "border-rule")}>
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex && state.phase === "running";
        const failed = index === activeIndex && state.phase === "failed";
        return (
          <li
            key={step.id}
            className={cn(
              "relative grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b py-3.5",
              dark ? "border-ruleinvert" : "border-rule",
            )}
          >
            <span
              className={cn(
                "font-mono text-[12px]",
                done || active
                  ? dark
                    ? "text-signal"
                    : "text-signal-ink"
                  : dark
                    ? "text-paper/40"
                    : "text-fog",
              )}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  "font-medium",
                  dark ? "text-paper" : "text-ink",
                  !done && !active && !failed && "opacity-70",
                )}
              >
                {step.title}
              </p>
              <p
                className={cn(
                  "mt-0.5 text-[13px] leading-snug",
                  dark ? "text-paper/55" : "text-fog",
                )}
              >
                {step.detail}
              </p>
            </div>
            <span className="self-center">
              {done ? (
                <Status tone="ok" dark={dark}>
                  Done
                </Status>
              ) : active ? (
                <Status tone="pending" dark={dark}>
                  {step.prompt ? "In your wallet" : "Waiting"}
                </Status>
              ) : failed ? (
                <Status tone="fail" dark={dark}>
                  Stopped
                </Status>
              ) : (
                <Status tone="idle" dark={dark}>
                  {step.prompt ? "Wallet" : "Chain"}
                </Status>
              )}
            </span>
            {active ? (
              <motion.span
                aria-hidden
                {...(reduced ? {} : { layoutId: "step-active" })}
                transition={{ duration: 0.25, ease: EASE }}
                className="absolute inset-y-0 -left-px w-0.5 bg-signal"
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
