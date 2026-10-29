"use client";

import type { TaskDetail } from "@perago/sdk";
import { duration, utc } from "@/lib/format";
import { cn } from "@/lib/utils";
import { fundsHref } from "../funds/model";
import {
  Button,
  ButtonLink,
  Fact,
  Glyph,
  Hash,
  Label,
  StatusBadge,
  type Tone,
} from "../ui";
import type {
  Reason,
  Rich,
  SelfWithdrawHint,
  Step,
  StepState,
  Verdict,
} from "./model";

/** Renders rich text; a part with a title is a scaled amount whose exact value is one hover away. */
export function RichText({ rich }: { rich: Rich }) {
  let offset = 0;
  return (
    <>
      {rich.map((part) => {
        if (typeof part === "string") {
          offset += part.length;
          return part;
        }
        const key = offset;
        offset += part.text.length;
        return (
          <span
            key={key}
            title={part.title}
            className="underline decoration-current/40 decoration-dotted decoration-1 underline-offset-[6px]"
          >
            {part.text}
          </span>
        );
      })}
    </>
  );
}

const BAR: Record<Tone, { paper: string; ink: string }> = {
  ok: { paper: "bg-ok-ink", ink: "bg-statusok" },
  pending: { paper: "bg-statuspending", ink: "bg-statuspending" },
  fail: { paper: "bg-fail-ink", ink: "bg-statusfail" },
  idle: { paper: "bg-rule", ink: "bg-paper/30" },
  signal: { paper: "bg-signal", ink: "bg-signal" },
};

