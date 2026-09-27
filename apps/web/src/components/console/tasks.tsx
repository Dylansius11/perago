"use client";

import type { PublicConfig, TaskSummary } from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { short } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useStagedAction } from "./action";
import { Button, FailureNotice, Label, Status } from "./ui";

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
  const [goal, setGoal] = useState("");
  const [expiry, setExpiry] = useState("1800");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const attempted = useRef<{ goal: string; expiry: string } | null>(null);
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

function tone(status: string) {
  if (["SUCCEEDED", "AUTHORIZED", "ACTIVE"].includes(status))
    return "ok" as const;
  if (["FAILED", "REVOKED", "EXPIRED", "REJECTED"].includes(status))
    return "fail" as const;
  return "pending" as const;
}

export function TaskLedger({ tasks }: { tasks: TaskSummary[] }) {
  return (
    <section aria-label="Recent tasks" className="border border-rule">
      <div className="flex justify-between border-b border-rule px-5 py-4">
        <Label>Recent tasks</Label>
        <span className="font-mono text-[11px] text-fog">
          {tasks.length} shown
        </span>
      </div>
      {tasks.length ? (
        <ol>
          {tasks.map((task, index) => (
            <li
              key={task.taskId}
              className="border-b border-rule last:border-b-0"
            >
              <Link
                href={`/app/tasks/${task.taskId}`}
                className="group pressable grid gap-2 px-5 py-4 hover:bg-ink/[0.03] md:grid-cols-[3rem_minmax(0,1fr)_auto] md:items-center md:gap-4"
              >
                <span className="font-mono text-[11px] text-fog">
                  {String(tasks.length - index).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium group-hover:text-signal-ink">
                    {task.goal}
                  </span>
                  <span className="mt-0.5 block font-mono text-[11px] text-fog">
                    {task.kind ?? "Awaiting plan"} ·{" "}
                    {new Date(task.createdAt).toLocaleString()} ·{" "}
                    {short(task.taskId)}
                  </span>
                </span>
                <Status tone={tone(task.mandateStatus ?? task.status)}>
                  {task.mandateStatus ?? task.status}
                </Status>
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
