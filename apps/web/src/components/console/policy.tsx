"use client";

import {
  type Address,
  encodeAccountPolicyTransition,
  getAccountPolicyTypedData,
  MAX_SESSION_ENTITY_ID,
  type PolicyView,
  type PublicConfig,
  type WalletPolicy,
  walletPolicySchema,
} from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseUnits } from "viem";
import { signTypedData } from "wagmi/actions";
import { api } from "@/lib/api";
import { assertPreparedPolicy } from "@/lib/authority";
import { compact } from "@/lib/format";
import {
  clearPendingPolicy,
  readPendingPolicy,
  writePendingPolicy,
} from "@/lib/policy-pending";
import type { Holdings } from "@/lib/queries";
import {
  OperationFailedError,
  sendRootOperation,
  sponsorFor,
} from "@/lib/root-operation";
import { useSession } from "@/lib/session";
import { assertWalletVenue } from "@/lib/venue";
import { wagmiConfig } from "@/lib/wagmi";
import { useStagedAction } from "./action";
import {
  ActivationReview,
  type PendingActivation,
  type Review,
} from "./policy/activation-review";
import { percentOfBps } from "./policy/describe";
import { diffPolicies } from "./policy/diff";
import {
  AmountField,
  DiffSummary,
  ModeControl,
  Presets,
} from "./policy/editor";
import {
  type AssetChoice,
  type EditorState,
  hasErrors,
  initialEditorState,
  secondsFromMinutes,
  validateEditor,
} from "./policy/editor-model";
import { PolicyReadout } from "./policy/readout";
import { RevokeAccess } from "./policy/revoke";
import { Button, FailureNotice, Panel, Status } from "./ui";

/*
 * The policy section: what the active policy allows (the readout), the one
 * way to revoke all of it, and the editor that proposes a replacement. One
 * policy is the owner's standing envelope, not a blanket session. Editing
 * never changes anything on its own: a replacement takes effect only after
 * the owner signs it and the chain confirms it.
 */

const SLIPPAGE_PRESETS = [
  { value: "50", text: "0.5%" },
  { value: "100", text: "1%" },
  { value: "300", text: "3%" },
];

const LIFETIME_PRESETS = [
  { value: "5", text: "5 min" },
  { value: "15", text: "15 min" },
  { value: "30", text: "30 min" },
  { value: "60", text: "60 min" },
];

const newest = (rows: PolicyView[]): PolicyView | null =>
  rows.reduce<PolicyView | null>(
    (best, row) =>
      best === null || BigInt(row.version) > BigInt(best.version) ? row : best,
    null,
  );

/** The policy document a validated editor state means. Throws if the schema refuses it. */
function buildPolicy(input: {
  account: Address;
  config: PublicConfig;
  policies: PolicyView[];
  state: EditorState;
}): WalletPolicy {
  const { account, config, policies, state } = input;
  const lifetime = secondsFromMinutes(state.lifetimeMinutes);
  if (lifetime === null) throw new Error("Enter the task lifetime in minutes.");
  const latest = policies.reduce(
    (highest, row) => Math.max(highest, Number(row.version)),
    0,
  );
  return walletPolicySchema.parse({
    schemaVersion: "1",
    account,
    chainId: config.chainId,
    version: String(latest + 1),
    protectedAssets: config.tokens
      .filter((token) => state.assets[token.symbol]?.mode === "protected")
      .map((token) => token.address.toLowerCase()),
    activeAssets: config.tokens.flatMap((token) => {
      const choice = state.assets[token.symbol];
      if (choice?.mode !== "active") return [];
      return [
        {
          token: token.address.toLowerCase() as `0x${string}`,
          maxInputPerTask: parseUnits(choice.max, token.decimals).toString(),
          rollingDailyCap: parseUnits(choice.daily, token.decimals).toString(),
        },
      ];
    }),
    services: [...new Set(config.adapters.map((adapter) => adapter.kind))],
    approvedAdapterIds: config.adapters.map((adapter) => adapter.id),
    maxSlippageBps: state.slippageBps.trim(),
    allowedRecipients: "SELF",
    maxTaskLifetimeSeconds: String(lifetime),
  });
}

