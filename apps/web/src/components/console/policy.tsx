"use client";

import {
  encodeAccountPolicyTransition,
  getAccountPolicyTypedData,
  MAX_SESSION_ENTITY_ID,
  type PolicyView,
  type PublicConfig,
  type WalletPolicy,
  walletPolicySchema,
} from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { signTypedData } from "wagmi/actions";
import { api } from "@/lib/api";
import { assertPreparedPolicy } from "@/lib/authority";
import {
  clearPendingPolicy,
  readPendingPolicy,
  writePendingPolicy,
} from "@/lib/policy-pending";
import type { Holdings } from "@/lib/queries";
import { OperationFailedError, sendRootOperation } from "@/lib/root-operation";
import { useSession } from "@/lib/session";
import { assertWalletVenue } from "@/lib/venue";
import { wagmiConfig } from "@/lib/wagmi";
import { StepList, useStagedAction } from "./action";
import { Button, Fact, FailureNotice, Label, Status } from "./ui";

/* One policy is the owner's standing envelope, not a blanket session. */
type Mode = "active" | "protected" | "off";
type AssetChoice = { mode: Mode; max: string; daily: string };
type Review = {
  policyId: string;
  policy: WalletPolicy;
  prepared: Awaited<ReturnType<typeof api.prepareActivation>>;
  transition: {
    ownerEpoch: string;
    validUntil: string;
    permission: {
      account: `0x${string}`;
      entityId: number;
      nativeSpendLimit: string;
      selectors: `0x${string}`[];
      sessionSigner: `0x${string}`;
      target: `0x${string}`;
      validAfter: string;
      validUntil: string;
    };
  };
};
type PendingActivation = {
  policyId: string;
  body: Review["transition"] & {
    rootSignature: `0x${string}`;
    transactionHash: `0x${string}`;
    userOperationHash: `0x${string}`;
  };
};

function initialChoice(symbol: string): AssetChoice {
  return {
    mode: symbol === "WBNB" ? "active" : "protected",
    max: "0.01",
    daily: "0.05",
  };
}