function ReasonItem({ reason, fail }: { reason: Reason; fail: boolean }) {
  return (
    <li
      className={cn(
        "border-l-2 py-4 pr-4 pl-4",
        fail
          ? "border-fail-ink bg-fail-ink/[0.045]"
          : "border-rule bg-ink/[0.025]",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Glyph
          name={fail ? "cross" : "minus"}
          className={fail ? "text-fail-ink" : "text-fog"}
        />
        {reason.label ? (
          <span className="font-medium">{reason.label}</span>
        ) : null}
        <span
          className={cn(
            "font-mono text-[11px] uppercase tracking-[0.12em]",
            fail ? "text-fail-ink" : "text-fog",
          )}
        >
          {reason.code}
        </span>
      </div>
      <p className="mt-2 max-w-[56ch] text-lg leading-snug md:text-xl">
        <RichText rich={reason.sentence} />
      </p>
      {reason.observed && reason.limit ? (
        <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-2">
          <div>
            <dt>
              <Label>Observed</Label>
            </dt>
            <dd className="mt-0.5 font-mono text-[15px] font-medium">
              <RichText rich={reason.observed} />
            </dd>
          </div>
          <div>
            <dt>
              <Label>Limit</Label>
            </dt>
            <dd className="mt-0.5 font-mono text-[15px] font-medium">
              <RichText rich={reason.limit} />
            </dd>
          </div>
        </dl>
      ) : null}
    </li>
  );
}

/**
 * The answer first: what happened to this task, in one sentence, from API state
 * only. Success is the one state drawn on ink; everything else stays on paper.
 */
export function VerdictHero({
  task,
  verdict,
  executionHref,
  suggestedGoal,
  selfWithdraw,
  onCheckAgain,
  checking = false,
}: {
  task: TaskDetail;
  verdict: Verdict;
  /** Explorer base for transactions, or null when no public explorer applies. */
  executionHref: string | null;
  suggestedGoal: string | null;
  /** Set when the refused recipient was the owner's own wallet. */
  selfWithdraw: SelfWithdrawHint | null;
  onCheckAgain: () => void;
  checking?: boolean;
}) {
  const dark = verdict.kind === "succeeded";
  const { tone, label, glyph, live } = verdict.standing;
  const failing = tone === "fail";
  const executionTx = task.execution?.transactions.execution ?? null;
  const explorerUrl =
    executionHref && executionTx ? `${executionHref}${executionTx}` : null;
  return (
    <section
      aria-label="Task verdict"
      className={cn(
        "relative border",
        dark
          ? "on-dark rain border-ruleinvert bg-ink text-paper"
          : "border-rule bg-paper text-ink",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 top-0 h-0.5",
          BAR[tone][dark ? "ink" : "paper"],
        )}
      />
      <div className="grid md:grid-cols-12">
        <div className="min-w-0 px-5 py-7 md:col-span-8 md:px-8 md:py-10">
          <div role="status" aria-live="polite" aria-atomic="true">
            <StatusBadge tone={tone} glyph={glyph} dark={dark} live={live}>
              {label}
            </StatusBadge>
            <h1 className="mt-5 max-w-[20ch] text-4xl font-semibold leading-[1.02] tracking-[-0.035em] md:text-6xl">
              <RichText rich={verdict.headline} />
            </h1>
          </div>
          {verdict.detail ? (
            <p
              className={cn(
                "mt-4 flex max-w-[56ch] items-start gap-2.5 text-lg leading-snug",
                dark ? "text-paper/85" : "text-fog",
              )}
            >
              {verdict.kind === "succeeded" ? (
                <Glyph name="check" className="mt-[7px] text-statusok" />
              ) : null}
              {verdict.detail}
            </p>
          ) : null}
          {verdict.reasons.length > 0 ? (
            <ul className="mt-6 max-w-[64ch] space-y-3">
              {verdict.reasons.map((reason) => (
                <ReasonItem key={reason.code} reason={reason} fail={failing} />
              ))}
            </ul>
          ) : null}
          {verdict.note ? (
            <p className="mt-6 flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.12em]">
              <Glyph name="minus" className="text-fog" />
              {verdict.note}
            </p>
          ) : null}
          <VerdictActions
            task={task}
            verdict={verdict}
            suggestedGoal={suggestedGoal}
            selfWithdraw={selfWithdraw}
            explorerUrl={explorerUrl}
            onCheckAgain={onCheckAgain}
            checking={checking}
          />
        </div>
        <aside
          className={cn(
            "min-w-0 border-t px-5 py-7 md:col-span-4 md:border-t-0 md:border-l md:px-6 md:py-10",
            dark ? "border-ruleinvert" : "border-rule",
          )}
        >
          <Label dark={dark}>Your goal</Label>
          <p className="mt-2 mb-5 text-[17px] leading-snug [overflow-wrap:anywhere]">
            &ldquo;{task.goal}&rdquo;
          </p>
          <dl
            className={cn(
              "border-t",
              dark ? "border-ruleinvert" : "border-rule",
            )}
          >
            {verdict.elapsedSeconds !== null ? (
              <Fact
                dark={dark}
                emphasis
                label="signature to finish"
                value={duration(verdict.elapsedSeconds)}
                note={
                  verdict.kind === "succeeded"
                    ? "From the accepted signature to the final onchain state."
                    : undefined
                }
              />
            ) : null}
            {executionTx ? (
              <Fact
                dark={dark}
                label="execution tx"
                value={
                  <Hash dark={dark} value={executionTx} href={explorerUrl} />
                }
              />
            ) : null}
            <Fact
              dark={dark}
              label="task"
              value={<Hash dark={dark} value={task.taskId} />}
            />
            <Fact
              dark={dark}
              label="intent"
              value={<Hash dark={dark} value={task.intentHash} />}
            />
            <Fact dark={dark} label="updated" value={utc(task.updatedAt)} />
          </dl>
        </aside>
      </div>
    </section>
  );
}

function VerdictActions({
  task,
  verdict,
  suggestedGoal,
  selfWithdraw,
  explorerUrl,
  onCheckAgain,
  checking,
}: {
  task: TaskDetail;
  verdict: Verdict;
  suggestedGoal: string | null;
  selfWithdraw: SelfWithdrawHint | null;
  explorerUrl: string | null;
  onCheckAgain: () => void;
  checking: boolean;
}) {
  const goalHref = (goal: string) => `/app?goal=${encodeURIComponent(goal)}`;
  if (verdict.kind === "simulation-blocked") {
    return (
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <ButtonLink arrow href="/app#funds">
          Wrap more WBNB
        </ButtonLink>
        <ButtonLink variant="ghost" href={goalHref(task.goal)}>
          Change the goal
        </ButtonLink>
        <Button variant="ghost" busy={checking} onClick={onCheckAgain}>
          Check again
        </Button>
      </div>
    );
  }
  if (verdict.kind === "blocked") {
    return (
      <div className="mt-8">
        {selfWithdraw ? (
          <div className="mb-6 max-w-[56ch] border-l-2 border-signal py-1 pl-4">
            <p className="text-[15px] leading-snug">
              Moving funds to your own wallet is an owner action, not a task.
            </p>
            <ButtonLink
              arrow
              className="mt-3"
              href={fundsHref({
                symbol: selfWithdraw.symbol,
                amount: selfWithdraw.amount,
              })}
            >
              Open Funds
            </ButtonLink>
          </div>
        ) : null}
        {suggestedGoal ? (
          <p className="mb-4 max-w-[56ch] text-[15px] text-fog">
            A goal inside your limits:{" "}
            <span className="font-mono text-ink">{suggestedGoal}</span>
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row">
          {suggestedGoal ? (
            <ButtonLink arrow href={goalHref(suggestedGoal)}>
              Use this goal
            </ButtonLink>
          ) : null}
          <ButtonLink
            href="/app#policy"
            variant={suggestedGoal || selfWithdraw ? "ghost" : "primary"}
          >
            Change limits
          </ButtonLink>
        </div>
      </div>
    );
  }
  if (verdict.kind === "draft") {
    return (
      <div className="mt-8">
        <ButtonLink arrow href={goalHref(task.goal)}>
          Try this goal again
        </ButtonLink>
      </div>
    );
  }
  if (verdict.kind === "succeeded" && explorerUrl) {
    return (
      <div className="mt-8">
        <ButtonLink external arrow variant="ghost-dark" href={explorerUrl}>
          View execution on BscScan
        </ButtonLink>
      </div>
    );
  }
  if (
    verdict.kind === "failed" ||
    verdict.kind === "revoked" ||
    verdict.kind === "expired" ||
    verdict.kind === "cancelled"
  ) {
    return (
      <div className="mt-8">
        <ButtonLink arrow variant="ghost" href="/app">
          Start a new task
        </ButtonLink>
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

const MARK: Record<StepState, string> = {
  done: "bg-ok-ink text-paper",
  current: "border border-signal-ink bg-paper text-signal-ink",
  failed: "bg-fail-ink text-paper",
  todo: "border border-rule bg-paper text-transparent",
};

const SEGMENT: Record<StepState, string> = {
  done: "bg-ok-ink",
  current: "bg-signal",
  failed: "bg-fail-ink",
  todo: "bg-rule",
};

function StepMark({ step }: { step: Step }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center",
        MARK[step.state],
      )}
    >
      {step.state === "done" ? <Glyph name="check" /> : null}
      {step.state === "failed" ? <Glyph name="cross" /> : null}
      {step.state === "current" ? (
        <Glyph
          name="dot"
          className={cn(step.live && "motion-safe:animate-blink")}
        />
      ) : null}
    </span>
  );
}

/** Seven fixed steps, each marked done, current, failed, or not reached: derived, never assumed. */
export function LifecycleStepper({ steps }: { steps: Step[] }) {
  return (
    <nav aria-label="Task lifecycle">
      <ol className="grid border border-rule bg-paper md:grid-cols-7">
        {steps.map((step) => (
          <li
            key={step.key}
            aria-current={step.state === "current" ? "step" : undefined}
            className={cn(
              "relative flex items-center gap-3 border-b border-rule py-3 pr-4 pl-5 last:border-b-0 md:flex-col md:items-start md:gap-3 md:border-r md:border-b-0 md:px-4 md:pt-5 md:pb-4 md:last:border-r-0",
              step.state === "failed" && "bg-fail-ink/[0.045]",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-0 left-0 h-full w-0.5 transition-colors duration-200 motion-reduce:transition-none md:h-0.5 md:w-full",
                SEGMENT[step.state],
              )}
            />
            <StepMark step={step} />
            <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3 md:block">
              <span
                className={cn(
                  "block text-[15px] font-medium leading-tight",
                  step.state === "todo" && "text-fog",
                )}
              >
                {step.label}
              </span>
              <span
                className={cn(
                  "block font-mono text-[11px] uppercase tracking-[0.1em] md:mt-1",
                  step.state === "failed"
                    ? "text-fail-ink"
                    : step.state === "done"
                      ? "text-ok-ink"
                      : step.state === "current"
                        ? "text-signal-ink"
                        : "text-fog/80",
                )}
              >
                {step.detail}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