export function PolicySection({
  config,
  policies,
  holdings,
  number,
}: {
  config: PublicConfig;
  policies: PolicyView[];
  holdings: Holdings | undefined;
  /** Section number, e.g. "04", shared with the in-page navigation. */
  number: string;
}) {
  const { owner, account, session } = useSession();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const editor = useRef<HTMLDivElement>(null);
  const active = newest(policies.filter((row) => row.status === "ACTIVE"));
  const confirming = newest(
    policies.filter((row) => row.status === "ACTIVATING"),
  );
  const revoked = active
    ? null
    : newest(policies.filter((row) => row.status === "REVOKED"));
  const draft = newest(
    policies.filter(
      (row) =>
        row.status === "DRAFT" &&
        (!active || BigInt(row.version) > BigInt(active.version)),
    ),
  );
  const baseline = active?.policy ?? null;

  const [state, setState] = useState<EditorState>(() =>
    initialEditorState(baseline, config),
  );
  const [editing, setEditing] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [submitted, setSubmitted] = useState<PendingActivation | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [resume, setResume] = useState<PolicyView | null>(null);
  const prepare = useStagedAction<void>();
  const activate = useStagedAction<void>();

  // A newly active policy is the new baseline for the next edit. Keyed on the
  // policy's identity so a background refetch never resets what is being typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the active policy changes
  useEffect(() => {
    setState(initialEditorState(active?.policy ?? null, config));
    setEditing(false);
    setResume(null);
  }, [active?.policyId, config]);

  useEffect(() => {
    if (!owner || !account) return;
    const identity = { owner, account, chainId: Number(config.chainId) };
    try {
      const pending = readPendingPolicy(sessionStorage, identity);
      if (pending && active?.policyId === pending.policyId) {
        clearPendingPolicy(sessionStorage, identity);
        setSubmitted(null);
      } else {
        setSubmitted(pending);
      }
      setRecoveryError(null);
    } catch {
      setRecoveryError(
        "Stored owner transaction evidence is invalid. Do not sign or broadcast again until it is reconciled on chain.",
      );
    }
  }, [owner, account, config.chainId, active?.policyId]);

  const showEditor =
    !active ||
    editing ||
    review !== null ||
    submitted !== null ||
    resume !== null;
  useEffect(() => {
    if (editing || resume) {
      editor.current?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "start",
      });
    }
  }, [editing, resume, reduced]);

  const locked = resume !== null || review !== null;
  const shown = useMemo(
    () => (resume ? initialEditorState(resume.policy, config) : state),
    [resume, state, config],
  );
  const errors = useMemo(() => validateEditor(shown, config), [shown, config]);
  const valid = !hasErrors(errors);

  const edit = (next: EditorState) => {
    setState(next);
    setReview(null);
    setResume(null);
    prepare.reset();
  };
  const changeAsset = (symbol: string, patch: Partial<AssetChoice>) => {
    const current = state.assets[symbol];
    if (!current) return;
    edit({
      ...state,
      assets: { ...state.assets, [symbol]: { ...current, ...patch } },
    });
  };

  const policyOf = (): WalletPolicy => {
    if (!account) throw new Error("Connect a wallet first.");
    return buildPolicy({ account, config, policies, state: shown });
  };

  const candidate = useMemo((): WalletPolicy | null => {
    if (resume) return resume.policy;
    if (!valid || !account) return null;
    try {
      return buildPolicy({ account, config, policies, state: shown });
    } catch {
      // The same input fails loudly in reviewPolicy; a preview just has no diff.
      return null;
    }
  }, [resume, valid, account, shown, policies, config]);
  const diffLines = useMemo(
    () => (candidate ? diffPolicies(baseline, candidate, config) : []),
    [candidate, baseline, config],
  );

  const reviewPolicy = () => {
    void prepare.run(async (advance) => {
      if (!session || !owner || !account) throw new Error("Sign in first.");
      advance("draft");
      const policy = resume?.policy ?? policyOf();
      const policyId =
        resume?.policyId ??
        (await api.createPolicy(session.token, policy)).policyId;
      await queryClient.invalidateQueries({
        queryKey: ["session", owner, "policies"],
      });
      advance("prepare");
      const identity = await api.whoami(session.token);
      const now = Math.floor(Date.now() / 1000);
      const validUntil = String(now + 86_400);
      const randomEntityId = crypto.getRandomValues(new Uint32Array(1)).at(0);
      if (randomEntityId === undefined)
        throw new Error("Could not choose a session entity ID.");
      const transition = {
        ownerEpoch: identity.ownerEpoch === "0" ? "1" : identity.ownerEpoch,
        validUntil,
        permission: {
          account,
          entityId: (randomEntityId % MAX_SESSION_ENTITY_ID) + 1,
          nativeSpendLimit: "0",
          selectors: [config.performSelector.toLowerCase() as `0x${string}`],
          sessionSigner: config.sessionSigner.toLowerCase() as `0x${string}`,
          target: config.mandateExecutor.toLowerCase() as `0x${string}`,
          validAfter: String(now - 60),
          validUntil,
        },
      };
      const prepared = await api.prepareActivation(
        session.token,
        policyId,
        transition,
      );
      assertPreparedPolicy({
        account,
        owner,
        chainId: config.chainId,
        policy,
        transition,
        prepared,
        tokens: config.tokens.map((token) => token.address),
      });
      setReview({ policyId, policy, prepared, transition });
    });
  };

  const activatePolicy = () => {
    void activate.run(async (advance) => {
      if (
        !session ||
        !owner ||
        !account ||
        (!review && !submitted) ||
        recoveryError
      )
        throw new Error(recoveryError ?? "Review the policy first.");
      let pending = submitted;
      if (!pending) {
        if (!review) throw new Error("Review the policy first.");
        if (
          BigInt(review.transition.validUntil) <=
          BigInt(Math.floor(Date.now() / 1000))
        ) {
          setReview(null);
          throw new Error("This policy review has expired; prepare it again.");
        }
        const allowances = assertPreparedPolicy({
          account,
          owner,
          chainId: config.chainId,
          policy: review.policy,
          transition: review.transition,
          prepared: review.prepared,
          tokens: config.tokens.map((token) => token.address),
        });
        await assertWalletVenue();
        advance("sign-policy");
        const rootSignature = await signTypedData(wagmiConfig, {
          account: owner,
          ...getAccountPolicyTypedData(review.prepared.accountPolicy, {
            chainId: config.chainId,
            verifyingContract: config.mandateExecutor,
          }),
        });
        const callData = encodeAccountPolicyTransition({
          account,
          allowances,
          mandateExecutor: config.mandateExecutor,
          permissionCallData: review.prepared.permissionCallData,
          policy: review.prepared.accountPolicy,
          rootSignature,
        });
        const operation = await sendRootOperation({
          owner,
          account,
          callData,
          sponsor: sponsorFor(config, session),
          onStage: (step, detail) => {
            advance(step);
            if (
              step === "confirm" &&
              detail.transactionHash &&
              detail.userOperationHash
            ) {
              const evidence: PendingActivation = {
                policyId: review.policyId,
                body: {
                  ...review.transition,
                  rootSignature,
                  transactionHash: detail.transactionHash,
                  userOperationHash: detail.userOperationHash,
                },
              };
              writePendingPolicy(
                sessionStorage,
                { owner, account, chainId: Number(config.chainId) },
                evidence,
              );
              setSubmitted(evidence);
            }
          },
        }).catch((error: unknown) => {
          if (error instanceof OperationFailedError) setSubmitted(null);
          throw error;
        });
        pending = {
          policyId: review.policyId,
          body: {
            ...review.transition,
            rootSignature,
            transactionHash: operation.transactionHash,
            userOperationHash: operation.userOperationHash,
          },
        };
        writePendingPolicy(
          sessionStorage,
          { owner, account, chainId: Number(config.chainId) },
          pending,
        );
        setSubmitted(pending);
      }
      advance("record");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = await api.confirmActivation(
          session.token,
          pending.policyId,
          pending.body,
        );
        if (result.status === "ACTIVE") {
          await queryClient.invalidateQueries({
            queryKey: ["session", owner, "policies"],
          });
          clearPendingPolicy(sessionStorage, {
            owner,
            account,
            chainId: Number(config.chainId),
          });
          setSubmitted(null);
          setReview(null);
          return;
        }
        if (result.status !== "PENDING") {
          throw new Error(`Unexpected policy confirmation: ${result.status}`);
        }
        const wait = Promise.withResolvers<void>();
        setTimeout(wait.resolve, 1_500);
        await wait.promise;
      }
      throw new Error(
        "Policy confirmation is still pending. Retry checks the same onchain transaction without another wallet signature.",
      );
    });
  };

  const adapterNames = config.adapters
    .map((adapter) => adapter.protocol)
    .join(" and ");
  const slippageValid = errors.slippage === undefined;
  const lifetimeSeconds = secondsFromMinutes(shown.lifetimeMinutes);

  return (
    <>
      <PolicyReadout
        id="policy"
        label={`${number} / Your policy`}
        config={config}
        active={active}
        revoked={revoked}
        draft={draft}
        confirming={confirming}
        holdings={holdings}
        resumeDisabled={review !== null || submitted !== null}
        onResumeDraft={() => {
          if (!draft) return;
          setResume(draft);
          setReview(null);
        }}
        actions={
          active ? (
            <RevokeAccess
              config={config}
              policy={active}
              holdings={holdings}
              leading={
                <Button
                  variant="ghost"
                  aria-expanded={showEditor}
                  aria-controls="policy-editor"
                  disabled={showEditor}
                  onClick={() => setEditing(true)}
                >
                  Edit limits
                </Button>
              }
            />
          ) : null
        }
      />

      {showEditor ? (
        <Panel
          id="policy-editor"
          label={active ? "Edit limits" : "Set the boundary"}
          className="scroll-mt-28 !border-0"
          aside={
            resume ? (
              <Status tone="pending">Draft v{resume.version}</Status>
            ) : active ? (
              <Status tone="idle">Replaces v{active.version}</Status>
            ) : null
          }
        >
          <div ref={editor} className="scroll-mt-28 space-y-7">
            <div>
              <h2 className="text-2xl font-semibold tracking-[-0.03em] md:text-3xl">
                {active
                  ? "Propose different limits."
                  : "Set the boundary first."}
              </h2>
              <p className="mt-2 max-w-[64ch] text-fog">
                Your policy limits what may be proposed. Only a later signature
                over a specific simulated mandate can authorize one action.
                {active
                  ? ` Nothing here changes policy v${active.version} until you sign and the chain confirms.`
                  : ""}
              </p>
            </div>

            {resume ? (
              <p className="border-l-2 border-statuspending pl-4 font-mono text-xs text-pending-ink">
                Resuming saved draft v{resume.version}. Its values are shown
                below and cannot be edited here. Cancel to propose different
                limits.
              </p>
            ) : null}

            <div className="grid gap-px border border-rule bg-rule md:grid-cols-2">
              {config.tokens.map((token) => {
                const choice = shown.assets[token.symbol];
                const own = errors.assets[token.symbol];
                const entry = holdings?.tokens[token.symbol];
                if (!choice) return null;
                return (
                  <fieldset
                    key={token.address}
                    disabled={locked}
                    className="min-w-0 space-y-4 bg-paper p-5"
                  >
                    <legend className="sr-only">{token.symbol}</legend>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="text-xl font-semibold tracking-[-0.02em]">
                        {token.symbol}
                      </h3>
                      <span className="font-mono text-[11px] text-fog">
                        {token.address.slice(0, 8)}…{token.address.slice(-4)} ·{" "}
                        {token.decimals} decimals
                      </span>
                    </div>
                    <p className="font-mono text-[12px] text-fog">
                      {entry
                        ? `Account holds ${compact(entry.balance, token.decimals)} ${token.symbol}`
                        : "Reading balance"}
                    </p>
                    <ModeControl
                      symbol={token.symbol}
                      mode={choice.mode}
                      disabled={locked}
                      onChange={(mode) => changeAsset(token.symbol, { mode })}
                    />
                    {choice.mode === "active" ? (
                      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                        <AmountField
                          label="Max per task"
                          unit={token.symbol}
                          value={choice.max}
                          error={own?.max}
                          disabled={locked}
                          onChange={(max) => changeAsset(token.symbol, { max })}
                        />
                        <AmountField
                          label="24h cap"
                          unit={token.symbol}
                          value={choice.daily}
                          error={own?.daily}
                          disabled={locked}
                          onChange={(daily) =>
                            changeAsset(token.symbol, { daily })
                          }
                        />
                      </div>
                    ) : null}
                  </fieldset>
                );
              })}
            </div>
            {errors.general ? (
              <p
                role="alert"
                className="border-l-2 border-fail-ink pl-4 text-sm text-fail-ink"
              >
                {errors.general}
              </p>
            ) : null}

            <div className="grid gap-x-6 gap-y-6 md:grid-cols-2">
              <div className="space-y-3">
                <AmountField
                  label="Maximum slippage"
                  unit="bps"
                  inputMode="numeric"
                  value={shown.slippageBps}
                  error={errors.slippage}
                  hint={
                    slippageValid
                      ? `= ${percentOfBps(shown.slippageBps)}%`
                      : undefined
                  }
                  disabled={locked}
                  onChange={(slippageBps) => edit({ ...state, slippageBps })}
                />
                <Presets
                  label="Slippage presets"
                  options={SLIPPAGE_PRESETS}
                  current={shown.slippageBps}
                  disabled={locked}
                  onPick={(slippageBps) => edit({ ...state, slippageBps })}
                />
              </div>
              <div className="space-y-3">
                <AmountField
                  label="Maximum task lifetime"
                  unit="min"
                  value={shown.lifetimeMinutes}
                  error={errors.lifetime}
                  hint={
                    lifetimeSeconds === null
                      ? undefined
                      : `= ${lifetimeSeconds.toLocaleString("en-US")} seconds`
                  }
                  disabled={locked}
                  onChange={(lifetimeMinutes) =>
                    edit({ ...state, lifetimeMinutes })
                  }
                />
                <Presets
                  label="Lifetime presets"
                  options={LIFETIME_PRESETS}
                  current={shown.lifetimeMinutes}
                  disabled={locked}
                  onPick={(lifetimeMinutes) =>
                    edit({ ...state, lifetimeMinutes })
                  }
                />
              </div>
            </div>

            <p className="max-w-[70ch] text-sm text-fog">
              Only the pinned {adapterNames} adapters are enabled. The recipient
              is always this smart account. Protected tokens can never be spent;
              switching them to Off removes that protection.
            </p>

            {recoveryError ? (
              <p
                role="alert"
                className="border-l-2 border-fail-ink pl-4 text-sm text-fail-ink"
              >
                {recoveryError}
              </p>
            ) : null}

            {submitted && !review ? (
              <div className="border border-rule p-5">
                <Status tone="pending">Owner transaction submitted</Status>
                <p className="mt-3 text-sm text-fog">
                  The signed policy transition is already on chain or awaiting
                  its receipt. Resume only the API finality check; no wallet
                  prompt or new transaction.
                </p>
                <Button
                  className="mt-4"
                  busy={activate.busy}
                  onClick={activatePolicy}
                >
                  Continue confirmation
                </Button>
                {activate.state.phase === "failed" ? (
                  <FailureNotice
                    failure={activate.state.failure}
                    onRetry={activatePolicy}
                  />
                ) : null}
              </div>
            ) : null}

            {!review && !submitted && !recoveryError ? (
              <div className="space-y-5">
                {candidate || resume ? (
                  <DiffSummary
                    lines={diffLines}
                    baseVersion={active?.version ?? null}
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    arrow
                    busy={prepare.busy}
                    disabled={!valid && !resume}
                    onClick={reviewPolicy}
                  >
                    Review exact limits
                  </Button>
                  {active || resume ? (
                    <Button
                      variant="ghost"
                      disabled={prepare.busy}
                      onClick={() => {
                        setEditing(false);
                        setResume(null);
                        setState(initialEditorState(baseline, config));
                        prepare.reset();
                      }}
                    >
                      {resume && !active ? "Discard review" : "Cancel"}
                    </Button>
                  ) : null}
                  {!valid && !resume ? (
                    <span className="font-mono text-[12px] text-fail-ink">
                      Fix the highlighted fields to continue.
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
            {prepare.state.phase === "failed" ? (
              <FailureNotice
                failure={prepare.state.failure}
                onRetry={() => prepare.reset()}
              />
            ) : null}

            {review ? (
              <ActivationReview
                config={config}
                owner={owner}
                account={account}
                review={review}
                submitted={submitted}
                state={activate.state}
                busy={activate.busy}
                onActivate={activatePolicy}
                onBack={() => {
                  setReview(null);
                  activate.reset();
                }}
              />
            ) : null}

            {holdings &&
            holdings.ownerNative === 0n &&
            !config.sponsorship.enabled ? (
              <p className="text-sm text-fail-ink">
                Your owner wallet needs tBNB to pay for the activation
                transaction. The faucet only funds your smart account.
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
