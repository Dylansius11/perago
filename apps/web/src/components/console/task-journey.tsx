"use client";

import {
  type Address,
  type ExecutionReceipt,
  encodeAccountExecute,
  getTaskMandateTypedData,
  type MandatePrepared,
  mandateExecutorAbi,
  type PublicConfig,
  REASON_MESSAGES,
  type SimulationResult,
  type TaskDetail,
} from "@perago/sdk";
import {
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits } from "viem";
import { getPublicClient, signTypedData } from "wagmi/actions";
import { ApiError, api } from "@/lib/api";
import { assertPreparedMandate } from "@/lib/authority";
import { toFailure } from "@/lib/failure";
import { duration, utc } from "@/lib/format";
import {
  type AutomaticStepInput,
  allowanceReady,
  automaticStep,
  mandateStale,
  type PromptCount,
  promptCount,
  restoreAmount,
  rollingCap,
} from "@/lib/journey";
import {
  useHoldings,
  usePolicies,
  usePublicConfig,
  useTask,
} from "@/lib/queries";
import {
  type RootStage,
  sendRootOperation,
  sponsorFor,
} from "@/lib/root-operation";
import { useSession } from "@/lib/session";
import { assertWalletVenue } from "@/lib/venue";
import { CHAIN_ID, wagmiConfig } from "@/lib/wagmi";
import { type Step, StepList, useStagedAction } from "./action";
import {
  Button,
  Fact,
  FailureNotice,
  Hash,
  Label,
  Panel,
  Status,
  useSecondsUntil,
} from "./ui";
import { WalletGate } from "./wallet-gate";

/*
 * The task journey never invents an execution result. The API owns planning,
 * simulation, mandate freshness, queue state, and the finalized receipt; the
 * wallet only signs the exact EIP-712 payload the API prepared.
 */
type PreparedMandate = MandatePrepared;

function statusTone(status: string): "ok" | "pending" | "fail" | "idle" {
  if (status === "SUCCEEDED" || status === "PASSED") return "ok";
  if (["FAILED", "REVOKED", "EXPIRED", "REVERTED", "REJECTED"].includes(status))
    return "fail";
  if (
    ["DRAFT", "READY_TO_SIMULATE", "SIMULATED", "READY_TO_SIGN"].includes(
      status,
    )
  )
    return "idle";
  return "pending";
}

function reason(code: string | null): string | null {
  if (!code) return null;
  return code in REASON_MESSAGES
    ? REASON_MESSAGES[code as keyof typeof REASON_MESSAGES]
    : null;
}

function DateFact({ label, seconds }: { label: string; seconds: string }) {
  return (
    <Fact
      label={label}
      value={utc(Number(seconds))}
      note={`${seconds} unix seconds`}
    />
  );
}
function tokenAmount(
  value: string,
  address: string,
  config: PublicConfig | undefined,
): string {
  const token = config?.tokens.find(
    (item) => item.address.toLowerCase() === address.toLowerCase(),
  );
  return token
    ? `${formatUnits(BigInt(value), token.decimals)} ${token.symbol}`
    : `${value} base units`;
}

/*
 * The allowance story in one place: what the smart account already lets the
 * executor pull for this task's input token, what the active wallet policy may
 * restore, and how many wallet prompts that honestly costs.
 */
type AllowanceStatus = {
  token: Address | null;
  symbol: string | null;
  current: bigint | null;
  needed: bigint | null;
  covered: boolean;
  needsRestore: boolean;
  restore: bigint | null;
  cap: bigint | null;
  policyLoaded: boolean;
  blockedByPolicy: boolean;
  prompts: PromptCount;
};

/** One plain sentence for the allowance, shared by the summary and the review. */
function allowanceSentence(allowance: AllowanceStatus): string {
  if (allowance.current === null)
    return "Reading the smart account's allowance to the executor.";
  if (allowance.covered)
    return "Covers what this task spends, so nothing extra is approved.";
  if (allowance.restore !== null)
    return "Short, so signing first restores the active wallet policy's rolling cap for this token.";
  if (!allowance.policyLoaded)
    return "Short, and the active wallet policy is still loading.";
  return "Short, and the active wallet policy's cap for this token cannot cover this task. Change the plan or raise the cap.";
}

/** Restore progress uses its own step ids so the mandate signature keeps its own position. */
function restoreStepId(stage: RootStage, sponsored: boolean): string {
  if (stage === "confirm") return "restore-confirm";
  if (stage === "send" && !sponsored) return "restore-send";
  return "restore-sign";
}

/** Every prompt and wait of one signature, restore included, listed before the first prompt appears. */
function signSteps(input: { restore: boolean; sponsored: boolean }): Step[] {
  return [
    ...(input.restore
      ? [
          {
            id: "restore-sign",
            title: "Sign the allowance UserOperation",
            detail:
              "The smart account approves the active wallet policy's rolling cap for this token to the executor.",
            prompt: true,
          },
          {
            id: "restore-send",
            title: input.sponsored
              ? "Submit through the sponsored bundler"
              : "Send through EntryPoint",
            detail: input.sponsored
              ? "The API submits the signed UserOperation to the bundler. No wallet prompt."
              : "Your owner wallet pays network gas.",
            prompt: !input.sponsored,
          },
          {
            id: "restore-confirm",
            title: "Confirm the restored allowance",
            detail:
              "The token allowance is read from chain again before anything is signed.",
          },
        ]
      : []),
    {
      id: "sign",
      title: "Sign the exact EIP-712 TaskMandate",
      detail: "Your wallet signs the displayed root-owner mandate terms.",
      prompt: true,
    },
    {
      id: "submit",
      title: "Submit signature to the API",
      detail:
        "The API rechecks the exact path and MandateExecutor authorization before queuing.",
    },
    {
      id: "queue",
      title: "Read queue state",
      detail:
        "Queued is not execution success; this page continues polling the API.",
    },
  ];
}