export function PolicyComposer({
  config,
  policies,
  holdings,
}: {
  config: PublicConfig;
  policies: PolicyView[];
  holdings: Holdings | undefined;
}) {
  const { owner, account, session } = useSession();
  const queryClient = useQueryClient();
  const [assets, setAssets] = useState<Record<string, AssetChoice>>({});
  const [slippage, setSlippage] = useState("100");
  const [lifetime, setLifetime] = useState("1800");
  const [review, setReview] = useState<Review | null>(null);
  const [submitted, setSubmitted] = useState<PendingActivation | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [resume, setResume] = useState<PolicyView | null>(null);
  const prepare = useStagedAction<void>();
  const activate = useStagedAction<void>();
  const draft = policies.find((entry) => entry.status === "DRAFT") ?? null;
  const active = policies.find((entry) => entry.status === "ACTIVE") ?? null;
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
  const choiceOf = (symbol: string) => assets[symbol] ?? initialChoice(symbol);
  const change = (symbol: string, next: AssetChoice) => {
    setAssets((current) => ({ ...current, [symbol]: next }));
    setReview(null);
    setResume(null);
    prepare.reset();
  };

  const policyOf = (): WalletPolicy => {
    if (!account) throw new Error("Connect a wallet first.");
    const activeAssets = config.tokens
      .filter((token) => choiceOf(token.symbol).mode === "active")
      .map((token) => ({
        token: token.address.toLowerCase() as `0x${string}`,
        maxInputPerTask: parseUnits(
          choiceOf(token.symbol).max,
          token.decimals,
        ).toString(),
        rollingDailyCap: parseUnits(
          choiceOf(token.symbol).daily,
          token.decimals,
        ).toString(),
      }));
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
        .filter((token) => choiceOf(token.symbol).mode === "protected")
        .map((token) => token.address.toLowerCase()),
      activeAssets,
      services: [...new Set(config.adapters.map((adapter) => adapter.kind))],
      approvedAdapterIds: config.adapters.map((adapter) => adapter.id),
      maxSlippageBps: slippage,
      allowedRecipients: "SELF",
      maxTaskLifetimeSeconds: lifetime,
    });
  };

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
        assertPreparedPolicy({
          account,
          owner,
          chainId: config.chainId,
          policy: review.policy,
          transition: review.transition,
          prepared: review.prepared,
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
          mandateExecutor: config.mandateExecutor,
          permissionCallData: review.prepared.permissionCallData,
          policy: review.prepared.accountPolicy,
          rootSignature,
        });
        const operation = await sendRootOperation({
          owner,
          account,
          callData,
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
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      throw new Error(
        "Policy confirmation is still pending. Retry checks the same onchain transaction without another wallet signature.",
      );
    });
  };

  return (
    <div className="space-y-7">
      {active ? (
        <div className="border-l-2 border-ok-ink pl-4">
          <Status tone="ok">Policy v{active.version} active</Status>
          <p className="mt-2 text-sm text-fog">
            A new policy supersedes it on chain only after your root signature
            and a confirmed UserOperation.
          </p>
        </div>
      ) : null}
      {draft && !review && !resume ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border border-rule p-4">
          <div>
            <Status tone="pending">Draft v{draft.version}</Status>
            <p className="mt-1 text-sm text-fog">
              A previous review stopped before activation.
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setResume(draft);
              setReview(null);
            }}
          >
            Resume this draft
          </Button>
        </div>
      ) : null}
      {resume ? (
        <p className="font-mono text-xs text-signal-ink">
          Resuming saved draft v{resume.version}; choices below are not editable
          until its review finishes.
        </p>
      ) : null}
      <div className="grid gap-px bg-rule md:grid-cols-2">
        {config.tokens.map((token) => {
          const choice = choiceOf(token.symbol);
          return (
            <fieldset
              key={token.address}
              disabled={!!resume || !!review}
              className="min-w-0 bg-paper p-5"
            >
              <legend className="font-semibold">{token.symbol}</legend>
              <Label className="block">
                {token.address.slice(0, 10)}… · {token.decimals} decimals
              </Label>
              <div className="mt-4 flex flex-wrap gap-3 font-mono text-xs">
                {(["active", "protected", "off"] as const).map((mode) => (
                  <label
                    key={mode}
                    className="inline-flex cursor-pointer items-center gap-1.5"
                  >
                    <input
                      type="radio"
                      name={`asset-${token.address}`}
                      checked={choice.mode === mode}
                      onChange={() => change(token.symbol, { ...choice, mode })}
                    />
                    {mode}
                  </label>
                ))}
              </div>
              {choice.mode === "active" ? (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {(["max", "daily"] as const).map((field) => (
                    <label key={field} className="space-y-1">
                      <Label className="block">
                        {field === "max" ? "Max per task" : "24h cap"}
                      </Label>
                      <input
                        inputMode="decimal"
                        aria-label={`${token.symbol} ${field === "max" ? "maximum input per task" : "rolling 24-hour cap"}`}
                        className="w-full border border-rule bg-paper px-2 py-2 font-mono text-sm focus:border-ink focus:outline-none"
                        value={choice[field]}
                        onChange={(event) =>
                          change(token.symbol, {
                            ...choice,
                            [field]: event.target.value,
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              ) : null}
            </fieldset>
          );
        })}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <label className="space-y-2">
          <Label className="block">Maximum slippage (basis points)</Label>
          <input
            type="number"
            min="0"
            max="10000"
            value={slippage}
            disabled={!!resume || !!review}
            onChange={(event) => {
              setSlippage(event.target.value);
              setReview(null);
            }}
            className="w-full border border-rule bg-paper px-3 py-2 font-mono focus:border-ink focus:outline-none"
          />
        </label>
        <label className="space-y-2">
          <Label className="block">Maximum task lifetime (seconds)</Label>
          <input
            type="number"
            min="1"
            value={lifetime}
            disabled={!!resume || !!review}
            onChange={(event) => {
              setLifetime(event.target.value);
              setReview(null);
            }}
            className="w-full border border-rule bg-paper px-3 py-2 font-mono focus:border-ink focus:outline-none"
          />
        </label>
      </div>
      <p className="max-w-[70ch] text-sm text-fog">
        Only the pinned{" "}
        {config.adapters.map((adapter) => adapter.protocol).join(" and ")}{" "}
        adapters are enabled. The recipient is always this smart account.
        Protected tokens can never be spent; switching them to “off” removes
        that protection.
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
            The signed policy transition is already on chain or awaiting its
            receipt. Resume only the API finality check; no wallet prompt or new
            transaction.
          </p>
          <Button busy={activate.busy} onClick={activatePolicy}>
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
        <Button arrow busy={prepare.busy} onClick={reviewPolicy}>
          Review exact limits
        </Button>
      ) : null}
      {prepare.state.phase === "failed" ? (
        <FailureNotice
          failure={prepare.state.failure}
          onRetry={() => prepare.reset()}
        />
      ) : null}
      {review ? (
        <div className="border border-ruleinvert bg-ink p-5 text-paper md:p-8">
          <Label dark>What your wallet signs</Label>
          <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
            One account policy. One scoped session.
          </h3>
          <dl className="mt-5">
            <Fact dark label="Root owner" value={owner} />
            <Fact dark label="Account" value={account} />
            <Fact
              dark
              label="Chain"
              value={`BSC Testnet · ${config.chainId} · ${config.venue}`}
            />
            <Fact dark label="Executor" value={config.mandateExecutor} />
            <Fact dark label="Session signer" value={config.sessionSigner} />
            <Fact dark label="Only call" value={config.performSelector} />
            <Fact dark label="Native spend" value="0" />
            <Fact
              dark
              label="Expires"
              value={new Date(
                Number(review.transition.validUntil) * 1000,
              ).toLocaleString()}
            />
            {review.policy.activeAssets.map((asset) => {
              const token = config.tokens.find(
                (item) =>
                  item.address.toLowerCase() === asset.token.toLowerCase(),
              );
              return (
                <Fact
                  dark
                  key={asset.token}
                  label={`${token?.symbol ?? asset.token} spend`}
                  value={`${token ? formatUnits(BigInt(asset.maxInputPerTask), token.decimals) : asset.maxInputPerTask} per task · ${token ? formatUnits(BigInt(asset.rollingDailyCap), token.decimals) : asset.rollingDailyCap} per 24h`}
                />
              );
            })}
            <Fact
              dark
              label="Protected"
              value={
                review.policy.protectedAssets
                  .map(
                    (address) =>
                      config.tokens.find(
                        (token) => token.address.toLowerCase() === address,
                      )?.symbol ?? address,
                  )
                  .join(", ") || "none"
              }
            />
            <Fact
              dark
              label="Policy hash"
              value={review.prepared.accountPolicy.policyHash}
            />
            <Fact
              dark
              label="Permission hash"
              value={review.prepared.accountPolicy.permissionHash}
            />
          </dl>
          <p className="mt-5 text-sm text-paper/70">
            Wallet prompt 1 signs this exact EIP-712 policy. Prompt 2 signs a
            32-byte UserOperation hash; prompt 3 pays for EntryPoint.handleOps.
            Session authority expires above; it cannot install modules, upgrade
            the account, or spend native value.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant="signal"
              busy={activate.busy}
              onClick={activatePolicy}
            >
              {submitted ? "Continue confirmation" : "Sign and activate"}
            </Button>
            {!submitted ? (
              <Button
                variant="ghost-dark"
                disabled={activate.busy}
                onClick={() => {
                  setReview(null);
                  activate.reset();
                }}
              >
                Back to choices
              </Button>
            ) : null}
          </div>
          {submitted ? (
            <p className="mt-4 text-sm text-paper/70">
              The owner transaction was submitted. Confirmation may take more
              blocks; retry only checks that same transaction, with no new
              wallet prompt.
            </p>
          ) : null}
          {activate.state.phase !== "idle" ? (
            <div className="mt-6">
              <StepList
                dark
                state={activate.state}
                steps={[
                  {
                    id: "sign-policy",
                    title: "Sign EIP-712 policy",
                    detail: "The fields above, with no blanket access.",
                    prompt: true,
                  },
                  {
                    id: "sign",
                    title: "Sign UserOperation hash",
                    detail:
                      "Only installation of this session and policy registration.",
                    prompt: true,
                  },
                  {
                    id: "send",
                    title: "Send handleOps",
                    detail: "Your owner wallet pays transaction gas.",
                    prompt: true,
                  },
                  {
                    id: "confirm",
                    title: "Confirm on chain",
                    detail: "EntryPoint must report UserOperation success.",
                  },
                  {
                    id: "record",
                    title: "Reconcile policy",
                    detail:
                      "The API checks the exact onchain result before it marks the policy active.",
                  },
                ]}
              />
            </div>
          ) : null}
          {activate.state.phase === "failed" ? (
            <div className="mt-5">
              <FailureNotice
                dark
                failure={activate.state.failure}
                onRetry={activatePolicy}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      {holdings && holdings.ownerNative === 0n ? (
        <p className="text-sm text-fail-ink">
          Your owner wallet needs tBNB to pay for the activation transaction.
          The faucet only funds your smart account.
        </p>
      ) : null}
    </div>
  );
}
