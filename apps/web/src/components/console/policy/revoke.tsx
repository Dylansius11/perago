"use client";

import {
  encodeAccountPolicyTransition,
  getAccountPolicyTypedData,
  type PolicyTransitionPrepared,
  type PolicyView,
  type PublicConfig,
} from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { signTypedData } from "wagmi/actions";
import { api } from "@/lib/api";
import { compact, utc } from "@/lib/format";
import {
  clearPendingRevocation,
  type PendingRevocation,
  readPendingRevocation,
  writePendingRevocation,
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
import { StepList, useStagedAction } from "../action";
import { Button, EASE, FailureNotice, Hash, Label, Scan, Status } from "../ui";
import { joinList } from "./describe";
import { Evidence } from "./evidence";
import { assertPreparedRevocation } from "./revocation";

/*
 * Revoke all access: the same root-operation path as activation, run in the
 * other direction. The API prepares the exact account policy and session
 * removal, `assertPreparedRevocation` refuses anything that is not "end this
 * policy", the owner signs once as EIP-712 and once as a UserOperation, and
 * the API marks the policy revoked only after it reads the result on chain.
 */

type Review = {
  prepared: PolicyTransitionPrepared;
  validUntil: string;
};

export function RevokeAccess({
  config,
  policy,
  holdings,
  leading,
}: {
  config: PublicConfig;
  policy: PolicyView;
  holdings: Holdings | undefined;
  /** Sibling actions rendered before the trigger, so one row holds them all. */
  leading?: ReactNode;
}) {
  const { owner, account, session } = useSession();
  const queryClient = useQueryClient();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [submitted, setSubmitted] = useState<PendingRevocation | null>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const prepare = useStagedAction<void>();
  const revoke = useStagedAction<void>();
  const heading = useRef<HTMLHeadingElement>(null);
  const visible = open || submitted !== null;

  useEffect(() => {
    if (!owner || !account) return;
    const identity = { owner, account, chainId: Number(config.chainId) };
    try {
      const pending = readPendingRevocation(sessionStorage, identity);
      if (pending && pending.policyId !== policy.policyId) {
        clearPendingRevocation(sessionStorage, identity);
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
  }, [owner, account, config.chainId, policy.policyId]);

  useEffect(() => {
    if (visible) heading.current?.focus();
  }, [visible]);

  const symbols = joinList(config.tokens.map((token) => token.symbol));

  const reviewRevocation = () => {
    setOpen(true);
    void prepare.run(async (advance) => {
      if (!session || !owner || !account) throw new Error("Sign in first.");
      advance("prepare");
      const identity = await api.whoami(session.token);
      const validUntil = String(Math.floor(Date.now() / 1000) + 86_400);
      const prepared = await api.preparePolicyRevocation(
        session.token,
        policy.policyId,
        { validUntil },
      );
      assertPreparedRevocation({
        account,
        owner,
        chainId: config.chainId,
        ownerEpoch: identity.ownerEpoch,
        validUntil,
        policy,
        prepared,
        tokens: config.tokens.map((token) => token.address),
      });
      setReview({ prepared, validUntil });
    });
  };

  const close = () => {
    setOpen(false);
    setReview(null);
    prepare.reset();
    revoke.reset();
  };

  const revokePolicy = () => {
    void revoke.run(async (advance) => {
      if (
        !session ||
        !owner ||
        !account ||
        (!review && !submitted) ||
        recoveryError
      )
        throw new Error(recoveryError ?? "Review the revocation first.");
      const identity = { owner, account, chainId: Number(config.chainId) };
      let pending = submitted;
      if (!pending) {
        if (!review) throw new Error("Review the revocation first.");
        if (
          BigInt(review.validUntil) <= BigInt(Math.floor(Date.now() / 1000))
        ) {
          setReview(null);
          throw new Error(
            "This revocation review has expired; prepare it again.",
          );
        }
        const allowances = assertPreparedRevocation({
          account,
          owner,
          chainId: config.chainId,
          ownerEpoch: (await api.whoami(session.token)).ownerEpoch,
          validUntil: review.validUntil,
          policy,
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
              const evidence: PendingRevocation = {
                policyId: policy.policyId,
                body: {
                  validUntil: review.validUntil,
                  rootSignature,
                  transactionHash: detail.transactionHash,
                  userOperationHash: detail.userOperationHash,
                },
              };
              writePendingRevocation(sessionStorage, identity, evidence);
              setSubmitted(evidence);
            }
          },
        }).catch((error: unknown) => {
          if (error instanceof OperationFailedError) setSubmitted(null);
          throw error;
        });
        pending = {
          policyId: policy.policyId,
          body: {
            validUntil: review.validUntil,
            rootSignature,
            transactionHash: operation.transactionHash,
            userOperationHash: operation.userOperationHash,
          },
        };
        writePendingRevocation(sessionStorage, identity, pending);
        setSubmitted(pending);
      }
      advance("record");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = await api.confirmPolicyRevocation(
          session.token,
          pending.policyId,
          pending.body,
        );
        if (result.status === "REVOKED") {
          clearPendingRevocation(sessionStorage, identity);
          setSubmitted(null);
          setReview(null);
          setOpen(false);
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["session", owner, "policies"],
            }),
            queryClient.invalidateQueries({ queryKey: ["chain"] }),
          ]);
          return;
        }
        if (result.status !== "PENDING")
          throw new Error(
            `Unexpected revocation confirmation: ${result.status}`,
          );
        const wait = Promise.withResolvers<void>();
        setTimeout(wait.resolve, 1_500);
        await wait.promise;
      }
      throw new Error(
        "Revocation confirmation is still pending. Retry checks the same onchain transaction without another wallet signature.",
      );
    });
  };

  const permission = policy.permission;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        {leading}
        <Button
          variant="danger"
          disabled={visible}
          aria-expanded={visible}
          aria-controls="policy-revoke"
          onClick={reviewRevocation}
        >
          Revoke all access
        </Button>
      </div>
      {visible ? (
        <motion.div
          id="policy-revoke"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: EASE }}
          className="mt-5 border border-ruleinvert bg-ink p-5 text-paper md:p-8"
        >
          <Label dark>What your wallet signs</Label>
          <h3
            ref={heading}
            tabIndex={-1}
            className="mt-2 text-2xl font-semibold tracking-[-0.03em] outline-none"
          >
            End policy v{policy.version} and all of its access.
          </h3>
          <p className="mt-4 max-w-[68ch] text-[15px] leading-relaxed text-paper/80">
            Revoking removes the session Perago uses, sets the {symbols}{" "}
            allowances to MandateExecutor to 0, and replaces the policy hash the
            contract checks. No new mandate can be authorized until you activate
            a new policy. A mandate you already authorized stays recorded until
            it expires, but it can no longer pull your tokens: the session is
            gone and the allowances are 0.
          </p>

          <div aria-live="polite">
            {prepare.state.phase === "running" ? (
              <div className="relative mt-6 border border-ruleinvert px-4 py-5">
                <Status dark tone="pending">
                  Preparing the exact revocation
                </Status>
                <Scan />
              </div>
            ) : null}
            {prepare.state.phase === "failed" ? (
              <div className="mt-6">
                <FailureNotice
                  dark
                  failure={prepare.state.failure}
                  onRetry={reviewRevocation}
                />
              </div>
            ) : null}
          </div>

          {review || submitted ? (
            <dl className="mt-6">
              <Evidence dark label="Root owner" value={owner} />
              <Evidence dark label="Account" value={account} />
              <Evidence
                dark
                label="Chain"
                value={`BSC Testnet · ${config.chainId} · ${config.venue}`}
              />
              <Evidence dark label="Executor" value={config.mandateExecutor} />
              <Evidence
                dark
                label="Ends policy"
                value={`v${policy.version}`}
                note={<Hash dark value={policy.policyHash} />}
              />
              {review ? (
                <Evidence
                  dark
                  label="Replaced by"
                  value={
                    <Hash
                      dark
                      value={review.prepared.accountPolicy.policyHash}
                    />
                  }
                  note="A revocation hash no mandate can carry."
                />
              ) : null}
              {permission ? (
                <Evidence
                  dark
                  label="Removes session"
                  value={`${permission.sessionSigner} · entity ${permission.entityId}`}
                />
              ) : null}
              {config.tokens.map((token) => {
                const entry = holdings?.tokens[token.symbol];
                return (
                  <Evidence
                    dark
                    key={token.address}
                    label={`${token.symbol} allowance`}
                    value="0, the executor cannot pull it"
                    note={
                      entry
                        ? `Now ${compact(entry.allowance, token.decimals)} ${token.symbol}.`
                        : undefined
                    }
                  />
                );
              })}
              {review ? (
                <Evidence
                  dark
                  label="Signature valid until"
                  value={utc(Number(review.validUntil))}
                />
              ) : null}
            </dl>
          ) : null}

          {review || submitted ? (
            <p className="mt-5 max-w-[68ch] text-sm text-paper/70">
              Wallet prompt 1 signs this EIP-712 revocation. Prompt 2 signs the
              UserOperation that removes the session, records the revocation,
              and zeroes the allowances.{" "}
              {config.sponsorship.enabled
                ? "Perago's bundler pays the gas; a third prompt to pay it yourself appears only if sponsorship is refused."
                : "Prompt 3 pays for EntryPoint.handleOps from your owner wallet."}{" "}
              Revoking does not move any tokens.
            </p>
          ) : null}

          {recoveryError ? (
            <p
              role="alert"
              className="mt-5 border-l-2 border-statusfail pl-4 text-sm text-paper"
            >
              {recoveryError}
            </p>
          ) : null}

          {review || submitted ? (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                variant="signal"
                className="hover:bg-paper hover:text-ink"
                busy={revoke.busy}
                disabled={recoveryError !== null}
                onClick={revokePolicy}
              >
                {submitted ? "Continue confirmation" : "Sign and revoke"}
              </Button>
              {!submitted ? (
                <Button
                  variant="ghost-dark"
                  disabled={revoke.busy}
                  onClick={close}
                >
                  Keep policy
                </Button>
              ) : null}
            </div>
          ) : prepare.state.phase === "failed" ? (
            <div className="mt-6">
              <Button variant="ghost-dark" onClick={close}>
                Keep policy
              </Button>
            </div>
          ) : null}

          {submitted ? (
            <p className="mt-4 max-w-[68ch] text-sm text-paper/70">
              The owner transaction was submitted. Confirmation may take more
              blocks; retry only checks that same transaction, with no new
              wallet prompt.
            </p>
          ) : null}

          {revoke.state.phase !== "idle" ? (
            <div className="mt-6">
              <StepList
                dark
                state={revoke.state}
                steps={[
                  {
                    id: "sign-policy",
                    title: "Sign EIP-712 revocation",
                    detail:
                      "The fields above. It ends this policy and nothing else.",
                    prompt: true,
                  },
                  {
                    id: "sign",
                    title: "Sign UserOperation hash",
                    detail:
                      "Session removal, the revocation record, and the allowances set to 0.",
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
                    title: "Reconcile revocation",
                    detail:
                      "The API checks the exact onchain result before it marks the policy revoked.",
                  },
                ]}
              />
            </div>
          ) : null}
          {revoke.state.phase === "failed" ? (
            <div className="mt-5">
              <FailureNotice
                dark
                failure={revoke.state.failure}
                onRetry={revokePolicy}
              />
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </div>
  );
}
