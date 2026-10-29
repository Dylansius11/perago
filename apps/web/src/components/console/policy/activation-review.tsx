"use client";

import type {
  Address,
  ConfirmPolicyActivationRequest,
  PolicyTransitionPrepared,
  PublicConfig,
  WalletPolicy,
} from "@perago/sdk";
import { formatUnits } from "viem";
import { type ActionState, StepList } from "../action";
import { Button, Fact, FailureNotice, Label } from "../ui";

/* The signing surface for a policy activation: every field the wallet will bind, then the steps. */

export type Review = {
  policyId: string;
  policy: WalletPolicy;
  prepared: PolicyTransitionPrepared;
  transition: Pick<
    ConfirmPolicyActivationRequest,
    "ownerEpoch" | "validUntil" | "permission"
  >;
};

export type PendingActivation = {
  policyId: string;
  body: ConfirmPolicyActivationRequest;
};

export function ActivationReview({
  config,
  owner,
  account,
  review,
  submitted,
  state,
  busy,
  onActivate,
  onBack,
  backLabel = "Back to choices",
}: {
  config: PublicConfig;
  owner: Address | null;
  account: Address | null;
  review: Review;
  submitted: PendingActivation | null;
  state: ActionState<void>;
  busy: boolean;
  onActivate: () => void;
  onBack: () => void;
  backLabel?: string;
}) {
  return (
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
            (item) => item.address.toLowerCase() === asset.token.toLowerCase(),
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
        {review.prepared.allowances.map((allowance) => {
          const token = config.tokens.find(
            (item) =>
              item.address.toLowerCase() === allowance.token.toLowerCase(),
          );
          return (
            <Fact
              dark
              key={`allowance-${allowance.token}`}
              label={`${token?.symbol ?? allowance.token} allowance`}
              value={
                allowance.amount === "0"
                  ? "0, the executor cannot pull it"
                  : `${token ? formatUnits(BigInt(allowance.amount), token.decimals) : allowance.amount} in total until you revoke or change this policy`
              }
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
        MandateExecutor may pull an allowed token only for a mandate you sign,
        and never more than the allowance above. Wallet prompt 1 signs this
        EIP-712 policy. Prompt 2 signs the UserOperation that installs the
        session, records the policy, and sets these allowances.{" "}
        {config.sponsorship.enabled
          ? "Perago sponsors the gas; a third prompt to pay it yourself appears only if sponsorship is refused."
          : "Prompt 3 pays for EntryPoint.handleOps from your owner wallet."}{" "}
        The session expires above and cannot install modules, upgrade the
        account, or spend native value.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Button
          variant="signal"
          className="hover:bg-paper hover:text-ink"
          busy={busy}
          onClick={onActivate}
        >
          {submitted ? "Continue confirmation" : "Sign and activate"}
        </Button>
        {!submitted ? (
          <Button variant="ghost-dark" disabled={busy} onClick={onBack}>
            {backLabel}
          </Button>
        ) : null}
      </div>
      {submitted ? (
        <p className="mt-4 text-sm text-paper/70">
          The owner transaction was submitted. Confirmation may take more
          blocks; retry only checks that same transaction, with no new wallet
          prompt.
        </p>
      ) : null}
      {state.phase !== "idle" ? (
        <div className="mt-6">
          <StepList
            dark
            state={state}
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
                  "Session installation, policy registration, and the allowances above.",
                prompt: true,
              },
              {
                id: "send",
                title: config.sponsorship.enabled
                  ? "Submit to the bundler"
                  : "Send handleOps",
                detail: config.sponsorship.enabled
                  ? "Gas is sponsored. If sponsorship is refused, your wallet sends the same signed operation and pays gas."
                  : "Your owner wallet pays transaction gas.",
                prompt: !config.sponsorship.enabled,
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
      {state.phase === "failed" ? (
        <div className="mt-5">
          <FailureNotice dark failure={state.failure} onRetry={onActivate} />
        </div>
      ) : null}
    </div>
  );
}