/** The top line answer: what leaves the account, what comes back, when, and what the wallet is asked. */
function JourneySummary({
  task,
  prepared,
  allowance,
}: {
  task: TaskDetail;
  prepared: PreparedMandate | null;
  allowance: AllowanceStatus;
}) {
  const config = usePublicConfig();
  const mandate = prepared?.mandate ?? task.mandate?.mandate ?? null;
  const simulation = prepared?.simulation ?? task.simulation?.result ?? null;
  const action = simulation?.action ?? null;
  const planned = task.plan?.action ?? null;
  const spend =
    mandate?.maxInput ?? simulation?.maxInput ?? planned?.inputAmount ?? null;
  const spendToken =
    mandate?.inputToken ??
    simulation?.inputToken ??
    planned?.inputToken ??
    null;
  const minimum =
    mandate?.minOutput ??
    (action
      ? action.kind === "SWAP"
        ? action.minAmountOut
        : action.minPositionOut
      : null);
  const outputToken =
    mandate?.outputToken ??
    simulation?.outputToken ??
    (planned?.kind === "SWAP" ? planned.outputToken : null) ??
    null;
  const recipient =
    mandate?.recipient ?? simulation?.recipient ?? planned?.recipient ?? null;
  const deadline = action?.deadline ?? null;
  const expiresAt = mandate?.expiresAt ?? simulation?.mandate.expiresAt ?? null;
  const prompts = allowance.prompts;
  return (
    <Panel
      label="Summary"
      aside={
        <Status tone={prompts.total === 1 ? "ok" : "signal"}>
          {prompts.total} wallet prompt{prompts.total === 1 ? "" : "s"}
        </Status>
      }
    >
      <dl>
        <Fact
          label="you spend"
          emphasis
          value={
            spend !== null && spendToken !== null
              ? tokenAmount(spend, spendToken, config.data)
              : "waiting for a compiled plan"
          }
          note={spend !== null ? `at most ${spend} base units` : undefined}
        />
        <Fact
          label="minimum you receive"
          emphasis
          value={
            minimum === null
              ? "waiting for a simulation"
              : simulation?.outcomeUnit === "POOL_SHARES"
                ? `${minimum} pool shares`
                : outputToken !== null
                  ? tokenAmount(minimum, outputToken, config.data)
                  : `${minimum} base units`
          }
          note={
            simulation?.outcomeUnit === "POOL_SHARES"
              ? "New position shares, not an amount of the staked token."
              : "Committed by the signature, never taken from the quote."
          }
        />
        <Fact
          label="recipient"
          value={
            recipient !== null ? (
              <Hash value={recipient} full />
            ) : (
              "waiting for a compiled plan"
            )
          }
        />
        <Fact
          label="deadline"
          value={
            deadline !== null
              ? utc(Number(deadline))
              : "waiting for a simulation"
          }
          note={
            expiresAt !== null
              ? `mandate expires ${utc(Number(expiresAt))}`
              : "no mandate prepared"
          }
        />
        <Fact
          label="allowance to executor"
          value={
            allowance.current !== null && allowance.token !== null
              ? tokenAmount(
                  allowance.current.toString(),
                  allowance.token,
                  config.data,
                )
              : "reading chain"
          }
          note={allowanceSentence(allowance)}
        />
        <Fact
          label="this task uses"
          value={
            allowance.needed !== null && allowance.token !== null
              ? tokenAmount(
                  allowance.needed.toString(),
                  allowance.token,
                  config.data,
                )
              : "waiting for a compiled plan"
          }
          note="The executor may pull no more than this for the task."
        />
        {allowance.restore !== null && allowance.token !== null ? (
          <Fact
            label="restore amount"
            value={tokenAmount(
              allowance.restore.toString(),
              allowance.token,
              config.data,
            )}
            note="The active wallet policy's rolling cap, never more."
          />
        ) : null}
        <Fact
          label="wallet prompts"
          value={`${prompts.total} wallet prompt${prompts.total === 1 ? "" : "s"}`}
          note={
            prompts.restore === 0
              ? "Sign the mandate once. No other prompt is needed."
              : prompts.restore === 1
                ? "One to restore the allowance through the sponsored bundler, one to sign the mandate."
                : "Two to restore the allowance through EntryPoint, one to sign the mandate."
          }
        />
      </dl>
    </Panel>
  );
}

/** Runs the one automatic step of the journey, at most once per task and simulation. */
function AutoPilot({
  input,
  onRun,
}: {
  input: AutomaticStepInput;
  onRun: (step: "simulate" | "prepare") => void;
}) {
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    const next = automaticStep({ ...input, attempted: attempted.current });
    if (!next) return;
    attempted.current.add(next.key);
    onRun(next.step);
  });
  return null;
}

function Plan({ task }: { task: TaskDetail }) {
  const config = usePublicConfig();
  if (!task.plan) {
    return (
      <Panel
        label="Compiled plan"
        aside={<Status tone="idle">Not available</Status>}
      >
        <p className="max-w-[60ch] text-fog">
          The API has not produced a policy-passing compiled plan for this task.
        </p>
      </Panel>
    );
  }
  const { action } = task.plan;
  return (
    <Panel
      label="Compiled plan"
      aside={<Status tone="ok">{action.kind}</Status>}
    >
      <dl>
        <Fact label="chain" value={task.plan.chainId} />
        <Fact label="account" value={<Hash value={task.plan.account} full />} />
        <Fact label="adapter" value={action.adapterId} />
        <Fact
          label="spend"
          value={tokenAmount(
            action.inputAmount,
            action.inputToken,
            config.data,
          )}
          note={`${action.inputAmount} base units · ${action.inputToken}`}
          emphasis
        />
        {action.kind === "SWAP" ? (
          <>
            <Fact
              label="output token"
              value={<Hash value={action.outputToken} full />}
            />
            <Fact label="pool fee" value={action.poolFee} />
          </>
        ) : null}
        <Fact label="max slippage" value={`${action.maxSlippageBps} bps`} />
        <Fact
          label="recipient"
          value={<Hash value={action.recipient} full />}
        />
        <Fact
          label="requested lifetime"
          value={duration(Number(task.plan.lifetimeSeconds))}
          note={`${task.plan.lifetimeSeconds} seconds`}
        />
        <Fact
          label="plan hash"
          value={<Hash value={task.planHash ?? task.intentHash} full />}
        />
      </dl>
      <p className="mt-5 max-w-[60ch] text-[13px] text-fog">
        The plan fixes the exact spend, route, recipient, and slippage ceiling.
        A simulation supplies the signed minimum output and deadline.
      </p>
    </Panel>
  );
}

