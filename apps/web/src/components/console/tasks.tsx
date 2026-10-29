"use client";

import type { PublicConfig, TaskSummary } from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { amount, short } from "@/lib/format";
import { useHoldings, usePolicies } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useStagedAction } from "./action";
import { standing, symbolOf, tokenOf } from "./task/model";
import { Button, FailureNotice, Glyph, Label, Status, StatusBadge } from "./ui";

/**
 * Goal examples taken from the active Wallet Policy, so a chip never suggests an
 * amount the policy would refuse. Empty until a policy is active.
 */
function useGoalExamples(config: PublicConfig): string[] {
  const policies = usePolicies();
  const active = policies.data?.find((entry) => entry.status === "ACTIVE");
  if (!active) return [];
  const { activeAssets, services } = active.policy;
  const examples: string[] = [];
  for (const asset of activeAssets) {
    const input = tokenOf(config.tokens, asset.token);
    const cap = BigInt(asset.maxInputPerTask);
    if (!input || cap <= 0n) continue;
    const symbol = symbolOf(input);
    if (services.includes("SWAP")) {
      const output = config.tokens.find((token) => token !== input);
      if (output) {
        for (const size of [cap, cap / 2n]) {
          if (size > 0n)
            examples.push(
              `Swap ${amount(size, input.decimals, input.decimals)} ${symbol} to ${symbolOf(output)}`,
            );
        }
      }
    }
    if (services.includes("STAKE") && symbol === "CAKE")
      examples.push(
        `Stake ${amount(cap, input.decimals, input.decimals)} ${symbol}`,
      );
  }
  return [...new Set(examples)].slice(0, 4);
}

