"use client";

import {
  type FaucetClaim,
  type FaucetClaimResponse,
  type FaucetStatus,
  REASON_MESSAGES,
} from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";
import { toFailure } from "@/lib/failure";
import { amount, utc } from "@/lib/format";
import { useFaucet, useHoldings, usePublicConfig } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { useStagedAction } from "./action";
import { Button, Fact, FailureNotice, Hash, Label, Panel, Status } from "./ui";

/*
 * The faucet is an API-funded transfer, not a root UserOperation. Its API
 * claim is only a reservation/broadcast record; this surface calls funds
 * received only after GET /faucet has observed an onchain confirmation.
 */

function ClaimState({
  claim,
  response,
  explorer,
}: {
  claim: FaucetClaim | null;
  response: FaucetClaimResponse | null;
  explorer: string | null;
}) {
  const currentClaim =
    response && claim?.claimId !== response.claimId ? null : claim;
  const status = currentClaim?.status ?? response?.status ?? null;
  const hash =
    currentClaim?.transactionHash ?? response?.transactionHash ?? null;
  const confirmed = status === "CONFIRMED";
  const failed = status === "FAILED";
  const pending = status === "PENDING" || status === "BROADCAST";

  if (!status) return null;

  return (
    <div className="border-t border-rule pt-5" aria-live="polite">
      <Status tone={confirmed ? "ok" : failed ? "fail" : "pending"}>
        {confirmed
          ? "Funds confirmed"
          : failed
            ? "Transfer failed"
            : "Awaiting confirmation"}
      </Status>
      <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-fog">
        {confirmed
          ? "The faucet transfer is confirmed on chain 97."
          : failed
            ? "The faucet transfer did not confirm on chain 97. No funds are shown as received."
            : pending
              ? status === "PENDING"
                ? "The request is safely reserved. The faucet has not yet recorded a broadcast transaction."
                : "The transfer was broadcast and is waiting for an onchain receipt. Funds are not confirmed yet."
              : "The faucet is checking this transfer's onchain state."}
      </p>
      {hash ? (
        <div className="mt-3 text-[13px]">
          <Label className="mb-1 block">Transaction</Label>
          <Hash
            value={hash}
            href={explorer ? `${explorer}${hash}` : null}
            full
          />
        </div>
      ) : null}
    </div>
  );
}

function Eligibility({ status }: { status: FaucetStatus }) {
  if (status.eligible) {
    return (
      <div className="border-l-2 border-signal pl-4">
        <Status tone="signal">Eligible</Status>
        <p className="mt-2 max-w-[58ch] text-[15px] leading-relaxed text-fog">
          Request one {amount(status.amountWei, 18)} tBNB transfer to your smart
          account. The API rechecks the wallet, account balance, daily budget,
          and client rate limit before it broadcasts anything.
        </p>
      </div>
    );
  }

  return (
    <div className="border-l-2 border-fail-ink pl-4" role="status">
      <Status tone="fail">{status.reasonCode ?? "Not eligible"}</Status>
      <p className="mt-2 max-w-[58ch] text-[15px] leading-relaxed text-fog">
        {status.reasonCode
          ? REASON_MESSAGES[status.reasonCode]
          : "The faucet cannot accept a claim right now."}
      </p>
    </div>
  );
}