function Decision({ task }: { task: TaskDetail }) {
  if (!task.decision) {
    return (
      <Panel
        label="Policy decision"
        aside={<Status tone="idle">Awaiting compilation</Status>}
      >
        <p className="text-fog">No rule evaluation is available yet.</p>
      </Panel>
    );
  }
  const rules = task.decision.rules;
  const passing = task.decision.outcome === "PASS";
  return (
    <Panel
      label="Policy decision"
      aside={
        <Status tone={statusTone(task.decision.outcome)}>
          {task.decision.outcome}
        </Status>
      }
    >
      <dl className="border-t border-rule">
        <Fact label="compiler" value={task.decision.compilerVersion} />
        <Fact
          label="decision hash"
          value={<Hash value={task.decisionHash ?? task.intentHash} full />}
        />
      </dl>
      <p className="mt-5 text-sm text-fog">
        {rules.filter((rule) => rule.outcome === "PASS").length} of{" "}
        {rules.length} policy checks pass.
        {passing
          ? " The exact limits remain available below."
          : " Review each failed rule before changing the goal or policy."}
      </p>
      <details open={!passing} className="mt-5 border-t border-rule">
        <summary className="cursor-pointer py-4 font-mono text-[12px] uppercase tracking-[0.12em] text-signal-ink focus-visible:outline-offset-2">
          Inspect all {rules.length} policy checks
        </summary>
        <ol className="border-t border-rule">
          {rules.map((rule) => (
            <li
              key={rule.rule}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-5 border-b border-rule py-4"
            >
              <div className="min-w-0">
                <p className="font-mono text-[13px]">{rule.rule}</p>
                <p className="mt-1 break-words text-[13px] text-fog">
                  observed: {rule.observed}
                </p>
                <p className="mt-1 break-words text-[13px] text-fog">
                  limit: {rule.limit}
                </p>
                {rule.reasonCode ? (
                  <p className="mt-2 font-mono text-[12px] text-fail-ink">
                    {rule.reasonCode} ·{" "}
                    {reason(rule.reasonCode) ?? "API policy refusal"}
                  </p>
                ) : null}
              </div>
              <Status tone={statusTone(rule.outcome)}>{rule.outcome}</Status>
            </li>
          ))}
        </ol>
      </details>
    </Panel>
  );
}

function SimulationTerms({ simulation }: { simulation: SimulationResult }) {
  const config = usePublicConfig();
  const action = simulation.action;
  const minimum =
    action.kind === "SWAP" ? action.minAmountOut : action.minPositionOut;
  return (
    <dl>
      <Fact label="chain" value={simulation.chainId} />
      <Fact
        label="exact spend"
        value={tokenAmount(
          simulation.maxInput,
          simulation.inputToken,
          config.data,
        )}
        note={`${simulation.maxInput} base units · ${simulation.inputToken}`}
        emphasis
      />
      <Fact
        label="minimum output"
        value={
          action.kind === "SWAP"
            ? tokenAmount(minimum, simulation.outputToken, config.data)
            : `${minimum} ${simulation.outcomeUnit}`
        }
        note={
          action.kind === "STAKE"
            ? "Minimum new position shares, not an amount of CAKE."
            : `${minimum} base units · ${simulation.outputToken}`
        }
        emphasis
      />
      <Fact
        label="recipient"
        value={<Hash value={simulation.recipient} full />}
      />
      <DateFact label="action deadline" seconds={action.deadline} />
      <DateFact label="mandate expiry" seconds={simulation.mandate.expiresAt} />
      <Fact
        label="executor signer"
        value={<Hash value={simulation.mandate.executor} full />}
      />
      <Fact label="nonce" value={simulation.mandate.nonce} />
      <Fact
        label="action hash"
        value={<Hash value={simulation.actionHash} full />}
      />
      <Fact
        label="postcondition"
        value={<Hash value={simulation.postconditionHash} full />}
      />
    </dl>
  );
}