export function TaskComposer({
  config,
  maxLifetime,
}: {
  config: PublicConfig;
  maxLifetime: string;
}) {
  const { session, account, owner } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();
  const action = useStagedAction<string>();
  const examples = useGoalExamples(config);
  const holdings = useHoldings(config);
  const field = useRef<HTMLTextAreaElement>(null);
  const [goal, setGoal] = useState("");
  const [expiry, setExpiry] = useState("1800");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const attempted = useRef<{ goal: string; expiry: string } | null>(null);
  /* A `?goal=` link from a task page fills the field once. It never submits. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const prefill = params.get("goal");
    if (!prefill) return;
    setGoal(prefill.slice(0, 4000));
    params.delete("goal");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    field.current?.focus();
    field.current?.scrollIntoView({ block: "center" });
  }, []);
  const changeIntent = (nextGoal: string, nextExpiry: string) => {
    if (
      attempted.current &&
      (attempted.current.goal !== nextGoal.trim() ||
        attempted.current.expiry !== nextExpiry)
    ) {
      setRequestId(crypto.randomUUID());
      attempted.current = null;
    }
    action.reset();
  };
  const validExpiry =
    /^\d+$/u.test(expiry) &&
    BigInt(expiry) > 0n &&
    BigInt(expiry) <= BigInt(maxLifetime);
  const submit = () => {
    void action.run(async (advance) => {
      if (!session || !account || !owner) throw new Error("Sign in first.");
      if (!validExpiry || !goal.trim())
        throw new Error("Enter a goal and a permitted expiry.");
      advance("compile");
      attempted.current = { goal: goal.trim(), expiry };
      const result = await api.createTask(session.token, {
        clientRequestId: requestId,
        intent: {
          schemaVersion: "1",
          account,
          chainId: config.chainId,
          recipient: account,
          goal: goal.trim(),
          requestedExpirySeconds: expiry,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: ["session", owner, "tasks"],
      });
      attempted.current = null;
      setRequestId(crypto.randomUUID());
      router.push(`/app/tasks/${result.taskId}`);
      return result.taskId;
    });
  };
  return (
    <div className="space-y-5">
      <div>
        <Label>One goal · one mandate</Label>
        <h2 className="mt-2 max-w-[18ch] text-3xl font-semibold leading-[1.05] tracking-[-0.03em] md:text-5xl">
          Tell Perago what to do.
        </h2>
        <p className="mt-3 max-w-[62ch] text-fog">
          The planner proposes a swap or stake. Deterministic policy checks and
          a fresh onchain simulation decide whether it can proceed. No model
          output authorizes a transfer.
        </p>
      </div>
      <label className="block space-y-2">
        <Label className="block">Your goal</Label>
        <textarea
          ref={field}
          value={goal}
          maxLength={4000}
          rows={4}
          onChange={(event) => {
            changeIntent(event.target.value, expiry);
            setGoal(event.target.value);
          }}
          placeholder="Swap 0.005 WBNB to CAKE, with at least 1 CAKE out."
          className="w-full resize-y border border-rule bg-paper px-4 py-4 text-[17px] leading-relaxed placeholder:text-fog/70 focus:border-ink focus:outline-none"
        />
      </label>
      <p className="font-mono text-[11px] text-fog" aria-live="polite">
        {holdings.data
          ? `ACCOUNT HOLDS ${[
              ...config.tokens
                .map((token) => {
                  const held = holdings.data.tokens[token.symbol];
                  return held
                    ? `${amount(held.balance, token.decimals, token.decimals)} ${symbolOf(token)}`
                    : null;
                })
                .filter((value) => value !== null),
              `${amount(holdings.data.accountNative, 18, 18)} tBNB`,
            ].join(" · ")}`
          : holdings.isError
            ? "ACCOUNT HOLDINGS UNAVAILABLE"
            : "READING ACCOUNT HOLDINGS"}
      </p>
      {examples.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Label className="mr-1">Within your limits</Label>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                changeIntent(example, expiry);
                setGoal(example);
                field.current?.focus();
              }}
              className={cn(
                "pressable min-h-9 border px-3 font-mono text-[12px] transition-colors duration-150 hover:border-ink hover:bg-ink/[0.03]",
                goal === example ? "border-ink bg-ink/[0.04]" : "border-rule",
              )}
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-w-[13rem] flex-col gap-2">
          <Label>Deadline after signing (seconds)</Label>
          <input
            value={expiry}
            onChange={(event) => {
              changeIntent(goal, event.target.value);
              setExpiry(event.target.value);
            }}
            type="number"
            min="1"
            max={maxLifetime}
            className="border border-rule bg-paper px-3 py-3 font-mono text-sm focus:border-ink focus:outline-none"
            aria-invalid={!validExpiry}
          />
        </label>
        <Button
          arrow
          busy={action.busy}
          disabled={!goal.trim() || !validExpiry}
          onClick={submit}
        >
          Compile goal
        </Button>
      </div>
      <p className="font-mono text-[11px] text-fog">
        Recipient: your account only · chain {config.chainId} · max lifetime{" "}
        {maxLifetime}s
      </p>
      {action.state.phase === "failed" ? (
        <FailureNotice
          failure={action.state.failure}
          onRetry={() => action.reset()}
        />
      ) : null}
      {action.busy ? (
        <Status tone="pending">Compiling against your policy</Status>
      ) : null}
    </div>
  );
}

function kindText(task: TaskSummary): string {
  if (task.kind === "SWAP") return "Swap";
  if (task.kind === "STAKE") return "Stake";
  return task.status === "REJECTED_POLICY" ? "No plan" : "No plan yet";
}

const when = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function TaskLedger({ tasks }: { tasks: TaskSummary[] }) {
  const rows = tasks.map((task) => ({
    task,
    state: standing({
      status: task.status,
      mandateStatus: task.mandateStatus,
      executionStatus: task.executionStatus,
    }),
  }));
  const succeeded = rows.filter(
    (row) => row.state.label === "Succeeded",
  ).length;
  const blocked = rows.filter((row) => row.state.tone === "fail").length;
  return (
    <section aria-label="Recent tasks" className="border border-rule">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-rule px-5 py-4">
        <Label>Recent tasks</Label>
        <span className="font-mono text-[11px] text-fog">
          {succeeded} succeeded · {blocked} blocked or failed · {tasks.length}{" "}
          shown
        </span>
      </div>
      {tasks.length ? (
        <ol>
          {rows.map(({ task, state }, index) => (
            <li
              key={task.taskId}
              className="border-b border-rule last:border-b-0"
            >
              <Link
                href={`/app/tasks/${task.taskId}`}
                className="group pressable relative grid gap-x-4 gap-y-2 px-5 py-4 transition-colors duration-150 -outline-offset-2 hover:bg-ink/[0.03] focus-visible:bg-ink/[0.03] md:grid-cols-[2.5rem_minmax(0,1fr)_auto_1rem] md:items-center"
              >
                {state.tone === "fail" ? (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-0.5 bg-fail-ink"
                  />
                ) : null}
                <span className="hidden font-mono text-[11px] text-fog md:block">
                  {String(tasks.length - index).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium group-hover:text-signal-ink">
                    {task.goal}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-fog">
                    {kindText(task)} · {when.format(new Date(task.createdAt))} ·{" "}
                    {short(task.taskId)}
                  </span>
                </span>
                <span className="justify-self-start md:justify-self-end">
                  <StatusBadge
                    tone={state.tone}
                    glyph={state.glyph}
                    live={state.live}
                  >
                    {state.label}
                  </StatusBadge>
                </span>
                <Glyph
                  name="arrow"
                  className="hidden -translate-x-1 text-fog opacity-0 transition duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 motion-reduce:transition-none md:block"
                />
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-5 py-10 text-fog">
          No task yet. Your first one starts above.
        </div>
      )}
    </section>
  );
}
