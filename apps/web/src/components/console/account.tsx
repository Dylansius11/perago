"use client";

import {
  type Address,
  encodeAccountExecute,
  encodeSemiModularAccountFactoryData,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  type PolicyView,
  type PublicConfig,
} from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { encodeFunctionData, parseAbi, parseEther } from "viem";
import { sendTransaction, waitForTransactionReceipt } from "wagmi/actions";
import { amount } from "@/lib/format";
import { ownerSubmissionKey, submitOwnerOnce } from "@/lib/owner-submission";
import type { Holdings } from "@/lib/queries";
import { sendRootOperation } from "@/lib/root-operation";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { assertWalletVenue } from "@/lib/venue";
import { CHAIN_ID, wagmiConfig } from "@/lib/wagmi";
import { StepList, useStagedAction } from "./action";
import { Button, FailureNotice, Hash, Label, Status } from "./ui";

/*
 * The smart account: its readiness checklist, its creation, and turning its
 * tBNB into the WBNB a swap spends. Balances are chain reads, refreshed every
 * few seconds; nothing here is cached from the API.
 */

/** Below this the owner cannot pay for a root UserOperation's transaction. */
export const OWNER_GAS_FLOOR = parseEther("0.002");

export type Readiness = {
  deployed: boolean;
  funded: boolean;
  policy: PolicyView | null;
  ownerGas: boolean;
  ready: boolean;
};

export function readinessOf(
  holdings: Holdings | undefined,
  policies: PolicyView[] | undefined,
): Readiness {
  const now = Math.floor(Date.now() / 1000);
  const policy =
    policies?.find(
      (entry) =>
        entry.status === "ACTIVE" &&
        (entry.validUntil === null || Number(entry.validUntil) > now),
    ) ?? null;
  const deployed = holdings?.deployed ?? false;
  const funded =
    (holdings?.accountNative ?? 0n) > 0n ||
    Object.values(holdings?.tokens ?? {}).some((token) => token.balance > 0n);
  const ownerGas = (holdings?.ownerNative ?? 0n) >= OWNER_GAS_FLOOR;
  return {
    deployed,
    funded,
    policy,
    ownerGas,
    ready: deployed && funded && policy !== null,
  };
}

/* ------------------------------------------------------------------ */
/* Readiness rail                                                      */
/* ------------------------------------------------------------------ */