function SimulationPanel({
  task,
  onSimulate,
  simulating,
}: {
  task: TaskDetail;
  onSimulate: () => void;
  simulating: boolean;
}) {
  const simulation = task.simulation;
  const remaining = useSecondsUntil(
    simulation ? Number(simulation.result.quoteExpiresAt) : null,
  );
  if (!simulation) {
    return (
      <Panel
        label="Exact simulation"
        aside={<Status tone="idle">Required</Status>}
      >
        <p className="max-w-[60ch] text-fog">
          Run the API simulation to pin a chain block, quote, exact action, and
          mandate terms before a signature can be prepared.
        </p>
        <div className="mt-6">
          <Button
            arrow
            busy={simulating}
            disabled={!task.plan || task.decision?.outcome !== "PASS"}
            onClick={onSimulate}
          >
            Simulate exact plan
          </Button>
        </div>
      </Panel>
    );
  }
  const stale =
    simulation.status === "STALE" || (remaining !== null && remaining <= 0);
  return (
    <Panel
      label="Exact simulation"
      aside={
        <Status tone={stale ? "fail" : statusTone(simulation.status)}>
          {stale ? "Stale" : simulation.status}
        </Status>
      }
    >
      <dl>
        <Fact
          label="simulation"
          value={`#${simulation.sequence}`}
          note={utc(simulation.createdAt)}
        />
        <Fact
          label="simulation hash"
          value={<Hash value={simulation.simulationHash} full />}
        />
        <Fact
          label="pinned block"
          value={simulation.result.block.number}
          note={<Hash value={simulation.result.block.hash} full />}
        />
        <DateFact
          label="block timestamp"
          seconds={simulation.result.block.timestamp}
        />
        <DateFact
          label="quote expiry"
          seconds={simulation.result.quoteExpiresAt}
        />
        <Fact
          label="quote freshness"
          value={
            remaining === null
              ? "reading"
              : remaining > 0
                ? `fresh for ${duration(remaining)}`
                : "expired"
          }
        />
      </dl>
      <div className="mt-6 border-t border-rule pt-1">
        <SimulationTerms simulation={simulation.result} />
      </div>
      {simulation.result.failure ? (
        <div role="alert" className="mt-6 border-l-2 border-fail-ink py-2 pl-4">
          <Status tone="fail">SIMULATION_REVERTED</Status>
          <p className="mt-2">{simulation.result.failure.reason}</p>
          {simulation.result.failure.detail ? (
            <p className="mt-1 font-mono text-[12px] text-fog">
              {simulation.result.failure.detail}
            </p>
          ) : null}
        </div>
      ) : null}
      {!task.mandate ? (
        <>
          <p className="mt-5 max-w-[60ch] text-[13px] text-fog">
            Preparing a mandate re-reads these commitments at a current pinned
            block. If the quote, state, code, policy, position, or nonce
            changed, the API marks this simulation stale and requires another
            simulation.
          </p>
          <div className="mt-6">
            <Button arrow busy={simulating} onClick={onSimulate}>
              Re-simulate exact plan
            </Button>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

function MandatePanel({
  task,
  prepared,
  allowance,
  preparing,
  signing,
  owner,
  onPrepare,
  onSign,
}: {
  task: TaskDetail;
  prepared: PreparedMandate | null;
  allowance: AllowanceStatus;
  preparing: boolean;
  signing: boolean;
  owner: string | null;
  onPrepare: () => void;
  onSign: () => void;
}) {
  const config = usePublicConfig();
  const until = useSecondsUntil(
    prepared ? Number(prepared.simulation.quoteExpiresAt) : null,
  );
  const signerMatches =
    prepared !== null &&
    owner?.toLowerCase() === prepared.mandate.rootOwner.toLowerCase();
  const stale = mandateStale({
    preparedQuoteExpiresAt: prepared?.simulation.quoteExpiresAt ?? null,
    preparedSimulationHash: prepared?.simulationHash ?? null,
    simulation: task.simulation,
    nowSeconds: Math.floor(Date.now() / 1_000),
  });
  const usable =
    prepared !== null &&
    !stale &&
    signerMatches &&
    allowance.current !== null &&
    (allowance.covered || allowance.restore !== null);
  if (task.mandate) {
    return (
      <Panel
        label="Signed mandate"
        aside={
          <Status tone={statusTone(task.mandate.status)}>
            {task.mandate.status}
          </Status>
        }
      >
        <MandateTerms
          mandate={task.mandate.mandate}
          hash={task.mandate.mandateHash}
          outcomeUnit={task.simulation?.result.outcomeUnit ?? null}
        />
        {task.mandate.status === "SIGNED" ||
        task.mandate.status === "AUTHORIZED" ? (
          <p className="mt-5 max-w-[60ch] text-[13px] text-fog">
            The API is reconciling the chain. Once the contract authorizes this
            hash, your smart account may revoke it before execution begins;
            after begin, that option ends.
          </p>
        ) : null}
      </Panel>
    );
  }
  return (
    <Panel
      label="Sign mandate"
      aside={
        <Status tone={prepared ? (usable ? "signal" : "fail") : "idle"}>
          {prepared
            ? usable
              ? allowance.needsRestore
                ? "Restore then sign"
                : "Ready to sign"
              : "Waiting"
            : "Not prepared"}
        </Status>
      }
    >
      {!prepared ? (
        <>
          <p className="max-w-[60ch] text-fog">
            The API must freshly prepare the mandate before the wallet is asked
            to sign. Preparation rechecks the simulation against current chain
            state. It runs on its own as soon as a simulation passes.
          </p>
          <div className="mt-6">
            <Button
              arrow
              busy={preparing}
              disabled={task.simulation?.status !== "PASSED"}
              onClick={onPrepare}
            >
              Prepare fresh mandate
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="max-w-[60ch] text-fog">
            Review every signed term below. The wallet receives the SDK&apos;s
            exact EIP-712 TaskMandate payload for this API-prepared mandate
            hash.
          </p>
          <div className="mt-6">
            <MandateTerms
              mandate={prepared.mandate}
              hash={prepared.mandateHash}
              outcomeUnit={prepared.simulation.outcomeUnit}
            />
          </div>
          <dl className="mt-6 border-t border-rule pt-1">
            <Fact
              label="allowance to executor"
              value={
                allowance.current !== null && allowance.token !== null
                  ? tokenAmount(
                      allowance.current.toString(),
                      allowance.token,
                      config.data,
                    )
                  : "reading chain"
              }
              note={allowanceSentence(allowance)}
            />
            <Fact
              label="this mandate uses"
              value={tokenAmount(
                prepared.mandate.maxInput,
                prepared.mandate.inputToken,
                config.data,
              )}
              note="The executor may pull no more than this signed input."
            />
            {allowance.restore !== null && allowance.token !== null ? (
              <Fact
                label="restore amount"
                value={tokenAmount(
                  allowance.restore.toString(),
                  allowance.token,
                  config.data,
                )}
                note="The active wallet policy's rolling cap, never more."
              />
            ) : null}
          </dl>
          <div className="mt-6 border-l-2 border-signal py-2 pl-4 text-[13px]">
            <p className="font-medium">
              {stale
                ? "This preparation is stale"
                : `Fresh API preparation${
                    until !== null && until > 0
                      ? ` expires in ${duration(until)}`
                      : " has expired"
                  }`}
              .
            </p>
            <p className="mt-1 text-fog">
              Signing prepares a fresh mandate first when this one expired or
              its simulation moved, so no manual re-prepare is needed. If the
              API refuses, re-simulate the task.
            </p>
          </div>
          {!signerMatches ? (
            <p
              role="alert"
              className="mt-4 font-mono text-[12px] text-fail-ink"
            >
              The connected owner is not the root signer shown above. Switch
              wallets before signing.
            </p>
          ) : null}
          {allowance.blockedByPolicy ? (
            <p
              role="alert"
              className="mt-4 font-mono text-[12px] text-fail-ink"
            >
              {allowanceSentence(allowance)}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-4">
            <Button variant="ghost" busy={preparing} onClick={onPrepare}>
              Re-prepare
            </Button>
            <Button arrow busy={signing} disabled={!usable} onClick={onSign}>
              {allowance.needsRestore
                ? "Restore allowance and sign"
                : "Sign exact mandate"}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
function RevokeMandate({ task }: { task: TaskDetail }) {
  const { owner, account, session } = useSession();
  const config = usePublicConfig();
  const queryClient = useQueryClient();
  const action = useStagedAction<`0x${string}`>();
  const mandate = task.mandate;
  const onchain = useQuery({
    queryKey: [
      "chain",
      "mandate-revoke",
      config.data?.mandateExecutor,
      mandate?.mandateHash,
    ],
    enabled: Boolean(config.data && mandate && !task.receipt),
    refetchInterval: 1_000,
    queryFn: async () => {
      if (!config.data || !mandate || !account)
        throw new Error("Account unavailable.");
      const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
      if (!client) throw new Error("Chain client unavailable.");
      const record = await client.readContract({
        address: config.data.mandateExecutor,
        abi: mandateExecutorAbi,
        functionName: "mandateRecord",
        args: [mandate.mandateHash],
      });
      return (
        record.status === 1 &&
        record.account.toLowerCase() === account.toLowerCase() &&
        record.executionStartedAt === 0
      );
    },
  });
  if (!mandate || task.receipt || onchain.data !== true) return null;
  const revoke = () =>
    void action.run(async (advance) => {
      if (!owner || !account || !config.data)
        throw new Error(
          "The owner wallet and pinned executor must be available.",
        );
      if (!onchain.data) throw new Error("Execution is no longer revocable.");
      const result = await sendRootOperation({
        owner,
        account,
        callData: encodeAccountExecute({
          target: config.data.mandateExecutor,
          value: 0n,
          data: encodeFunctionData({
            abi: mandateExecutorAbi,
            functionName: "revoke",
            args: [mandate.mandateHash],
          }),
        }),
        onStage: (stage) => advance(stage),
        sponsor: sponsorFor(config.data, session),
      });
      await queryClient.invalidateQueries({
        queryKey: ["session", owner, `task:${task.taskId}`],
      });
      return result.transactionHash;
    });
  return (
    <Panel
      label="End this mandate"
      aside={<Status tone="pending">Authorized · not begun</Status>}
    >
      <p className="max-w-[65ch] text-fog">
        Only while the mandate is authorized and execution has not begun can the
        smart account revoke it. The contract—not this button—enforces the race.
        The chain may authorize before the API's finalized projection catches
        up. Your wallet signs the exact revoke call through EntryPoint.
      </p>
      <dl className="mt-4">
        <Fact
          label="mandate"
          value={<Hash value={mandate.mandateHash} full />}
        />
        <Fact
          label="caller"
          value={<Hash value={mandate.mandate.account} full />}
        />
        <Fact
          label="contract"
          value={
            config.data ? (
              <Hash value={config.data.mandateExecutor} full />
            ) : (
              "unavailable"
            )
          }
        />
      </dl>
      <div className="mt-6">
        <Button
          variant="danger"
          busy={action.busy}
          disabled={action.state.phase === "done" || !config.data}
          onClick={revoke}
        >
          Revoke before execution
        </Button>
        {action.state.phase !== "idle" ? (
          <div className="mt-5">
            <StepList
              state={action.state}
              steps={[
                {
                  id: "sign",
                  title: "Sign exact revoke UserOperation",
                  detail:
                    "Only MandateExecutor.revoke(mandateHash), from your smart account.",
                  prompt: true,
                },
                {
                  id: "send",
                  title: config.data?.sponsorship.enabled
                    ? "Submit to the bundler"
                    : "Send through EntryPoint",
                  detail: config.data?.sponsorship.enabled
                    ? "Gas is sponsored. If sponsorship is refused, your wallet sends the same signed operation and pays."
                    : "Your owner wallet pays network gas.",
                  prompt: !config.data?.sponsorship.enabled,
                },
                {
                  id: "confirm",
                  title: "Confirm contract result",
                  detail:
                    "The UserOperation must succeed. The API then projects the finalized revocation event.",
                },
              ]}
            />
          </div>
        ) : null}
        {action.state.phase === "done" ? (
          <p className="mt-4 font-mono text-xs text-fog">
            Revocation transaction included. Waiting for the finalized public
            receipt before treating authority as ended.
          </p>
        ) : null}
        {action.state.phase === "failed" ? (
          <div className="mt-4">
            <FailureNotice
              failure={action.state.failure}
              onRetry={() => action.reset()}
            />
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function MandateTerms({
  mandate,
  hash,
  outcomeUnit,
}: {
  mandate:
    | PreparedMandate["mandate"]
    | NonNullable<TaskDetail["mandate"]>["mandate"];
  hash: string;
  outcomeUnit: SimulationResult["outcomeUnit"] | null;
}) {
  const config = usePublicConfig();
  return (
    <dl>
      <Fact label="mandate hash" value={<Hash value={hash} full />} />
      <Fact label="chain" value={mandate.chainId} />
      <Fact label="owner epoch" value={mandate.ownerEpoch} />
      <Fact
        label="root signer"
        value={<Hash value={mandate.rootOwner} full />}
      />
      <Fact label="account" value={<Hash value={mandate.account} full />} />
      <Fact label="executor" value={<Hash value={mandate.executor} full />} />
      <Fact label="adapter" value={<Hash value={mandate.adapter} full />} />
      <Fact label="adapter selector" value={mandate.adapterSelector} />
      <Fact
        label="exact spend"
        value={tokenAmount(mandate.maxInput, mandate.inputToken, config.data)}
        note={`${mandate.maxInput} base units · ${mandate.inputToken}`}
        emphasis
      />
      <Fact
        label="minimum output"
        value={
          outcomeUnit === "POOL_SHARES"
            ? `${mandate.minOutput} POOL_SHARES`
            : outcomeUnit === "TOKEN"
              ? tokenAmount(mandate.minOutput, mandate.outputToken, config.data)
              : `${mandate.minOutput} base units (unit unavailable)`
        }
        note={
          outcomeUnit === "POOL_SHARES"
            ? "Minimum new position shares, not an amount of CAKE."
            : `${mandate.minOutput} base units · ${mandate.outputToken}`
        }
        emphasis
      />
      <Fact
        label="output asset"
        value={<Hash value={mandate.outputToken} full />}
      />
      <Fact label="recipient" value={<Hash value={mandate.recipient} full />} />
      <DateFact label="expires" seconds={mandate.expiresAt} />
      <Fact label="nonce" value={mandate.nonce} />
      <Fact
        label="simulation"
        value={<Hash value={mandate.simulationHash} full />}
      />
      <Fact label="policy" value={<Hash value={mandate.policyHash} full />} />
      <Fact label="intent" value={<Hash value={mandate.intentHash} full />} />
      <Fact label="plan" value={<Hash value={mandate.planHash} full />} />
      <Fact label="action" value={<Hash value={mandate.actionHash} full />} />
      <Fact
        label="postcondition"
        value={<Hash value={mandate.postconditionHash} full />}
      />
      <Fact
        label="commerce job"
        value={
          mandate.commerceJobId === "0"
            ? "No ERC-8183 payment bound"
            : `${mandate.commerceJobId} · ${mandate.commerceContract}`
        }
      />
    </dl>
  );
}

function ExecutionPanel({
  task,
  receipt,
}: {
  task: TaskDetail;
  receipt: UseQueryResult<ExecutionReceipt, Error>;
}) {
  const execution = task.execution;
  const terminal = task.receipt;
  return (
    <Panel
      label="Execution and receipt"
      aside={
        <span role="status" aria-live="polite" aria-atomic="true">
          <Status
            tone={statusTone(
              terminal?.status ?? execution?.status ?? task.status,
            )}
          >
            {terminal?.status ?? execution?.status ?? task.status}
          </Status>
        </span>
      }
    >
      {execution ? (
        <dl>
          <Fact
            label="queue state"
            value={execution.status}
            note={`updated ${utc(execution.updatedAt)}`}
          />
          <Fact
            label="submission attempts"
            value={execution.submissionAttempts}
          />
          <Fact
            label="authorize tx"
            value={
              execution.transactions.authorize ? (
                <Hash value={execution.transactions.authorize} full />
              ) : (
                "not submitted"
              )
            }
          />
          <Fact
            label="begin tx"
            value={
              execution.transactions.begin ? (
                <Hash value={execution.transactions.begin} full />
              ) : (
                "not submitted"
              )
            }
          />
          <Fact
            label="user operation"
            value={
              execution.transactions.userOperation ? (
                <Hash value={execution.transactions.userOperation} full />
              ) : (
                "not submitted"
              )
            }
          />
          <Fact
            label="execution tx"
            value={
              execution.transactions.execution ? (
                <Hash value={execution.transactions.execution} full />
              ) : (
                "not submitted"
              )
            }
          />
          {execution.lastErrorCode ? (
            <Fact
              label="last reason"
              value={execution.lastErrorCode}
              note={
                execution.lastErrorDetail ??
                reason(execution.lastErrorCode) ??
                undefined
              }
            />
          ) : null}
        </dl>
      ) : (
        <p className="max-w-[60ch] text-fog">
          No execution queue row exists until a signed mandate is accepted by
          the API.
        </p>
      )}
      {terminal ? (
        <div className="mt-6 border-t border-rule pt-1">
          <Fact
            label="terminal state"
            value={terminal.status}
            note={terminal.terminalReasonCode}
          />
          <p className="mt-3 max-w-[60ch] text-[13px] text-fog">
            Terminal status is an API projection of finalized chain evidence. A
            submitted signature or transaction is never shown as a successful
            execution.
          </p>
        </div>
      ) : (
        <p className="mt-6 max-w-[60ch] border-t border-rule pt-5 text-[13px] text-fog">
          The API polls the owner&apos;s task. Pending, retries, provider
          outages, and verification failures remain visible here until a
          terminal receipt is recorded.
        </p>
      )}
      {terminal && receipt.isPending ? (
        <p className="mt-6">
          <Status tone="pending">Loading public receipt</Status>
        </p>
      ) : null}
      {terminal && receipt.isError ? (
        <div className="mt-6">
          <FailureNotice
            failure={toFailure(receipt.error)}
            onRetry={() => void receipt.refetch()}
          />
        </div>
      ) : null}
      {receipt.data ? <PublicReceipt receipt={receipt.data} /> : null}
    </Panel>
  );
}

function PublicReceipt({ receipt }: { receipt: ExecutionReceipt }) {
  const config = usePublicConfig();
  const live = config.data?.venue === "testnet";
  const settlement = receipt.settlement;
  const paymentToken =
    settlement.status === "CONFIRMED"
      ? config.data?.tokens.find(
          (token) =>
            token.address.toLowerCase() ===
            settlement.paymentToken.toLowerCase(),
        )
      : null;
  const paymentExplorer = live ? config.data?.explorer?.transaction : null;
  return (
    <section
      className="mt-6 border-t border-rule pt-5"
      aria-label="Public receipt"
    >
      <div className="flex items-center justify-between gap-4">
        <Label>Public receipt</Label>
        <Status tone={statusTone(receipt.status)}>{receipt.status}</Status>
      </div>
      <dl className="mt-2">
        <Fact
          label="terminal reason"
          value={receipt.terminalReasonCode}
          note={receipt.terminalMessage}
        />
        <Fact
          label="authorization block"
          value={receipt.authorization.blockNumber}
          note={
            <Hash
              value={receipt.authorization.blockHash}
              href={live ? receipt.explorer.block : null}
              full
            />
          }
        />
        <Fact
          label="terminal tx"
          value={
            <Hash
              value={receipt.terminal.transactionHash}
              href={live ? receipt.explorer.terminal : null}
              full
            />
          }
          note={`block ${receipt.terminal.blockNumber} · log ${receipt.terminal.logIndex}`}
        />
        <Fact
          label="replay verification"
          value={receipt.verification.status}
          note={`${receipt.verification.reasonCode}${receipt.verification.failureReasonHash ? ` · ${receipt.verification.failureReasonHash}` : ""}`}
        />
        <Fact
          label="authority consumed"
          value={receipt.authorityConsumed ? "yes" : "no"}
        />
        <Fact label="settlement" value={settlement.status} />
        {settlement.status === "CONFIRMED" ? (
          <>
            <Fact
              label="paid amount"
              value={
                paymentToken
                  ? `${formatUnits(BigInt(settlement.amount), paymentToken.decimals)} ${paymentToken.symbol}`
                  : `${settlement.amount} base units (token decimals unavailable)`
              }
              note={<Hash value={settlement.paymentToken} full />}
            />
            <Fact
              label="provider"
              value={<Hash value={settlement.provider} full />}
            />
            <Fact
              label="payment tx"
              value={
                <Hash
                  value={settlement.transactionHash}
                  href={
                    paymentExplorer
                      ? `${paymentExplorer}${settlement.transactionHash}`
                      : null
                  }
                  full
                />
              }
              note={`block ${settlement.blockNumber} · payment log ${settlement.paymentLogIndex}`}
            />
          </>
        ) : null}
      </dl>
      <p className="mt-4 max-w-[60ch] text-[13px] text-fog">
        Verification is the API&apos;s authoritative replay result. A failed or
        unavailable verification is shown as such; it is not inferred from a
        submitted transaction.
      </p>
    </section>
  );
}

function Journey({ taskId }: { taskId: string }) {
  const { session, owner, account } = useSession();
  const queryClient = useQueryClient();
  const config = usePublicConfig();
  const holdings = useHoldings(config.data);
  const policies = usePolicies();
  const task = useTask(taskId);
  const [prepared, setPrepared] = useState<PreparedMandate | null>(null);
  const simulate = useStagedAction<void>();
  const prepare = useStagedAction<void>();
  const sign = useStagedAction<void>();
  const mandateHash = task.data?.mandate?.mandateHash;
  const receipt = useQuery({
    queryKey: ["receipt", mandateHash],
    enabled: Boolean(mandateHash && task.data?.receipt),
    queryFn: () => {
      if (!mandateHash) throw new Error("Mandate hash is not available.");
      return api.receipt(mandateHash);
    },
    refetchInterval: task.data?.receipt ? 5_000 : false,
    retry: 2,
  });
  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["session", owner, `task:${taskId}`],
    });
  };
  const token = () => {
    if (!session)
      throw new Error(
        "Your API session expired. Sign in again before continuing.",
      );
    return session.token;
  };

  if (task.isPending)
    return (
      <div className="relative h-48 border border-rule">
        <span className="sr-only">Loading task</span>
      </div>
    );
  if (task.isError)
    return (
      <FailureNotice
        failure={toFailure(task.error)}
        onRetry={() => void task.refetch()}
      />
    );
  if (!task.data) return null;

  const current = task.data;
  /** Checks a preparation against the reviewed plan and the simulation it must bind. */
  const assertReview = (
    next: MandatePrepared,
    simulationHash = current.simulation?.simulationHash,
  ) => {
    if (
      !owner ||
      !account ||
      !config.data ||
      !current.plan ||
      !current.planHash ||
      !simulationHash
    )
      throw new Error(
        "The reviewed plan, simulation, owner, and deployment must be available before signing.",
      );
    assertPreparedMandate({
      prepared: next,
      plan: current.plan,
      planHash: current.planHash,
      intentHash: current.intentHash,
      simulationHash,
      owner,
      account,
      executor: config.data.sessionSigner,
      chainId: config.data.chainId,
      mandateExecutor: config.data.mandateExecutor,
    });
  };
  const inputToken =
    prepared?.mandate.inputToken ??
    current.simulation?.result.inputToken ??
    current.plan?.action.inputToken ??
    null;
  const neededAmount =
    prepared?.mandate.maxInput ??
    current.simulation?.result.maxInput ??
    current.plan?.action.inputAmount ??
    null;
  const tokenEntry = inputToken
    ? (config.data?.tokens.find(
        (entry) => entry.address.toLowerCase() === inputToken.toLowerCase(),
      ) ?? null)
    : null;
  const currentAllowance = tokenEntry
    ? (holdings.data?.tokens[tokenEntry.symbol]?.allowance ?? null)
    : null;
  const covered =
    neededAmount !== null && allowanceReady(currentAllowance, neededAmount);
  const activePolicy =
    policies.data?.find((entry) => entry.status === "ACTIVE") ?? null;
  const cap =
    activePolicy && inputToken
      ? rollingCap(activePolicy.policy, inputToken)
      : null;
  const needsRestore =
    currentAllowance !== null && neededAmount !== null && !covered;
  const allowance: AllowanceStatus = {
    token: inputToken,
    symbol: tokenEntry?.symbol ?? null,
    current: currentAllowance,
    needed: neededAmount === null ? null : BigInt(neededAmount),
    covered,
    needsRestore,
    restore: needsRestore ? restoreAmount(cap, neededAmount) : null,
    cap,
    policyLoaded: policies.data !== undefined,
    blockedByPolicy: needsRestore && restoreAmount(cap, neededAmount) === null,
    prompts: promptCount({
      needsRestore,
      sponsorshipEnabled: config.data?.sponsorship.enabled === true,
    }),
  };
  const sponsorship = config.data?.sponsorship.enabled === true;

  const runSimulation = () =>
    void simulate.run(async (advance) => {
      setPrepared(null);
      advance("simulate");
      await api.simulate(token(), taskId);
      advance("refresh");
      await invalidate();
    });
  const prepareMandate = () =>
    void prepare.run(async (advance) => {
      setPrepared(null);
      advance("freshness");
      const next = await api.prepareMandate(token(), taskId);
      assertReview(next);
      setPrepared(next);
      advance("refresh");
      await invalidate();
    });
  const signMandate = () =>
    void sign.run(async (advance) => {
      if (!prepared || !owner || !account || !config.data)
        throw new Error(
          "Connect the owner wallet and prepare a fresh mandate before signing.",
        );
      let next = prepared;
      if (
        mandateStale({
          preparedQuoteExpiresAt: prepared.simulation.quoteExpiresAt,
          preparedSimulationHash: prepared.simulationHash,
          simulation: current.simulation,
          nowSeconds: Math.floor(Date.now() / 1_000),
        })
      ) {
        // One click still ends in one mandate prompt: a stale preparation is
        // refreshed here, re-simulating once when the API says the simulation
        // itself went stale. Any other refusal stops before a prompt.
        advance("freshness");
        let simulationHash = current.simulation?.simulationHash;
        const resimulate = async () => {
          simulationHash = (await api.simulate(token(), taskId)).simulationHash;
        };
        if (current.simulation?.status !== "PASSED") await resimulate();
        try {
          next = await api.prepareMandate(token(), taskId);
        } catch (error) {
          if (!(error instanceof ApiError && error.code.startsWith("STALE_")))
            throw error;
          await resimulate();
          next = await api.prepareMandate(token(), taskId);
        }
        assertReview(next, simulationHash);
        setPrepared(next);
        await invalidate();
      } else assertReview(next);
      await assertWalletVenue();
      const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
      if (!client) throw new Error("Chain client unavailable.");
      const executor = config.data.mandateExecutor;
      const readAllowance = () =>
        client.readContract({
          abi: erc20Abi,
          address: next.mandate.inputToken,
          functionName: "allowance",
          args: [account, executor],
        });
      if (!allowanceReady(await readAllowance(), next.mandate.maxInput)) {
        const active =
          policies.data?.find((entry) => entry.status === "ACTIVE") ?? null;
        const cap = active
          ? rollingCap(active.policy, next.mandate.inputToken)
          : null;
        const amount = restoreAmount(cap, next.mandate.maxInput);
        if (amount === null)
          throw new Error(
            policies.data === undefined
              ? "The active wallet policy is still loading. Try signing again in a moment."
              : "This task spends more than the active wallet policy's rolling 24-hour cap for its input token. Change the plan or raise the cap before signing.",
          );
        advance("restore-sign");
        await sendRootOperation({
          owner,
          account,
          callData: encodeAccountExecute({
            target: next.mandate.inputToken,
            value: 0n,
            data: encodeFunctionData({
              abi: erc20Abi,
              functionName: "approve",
              args: [executor, amount],
            }),
          }),
          onStage: (stage) => advance(restoreStepId(stage, sponsorship)),
          sponsor: sponsorFor(config.data, session),
        });
        await queryClient.invalidateQueries({ queryKey: ["chain"] });
        if (!allowanceReady(await readAllowance(), next.mandate.maxInput))
          throw new Error(
            "The allowance is still short after the restore UserOperation. Nothing else was signed.",
          );
      }
      advance("sign");
      const signature = await signTypedData(wagmiConfig, {
        account: owner,
        ...getTaskMandateTypedData(next.mandate, next.domain),
      });
      advance("submit");
      await api.submitMandate(token(), taskId, signature);
      setPrepared(null);
      advance("queue");
      await invalidate();
    });

  return (
    <div className="space-y-6">
      <header className="grid border border-rule bg-paper md:grid-cols-12">
        <div className="border-b border-rule px-5 py-7 md:col-span-7 md:border-b-0 md:border-r md:px-6 md:py-8">
          <Label>Task detail</Label>
          <h1 className="mt-3 max-w-[24ch] text-3xl font-semibold tracking-[-0.03em] md:text-5xl">
            {current.goal}
          </h1>
          <p className="mt-4 font-mono text-[12px] text-fog">{taskId}</p>
        </div>
        <div className="flex flex-col justify-between px-5 py-7 md:col-span-5 md:px-6 md:py-8">
          <Status tone={statusTone(current.receipt?.status ?? current.status)}>
            {current.receipt?.status ?? current.status}
          </Status>
          <dl className="mt-8 border-t border-rule">
            <Fact
              label="intent"
              value={<Hash value={current.intentHash} full />}
            />
            <Fact label="updated" value={utc(current.updatedAt)} />
          </dl>
        </div>
      </header>

      <AutoPilot
        input={{
          taskId,
          planPresent: current.plan !== null,
          decisionPassed: current.decision?.outcome === "PASS",
          simulation: current.simulation
            ? {
                simulationId: current.simulation.simulationId,
                status: current.simulation.status,
              }
            : null,
          mandateSigned: current.mandate !== null,
          prepared: prepared !== null,
        }}
        onRun={(step) => {
          if (step === "simulate") runSimulation();
          else prepareMandate();
        }}
      />
      <JourneySummary
        task={current}
        prepared={prepared}
        allowance={allowance}
      />

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Plan task={current} />
        <Decision task={current} />
      </div>
      <SimulationPanel
        task={current}
        onSimulate={runSimulation}
        simulating={simulate.busy}
      />
      {simulate.state.phase !== "idle" && simulate.state.phase !== "done" ? (
        <Panel label="Simulation progress">
          <StepList
            steps={[
              {
                id: "simulate",
                title: "Simulate the exact plan",
                detail:
                  "The API pins a chain block and runs the compiled action.",
              },
              {
                id: "refresh",
                title: "Read the authoritative task state",
                detail:
                  "The task view receives the simulation result and current freshness state.",
              },
            ]}
            state={simulate.state}
          />
          {simulate.state.phase === "failed" ? (
            <div className="mt-5">
              <FailureNotice
                failure={simulate.state.failure}
                onRetry={runSimulation}
              />
            </div>
          ) : null}
        </Panel>
      ) : null}
      <MandatePanel
        task={current}
        prepared={prepared}
        allowance={allowance}
        preparing={prepare.busy}
        signing={sign.busy}
        owner={owner}
        onPrepare={prepareMandate}
        onSign={signMandate}
      />
      <RevokeMandate task={current} />
      {prepare.state.phase !== "idle" && prepare.state.phase !== "done" ? (
        <Panel label="Mandate preparation">
          <StepList
            steps={[
              {
                id: "freshness",
                title: "Recheck the simulation",
                detail:
                  "The API pins current state and refuses stale quote, policy, code, position, nonce, or action commitments.",
              },
              {
                id: "refresh",
                title: "Read the prepared mandate",
                detail: "Only the API-prepared EIP-712 terms may be signed.",
              },
            ]}
            state={prepare.state}
          />
          {prepare.state.phase === "failed" ? (
            <div className="mt-5">
              <FailureNotice
                failure={prepare.state.failure}
                onRetry={prepareMandate}
              />
            </div>
          ) : null}
        </Panel>
      ) : null}
      {sign.state.phase !== "idle" && sign.state.phase !== "done" ? (
        <Panel label="Mandate signature">
          <StepList
            steps={signSteps({
              restore:
                allowance.needsRestore ||
                sign.state.step.startsWith("restore-"),
              sponsored: sponsorship,
            })}
            state={sign.state}
          />
          {sign.state.phase === "failed" ? (
            <div className="mt-5">
              <FailureNotice
                failure={sign.state.failure}
                onRetry={signMandate}
              />
            </div>
          ) : null}
        </Panel>
      ) : null}
      <ExecutionPanel task={current} receipt={receipt} />
    </div>
  );
}

export function TaskJourney({ taskId }: { taskId: string }) {
  return (
    <WalletGate>
      <Journey taskId={taskId} />
    </WalletGate>
  );
}