export function Faucet() {
  const queryClient = useQueryClient();
  const { owner, session, expire } = useSession();
  const config = usePublicConfig();
  const faucet = useFaucet(
    session !== null && config.data?.faucet.enabled === true,
  );
  const holdings = useHoldings(config.data);
  const action = useStagedAction<FaucetClaimResponse>();
  const status = faucet.data;
  const activeClaim =
    status?.lastClaim?.status === "PENDING" ||
    status?.lastClaim?.status === "BROADCAST";
  const response = action.state.phase === "done" ? action.state.result : null;
  const explorer = config.data?.explorer?.transaction ?? null;
  const venue = config.data?.venue ?? "testnet";
  const deploymentLabel = config.data?.deploymentLabel ?? "chain configuration";

  const request = () =>
    void action.run(async () => {
      if (!session)
        throw new Error(
          "Your session expired. Sign in again before requesting testnet tBNB.",
        );
      try {
        return await api.claimFaucet(session.token);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) expire();
        throw error;
      } finally {
        void queryClient.invalidateQueries({
          queryKey: ["session", owner, "faucet"],
        });
      }
    });

  return (
    <div className="grid w-full gap-6">
      <header className="grid border border-rule bg-paper md:grid-cols-12">
        <div className="border-b border-rule px-6 py-9 md:col-span-7 md:border-b-0 md:border-r md:px-8 md:py-12">
          <Label>Testnet funding</Label>
          <h1 className="mt-4 max-w-[12ch] text-4xl font-semibold tracking-[-0.04em] md:text-6xl md:leading-[0.95]">
            Fund your smart account with test tBNB.
          </h1>
        </div>
        <div className="flex flex-col justify-between gap-8 px-6 py-8 md:col-span-5 md:px-8 md:py-12">
          {status ? (
            <Status tone={venue === "fork" ? "pending" : "signal"}>
              {venue === "fork"
                ? `Local fork · chain ${status.chainId} · ${deploymentLabel}`
                : `BSC Testnet · chain ${status.chainId} · ${deploymentLabel}`}
            </Status>
          ) : (
            <Status tone="pending">Reading chain 97 venue</Status>
          )}
          <p className="max-w-[42ch] text-[15px] leading-relaxed text-fog">
            The faucet sends a fixed amount only to the smart account derived
            from the signed-in owner wallet. There is no destination field and
            no wallet signature for this transfer.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-12">
        <Panel
          label="Faucet eligibility"
          aside={
            status ? (
              <Status tone={status.eligible ? "signal" : "fail"}>
                {status.eligible ? "Ready" : "Refused"}
              </Status>
            ) : null
          }
          className="lg:col-span-8"
        >
          {config.data?.faucet.enabled === false ? (
            <div role="status" className="border-l-2 border-fail-ink pl-4">
              <Status tone="fail">Faucet unavailable</Status>
              <p className="mt-2 text-fog">
                This API has no funded faucet configured. You can transfer
                testnet tBNB directly to your smart account from an external
                wallet; the console never holds a funding key.
              </p>
            </div>
          ) : faucet.isPending ? (
            <p className="text-fog" aria-live="polite">
              Reading the faucet ledger and smart-account balance on chain 97.
            </p>
          ) : faucet.isError ? (
            <FailureNotice
              failure={toFailure(faucet.error)}
              onRetry={() => void faucet.refetch()}
            />
          ) : status ? (
            <>
              <Eligibility status={status} />
              <dl className="mt-6 border-t border-rule">
                <Fact
                  label="Recipient"
                  value={
                    <Hash
                      value={status.recipient}
                      href={
                        config.data?.explorer
                          ? `${config.data.explorer.address}${status.recipient}`
                          : null
                      }
                    />
                  }
                  note="The authenticated owner's derived smart account."
                />
                <Fact
                  label="Transfer"
                  value={`${amount(status.amountWei, 18)} tBNB`}
                />
                <Fact
                  label="Account balance"
                  value={`${amount(status.accountBalanceWei, 18)} tBNB`}
                  note={`Eligibility stops at ${amount(status.fundedThresholdWei, 18)} tBNB.`}
                />
                <Fact
                  label="Rolling budget left"
                  value={`${amount(status.budgetRemainingWei, 18)} tBNB`}
                />
                {status.nextClaimAt ? (
                  <Fact label="Next window" value={utc(status.nextClaimAt)} />
                ) : null}
              </dl>

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <Button
                  variant="signal"
                  arrow
                  busy={action.busy}
                  disabled={
                    !status.eligible ||
                    activeClaim ||
                    action.state.phase === "done"
                  }
                  onClick={request}
                >
                  {action.busy
                    ? "Requesting transfer"
                    : activeClaim
                      ? "Confirmation pending"
                      : action.state.phase === "done"
                        ? "Broadcast received"
                        : "Request test tBNB"}
                </Button>
                <p className="max-w-[44ch] text-[13px] leading-relaxed text-fog">
                  A request reserves one claim before the faucet broadcasts.
                  This page continues refreshing until the chain receipt decides
                  the outcome.
                </p>
              </div>

              {action.state.phase === "failed" ? (
                <div className="mt-6">
                  <FailureNotice
                    failure={action.state.failure}
                    onRetry={() => action.reset()}
                    retryLabel="Dismiss"
                  />
                </div>
              ) : null}
              <ClaimState
                claim={status.lastClaim}
                response={response}
                explorer={explorer}
              />
            </>
          ) : null}
        </Panel>

        <div className="space-y-6 lg:col-span-4">
          <Panel label="Funding boundary">
            <p className="text-[15px] leading-relaxed text-fog">
              Your smart account receives the faucet tBNB. Your owner wallet
              remains separate and pays the gas for its own signed EntryPoint
              transactions.
            </p>
            <dl className="mt-5 border-t border-rule">
              <Fact
                label="Smart account"
                value={
                  holdings.data
                    ? `${amount(holdings.data.accountNative, 18)} tBNB`
                    : "Reading chain"
                }
                note="Live chain balance; this is the account the faucet can fund."
              />
              <Fact
                label="Owner gas"
                value={
                  holdings.data
                    ? `${amount(holdings.data.ownerNative, 18)} tBNB`
                    : "Reading chain"
                }
                note="Not transferred by the faucet; keep the owner funded for root operations."
              />
            </dl>
          </Panel>

          <Panel label="Claim record">
            {status?.lastClaim &&
            (!response || status.lastClaim.claimId === response.claimId) ? (
              <dl className="border-t border-rule">
                <Fact label="Status" value={status.lastClaim.status} />
                <Fact
                  label="Requested"
                  value={utc(status.lastClaim.createdAt)}
                />
                <Fact
                  label="Amount"
                  value={`${amount(status.lastClaim.amountWei, 18)} tBNB`}
                />
              </dl>
            ) : response ? (
              <p className="text-fog">
                The broadcast was accepted. Refreshing the durable claim record
                now.
              </p>
            ) : (
              <p className="text-fog">
                No faucet transfer has been recorded for this signed-in smart
                account.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