export function ReadinessRail({
  readiness,
  holdings,
  config,
}: {
  readiness: Readiness;
  holdings: Holdings | undefined;
  config: PublicConfig;
}) {
  const { owner, account } = useSession();
  const rows: { title: string; done: boolean; note: string }[] = [
    {
      title: "Owner wallet connected",
      done: true,
      note: owner ? `${owner.slice(0, 8)}…` : "",
    },
    { title: "Session signed", done: true, note: "one-time challenge" },
    {
      title: "Smart account created",
      done: readiness.deployed,
      note: readiness.deployed
        ? "code present on chain 97"
        : "one transaction from your wallet",
    },
    {
      title: "Account funded",
      done: readiness.funded,
      note: readiness.funded
        ? "holds tBNB or a supported token"
        : "claim testnet tBNB",
    },
    {
      title: "Wallet Policy active",
      done: readiness.policy !== null,
      note: readiness.policy
        ? `version ${readiness.policy.version}`
        : "your standing limits",
    },
  ];
  const next = rows.findIndex((row) => !row.done);

  return (
    <aside aria-label="Account readiness" className="space-y-6">
      <div className="border border-rule">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <Label>Readiness</Label>
          <Status tone={readiness.ready ? "ok" : "pending"}>
            {readiness.ready
              ? "Ready"
              : `${rows.filter((row) => row.done).length} of ${rows.length}`}
          </Status>
        </div>
        <ol>
          {rows.map((row, index) => (
            <li
              key={row.title}
              className={cn(
                "relative grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 border-b border-rule px-5 py-3 last:border-b-0",
                index === next && "bg-ink/[0.025]",
              )}
            >
              {index === next ? (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 w-0.5 bg-signal"
                />
              ) : null}
              <span
                className={cn(
                  "font-mono text-[12px]",
                  row.done
                    ? "text-ok-ink"
                    : index === next
                      ? "text-signal-ink"
                      : "text-fog",
                )}
              >
                {row.done ? "✓" : String(index + 1).padStart(2, "0")}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-[15px]",
                    !row.done && index !== next && "text-fog",
                  )}
                >
                  {row.title}
                  <span className="sr-only">
                    {row.done
                      ? " (done)"
                      : index === next
                        ? " (next)"
                        : " (pending)"}
                  </span>
                </p>
                <p className="truncate font-mono text-[11px] text-fog">
                  {row.note}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="border border-rule">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <Label>Holdings</Label>
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fog">
            live · chain
          </span>
        </div>
        <dl className="px-5 py-2 font-mono text-[13px]">
          <HoldingRow
            label="account tBNB"
            value={holdings ? amount(holdings.accountNative, 18) : null}
          />
          {config.tokens.map((token) => (
            <HoldingRow
              key={token.address}
              label={`account ${token.symbol}`}
              value={
                holdings?.tokens[token.symbol]
                  ? amount(
                      holdings.tokens[token.symbol]?.balance ?? 0n,
                      token.decimals,
                    )
                  : null
              }
            />
          ))}
          <HoldingRow
            label="owner tBNB (gas)"
            value={holdings ? amount(holdings.ownerNative, 18) : null}
            warn={holdings !== undefined && !readiness.ownerGas}
          />
        </dl>
        {account ? (
          <div className="border-t border-rule px-5 py-3 text-[12px]">
            <Label className="block">Smart account</Label>
            <div className="mt-1">
              <Hash
                value={account}
                href={
                  config.explorer
                    ? `${config.explorer.address}${account}`
                    : null
                }
              />
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function HoldingRow({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string | null;
  warn?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-2 last:border-b-0">
      <dt className="text-fog">{label}</dt>
      <dd className={cn("tabular-nums", warn ? "text-fail-ink" : "text-ink")}>
        {value ?? <span className="text-fog">reading</span>}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create the account                                                  */
/* ------------------------------------------------------------------ */

export function CreateAccount({
  owner,
  account,
}: {
  owner: Address;
  account: Address;
}) {
  const queryClient = useQueryClient();
  const action = useStagedAction<`0x${string}`>();
  const steps = [
    {
      id: "send",
      title: "Send the account creation transaction",
      detail: `Your wallet calls the pinned Modular Account V2 factory ${MODULAR_ACCOUNT_V2_ADDRESSES.factory.slice(0, 10)}… with you as the only owner. You pay the network fee.`,
      prompt: true,
    },
    {
      id: "confirm",
      title: "Wait for the account's code",
      detail: `The account appears at ${account.slice(0, 10)}…, the address derived from your wallet before it existed.`,
    },
  ];

  return (
    <div>
      <p className="max-w-[60ch] text-fog">
        Your smart account already has an address; it just has no code yet.
        Creating it deploys the audited Alchemy Modular Account V2 at that exact
        address with your wallet as root owner. No session or permission is
        installed here.
      </p>
      <div className="mt-6">
        <StepList steps={steps} state={action.state} />
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button
          arrow
          busy={action.busy}
          onClick={() =>
            void action.run(async (advance) => {
              await assertWalletVenue();
              const data = encodeSemiModularAccountFactoryData({ owner });
              const { receipt, hash } = await submitOwnerOnce({
                key: ownerSubmissionKey({
                  chainId: CHAIN_ID,
                  owner,
                  target: MODULAR_ACCOUNT_V2_ADDRESSES.factory,
                  callData: data,
                }),
                store: sessionStorage,
                send: async () => {
                  advance("send");
                  await assertWalletVenue();
                  const transactionHash = await sendTransaction(wagmiConfig, {
                    account: owner,
                    chainId: CHAIN_ID,
                    data,
                    to: MODULAR_ACCOUNT_V2_ADDRESSES.factory,
                  });
                  return { transactionHash, userOperationHash: null };
                },
                confirm: async (pending) => {
                  advance("confirm");
                  const receipt = await waitForTransactionReceipt(wagmiConfig, {
                    chainId: CHAIN_ID,
                    hash: pending.transactionHash,
                  });
                  return { receipt, hash: pending.transactionHash };
                },
              });
              if (receipt.status !== "success")
                throw new Error("The account creation transaction reverted.");
              await queryClient.invalidateQueries({ queryKey: ["chain"] });
              return hash;
            })
          }
        >
          Create smart account
        </Button>
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Wrap tBNB into WBNB                                                 */
/* ------------------------------------------------------------------ */

const wbnbAbi = parseAbi(["function deposit() payable"]);

export function WrapNative({
  owner,
  account,
  wbnb,
  available,
  suggested,
}: {
  owner: Address;
  account: Address;
  wbnb: Address;
  available: bigint;
  suggested?: bigint;
}) {
  const queryClient = useQueryClient();
  const action = useStagedAction<string>();
  const [value, setValue] = useState(() =>
    suggested ? amount(suggested, 18, 18).replaceAll(",", "") : "0.01",
  );
  let parsed: bigint | null = null;
  try {
    parsed = parseEther(value);
  } catch {
    parsed = null;
  }
  const invalid = parsed === null || parsed <= 0n;
  const over = parsed !== null && parsed > available;

  const steps = [
    {
      id: "sign",
      title: "Sign the UserOperation hash",
      detail:
        "Your wallet shows 32 raw bytes. They commit to exactly one call: WBNB.deposit from your account.",
      prompt: true,
    },
    {
      id: "send",
      title: "Send it through the EntryPoint",
      detail:
        "Your wallet submits handleOps and pays the fee; the account pays nothing.",
      prompt: true,
    },
    {
      id: "confirm",
      title: "Confirm the wrap",
      detail: "The UserOperationEvent must report success.",
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-2">
          <Label>tBNB to wrap into WBNB</Label>
          <div className="flex items-stretch border border-rule focus-within:border-ink">
            <input
              inputMode="decimal"
              value={value}
              onChange={(event) => setValue(event.target.value.trim())}
              aria-invalid={invalid || over}
              className="min-w-0 flex-1 bg-transparent px-4 py-3 font-mono text-[15px] outline-none"
            />
            <button
              type="button"
              onClick={() =>
                setValue(amount(available, 18, 18).replaceAll(",", ""))
              }
              className="pressable border-l border-rule px-3 font-mono text-[11px] uppercase tracking-[0.16em] text-fog hover:text-ink"
            >
              Max
            </button>
          </div>
        </label>
        <Button
          variant="primary"
          busy={action.busy}
          disabled={invalid || over}
          onClick={() =>
            void action.run(async (advance) => {
              if (parsed === null) throw new Error("Enter an amount.");
              const result = await sendRootOperation({
                owner,
                account,
                callData: encodeAccountExecute({
                  data: encodeFunctionData({
                    abi: wbnbAbi,
                    functionName: "deposit",
                  }),
                  target: wbnb,
                  value: parsed,
                }),
                onStage: (stage) => advance(stage),
              });
              await queryClient.invalidateQueries({ queryKey: ["chain"] });
              return result.transactionHash;
            })
          }
        >
          Wrap
        </Button>
      </div>
      <p
        className={cn(
          "mt-2 font-mono text-[12px]",
          over ? "text-fail-ink" : "text-fog",
        )}
      >
        {over ? "More than the account holds. " : ""}Account holds{" "}
        {amount(available, 18)} tBNB.
      </p>
      {action.state.phase !== "idle" ? (
        <div className="mt-5">
          <StepList steps={steps} state={action.state} />
        </div>
      ) : null}
      {action.state.phase === "failed" ? (
        <div className="mt-5">
          <FailureNotice
            failure={action.state.failure}
            onRetry={() => action.reset()}
            retryLabel="Dismiss"
          />
        </div>
      ) : null}
      {action.state.phase === "done" ? (
        <p className="mt-4">
          <Status tone="ok">Wrapped</Status>
        </p>
      ) : null}
    </div>
  );
}
