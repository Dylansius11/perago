"use client";

import {
  type Address,
  encodeOwnerWithdrawal,
  type PublicConfig,
} from "@perago/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { amount, compact } from "@/lib/format";
import type { Holdings } from "@/lib/queries";
import { sendRootOperation, sponsorFor } from "@/lib/root-operation";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { OWNER_GAS_FLOOR } from "../account";
import { StepList, useStagedAction } from "../action";
import { AmountField } from "../policy/editor";
import { Button, Fact, FailureNotice, Glyph, Hash, Label, Status } from "../ui";
import {
  type Asset,
  type Entry,
  emptyForm,
  everythingForm,
  type FundsIntent,
  gasLine,
  maxText,
  planWithdrawal,
  settledGas,
  type WithdrawForm,
  withdrawAssets,
  withdrawsEverything,
} from "./model";

/*
 * Owner withdrawal. It is not a task: the root owner signs one UserOperation
 * whose calls can only pay the owner wallet, and the policy, the session key,
 * and the AI play no part in it. There is no address field because there is
 * no recipient to choose.
 */

type Settled = {
  transactionHash: string;
  sponsored: boolean;
  entries: Entry[];
};

export function WithdrawToWallet({
  owner,
  account,
  config,
  holdings,
  prefill,
}: {
  owner: Address;
  account: Address;
  config: PublicConfig;
  holdings: Holdings;
  prefill: FundsIntent | null;
}) {
  const queryClient = useQueryClient();
  const { session } = useSession();
  const action = useStagedAction<Settled>();
  const assets = useMemo(
    () => withdrawAssets({ tokens: config.tokens, holdings }),
    [config.tokens, holdings],
  );
  const [form, setForm] = useState<WithdrawForm>(emptyForm);
  const [prefilled, setPrefilled] = useState<string | null>(null);
  const [effective, setEffective] = useState<boolean | null>(null);

  // A link from a refused task fills one row once. It never signs anything.
  // biome-ignore lint/correctness/useExhaustiveDependencies: apply the link once, not on every balance poll
  useEffect(() => {
    if (!prefill?.symbol) return;
    const row = assets.find((asset) => asset.id === prefill.symbol);
    if (!row) return;
    setForm({ amounts: { [row.id]: prefill.amount ?? "" }, unwrap: false });
    setPrefilled(row.symbol);
  }, [prefill]);

  const plan = useMemo(() => planWithdrawal(assets, form), [assets, form]);
  const everything = withdrawsEverything(assets, plan);
  const sponsor = sponsorFor(config, session);
  // Offered until the operation reports the path it really took.
  const sponsoredNow = effective ?? sponsor !== null;
  const gas = gasLine({
    sponsored: sponsoredNow,
    ownerNative: holdings.ownerNative,
    floor: OWNER_GAS_FLOOR,
  });
  const busy = action.busy;
  const explorer =
    config.venue === "testnet" ? (config.explorer?.transaction ?? null) : null;

  const edit = (next: WithdrawForm) => {
    setForm(next);
    setPrefilled(null);
    if (action.state.phase === "failed") {
      setEffective(null);
      action.reset();
    }
  };

  const submit = () => {
    if (busy) return;
    void action.run(async (advance) => {
      // Enter the running state before the first await, so every control is
      // locked while the chain reads and the gas estimate are in flight.
      setEffective(null);
      advance("prepare");
      if (!plan.ready) throw new Error("Enter an amount to withdraw.");
      const entries = plan.entries;
      const result = await sendRootOperation({
        owner,
        account,
        callData: encodeOwnerWithdrawal({
          owner,
          legs: entries.map((entry) => entry.leg),
        }),
        onStage: (stage, detail) => {
          if (detail.sponsored !== undefined) setEffective(detail.sponsored);
          advance(stage);
        },
        sponsor,
      });
      await queryClient.invalidateQueries({ queryKey: ["chain"] });
      setForm(emptyForm);
      return {
        transactionHash: result.transactionHash,
        sponsored: result.sponsored,
        entries,
      };
    });
  };

  const steps = [
    {
      id: "prepare",
      title: "Check the account and prepare the operation",
      detail:
        "The console checks your wallet network and prepares the transfers above. Nothing is signed yet.",
    },
    {
      id: "sign",
      title: "Sign the UserOperation hash",
      detail:
        "Your wallet shows 32 raw bytes. They commit to the transfers above, each paying your own wallet.",
      prompt: true,
    },
    {
      id: "send",
      title: sponsoredNow
        ? "Submit it to the bundler"
        : "Send it through the EntryPoint",
      detail: sponsoredNow
        ? "Perago sponsors the gas. If sponsorship is refused, your wallet sends the same signed operation and pays."
        : "Your wallet submits handleOps and pays the fee; the account pays nothing.",
      prompt: !sponsoredNow,
    },
    {
      id: "confirm",
      title: "Confirm the withdrawal",
      detail: "The UserOperationEvent must report success.",
    },
  ];

  if (action.state.phase === "done") {
    return (
      <Settlement
        settled={action.state.result}
        holdings={holdings}
        config={config}
        explorer={explorer}
        onAgain={() => action.reset()}
      />
    );
  }

  return (
    <div className="space-y-8">
      <section aria-label="Destination">
        <Label className="block">Destination</Label>
        <div className="mt-3 grid gap-x-8 gap-y-2 border border-rule px-4 py-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-baseline">
          <p className="text-[17px] font-medium">Your wallet</p>
          <Hash value={owner} full wrap />
        </div>
        <p className="mt-3 max-w-[62ch] text-[14px] leading-snug text-fog">
          Withdrawals always go to the wallet that owns this account. Perago and
          the AI cannot start one.
        </p>
      </section>

      <section aria-label="Assets to withdraw">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div>
            <Label className="block">Withdraw from the account</Label>
            <p className="mt-1.5 max-w-[52ch] text-[14px] leading-snug text-fog">
              Leave a row blank to keep that asset in the account.
            </p>
          </div>
          <Button
            variant="ghost"
            disabled={assets.length === 0 || busy}
            onClick={() => edit(everythingForm(assets, form.unwrap))}
          >
            Withdraw everything
          </Button>
        </div>

        {assets.length === 0 ? (
          <div
            role="status"
            className="mt-4 border border-dashed border-rule px-4 py-6"
          >
            <Status tone="idle">Nothing to withdraw</Status>
            <p className="mt-2 max-w-[56ch] text-[14px] leading-snug text-fog">
              The account holds no tBNB or supported tokens right now.
            </p>
          </div>
        ) : (
          <fieldset disabled={busy} className="mt-4 min-w-0 border-0 p-0">
            <legend className="sr-only">Amounts to withdraw</legend>
            <ul className="border-t border-rule">
              {assets.map((asset) => (
                <AssetRow
                  key={asset.id}
                  asset={asset}
                  value={form.amounts[asset.id] ?? ""}
                  error={plan.errors[asset.id]}
                  unwrap={form.unwrap}
                  note={
                    prefilled === asset.symbol
                      ? "Filled in from your goal. Check it before you sign."
                      : null
                  }
                  disabled={busy}
                  onChange={(value) =>
                    edit({
                      ...form,
                      amounts: { ...form.amounts, [asset.id]: value },
                    })
                  }
                  onMax={() =>
                    edit({
                      ...form,
                      amounts: { ...form.amounts, [asset.id]: maxText(asset) },
                    })
                  }
                  onUnwrap={(unwrap) => edit({ ...form, unwrap })}
                />
              ))}
            </ul>
          </fieldset>
        )}
      </section>

      {plan.ready ? (
        <section
          aria-label="Withdrawal review"
          className="border border-ruleinvert bg-ink p-5 text-paper md:p-8"
        >
          <Label dark>What your wallet signs</Label>
          <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
            Move funds from the account to your wallet.
          </h3>

          <div className="mt-5 border-y border-ruleinvert">
            <div className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] gap-x-3 border-b border-ruleinvert py-2.5">
              <Label dark>Leaves the account</Label>
              <span aria-hidden />
              <Label dark>Arrives in your wallet</Label>
            </div>
            <ul>
              {plan.entries.map((entry) => (
                <li
                  key={entry.asset.id}
                  className="grid grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)] items-baseline gap-x-3 border-b border-ruleinvert py-3 last:border-b-0"
                >
                  <span className="font-mono text-[14px] [overflow-wrap:anywhere]">
                    {entry.leaves}
                  </span>
                  <span aria-hidden className="font-mono text-paper/40">
                    &#8594;
                  </span>
                  <span className="sr-only">arrives as</span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[14px] [overflow-wrap:anywhere]">
                      {entry.arrives}
                    </span>
                    {entry.leg.kind === "UNWRAP" ? (
                      <span className="mt-0.5 block text-[12px] leading-snug text-paper/55">
                        Unwrapped from WBNB first
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <dl className="mt-1">
            <Fact
              dark
              label="To"
              value={<Hash dark value={owner} full wrap />}
            />
            <Fact dark label="Approval" value="1 wallet signature" />
            <Fact
              dark
              label="Network fee"
              value={gas.headline}
              note={gas.note}
            />
            <Fact
              dark
              label="Chain"
              value={`BSC Testnet · ${config.chainId} · ${config.venue}`}
            />
          </dl>

          {gas.warning ? (
            <p className="mt-4 border-l-2 border-statusfail pl-3 text-[14px] leading-snug text-paper/85">
              {gas.warning}
            </p>
          ) : null}

          {everything ? (
            <p className="mt-5 max-w-[62ch] text-[14px] leading-snug text-paper/70">
              This empties the account. Your policy stays active, but Perago
              cannot spend an empty account. Send funds back to the account
              address to use it again.
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              variant="signal"
              className="hover:bg-paper hover:text-ink"
              busy={busy}
              onClick={submit}
            >
              Sign and withdraw
            </Button>
            <Button
              variant="ghost-dark"
              disabled={busy}
              onClick={() => edit(emptyForm)}
            >
              Clear
            </Button>
          </div>

          {action.state.phase !== "idle" ? (
            <div className="mt-6">
              <StepList dark steps={steps} state={action.state} />
            </div>
          ) : null}
          {action.state.phase === "failed" ? (
            <div className="mt-5">
              <FailureNotice
                dark
                failure={action.state.failure}
                onRetry={() => {
                  setEffective(null);
                  action.reset();
                }}
                retryLabel="Dismiss"
              />
            </div>
          ) : null}
        </section>
      ) : (
        <p
          className={cn(
            "font-mono text-[12px]",
            Object.keys(plan.errors).length > 0 ? "text-fail-ink" : "text-fog",
          )}
          aria-live="polite"
        >
          {Object.keys(plan.errors).length > 0
            ? "Fix the highlighted amounts to see what your wallet will sign."
            : assets.length > 0
              ? "Enter an amount to see what your wallet will sign."
              : ""}
        </p>
      )}
    </div>
  );
}

function AssetRow({
  asset,
  value,
  error,
  unwrap,
  note,
  disabled,
  onChange,
  onMax,
  onUnwrap,
}: {
  asset: Asset;
  value: string;
  error: string | undefined;
  unwrap: boolean;
  note: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
  onMax: () => void;
  onUnwrap: (unwrap: boolean) => void;
}) {
  const exact = amount(asset.balance, asset.decimals, asset.decimals);
  return (
    <li className="grid gap-x-8 gap-y-3 border-b border-rule py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] md:items-start">
      <div className="min-w-0">
        <p className="text-[17px] font-medium">{asset.symbol}</p>
        <p
          title={`${exact} ${asset.symbol}`}
          className="mt-1 font-mono text-[12px] tabular-nums text-fog"
        >
          Account holds {compact(asset.balance, asset.decimals)} {asset.symbol}
        </p>
        {asset.wrapsNative ? (
          <label
            className={cn(
              "mt-3 inline-flex min-h-8 cursor-pointer items-center gap-3 text-[14px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-signal-ink",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={unwrap}
              disabled={disabled}
              onChange={(event) => onUnwrap(event.target.checked)}
            />
            <span
              aria-hidden
              className={cn(
                "grid size-5 shrink-0 place-items-center border",
                unwrap
                  ? "border-ink bg-ink text-paper"
                  : "border-fog bg-paper text-transparent",
              )}
            >
              <Glyph name="check" />
            </span>
            <span>
              Unwrap to tBNB first
              <span className="block text-[12px] leading-snug text-fog">
                Your wallet receives tBNB instead of WBNB.
              </span>
            </span>
          </label>
        ) : null}
        {note ? (
          <p className="mt-3 border-l-2 border-signal pl-3 text-[13px] leading-snug text-fog">
            {note}
          </p>
        ) : null}
      </div>
      <AmountField
        label={`${asset.symbol} to withdraw`}
        hideLabel
        unit={asset.symbol}
        value={value}
        error={error}
        disabled={disabled}
        onChange={onChange}
        onMax={onMax}
      />
    </li>
  );
}

function Settlement({
  settled,
  holdings,
  config,
  explorer,
  onAgain,
}: {
  settled: Settled;
  holdings: Holdings;
  config: PublicConfig;
  explorer: string | null;
  onAgain: () => void;
}) {
  const held = [
    holdings.accountNative > 0n
      ? `${amount(holdings.accountNative, 18, 18)} tBNB`
      : null,
    ...config.tokens.map((token) => {
      const balance = holdings.tokens[token.symbol]?.balance ?? 0n;
      return balance > 0n
        ? `${amount(balance, token.decimals, token.decimals)} ${token.symbol}`
        : null;
    }),
  ].filter((line): line is string => line !== null);
  return (
    <div role="status" className="relative border border-rule">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-ok-ink" />
      <div className="px-5 py-6 md:px-8 md:py-8">
        <Status tone="ok">Withdrawn</Status>
        <h3 className="mt-3 text-2xl font-semibold tracking-[-0.03em]">
          The funds are in your wallet.
        </h3>
        <dl className="mt-5 border-t border-rule">
          <Fact
            label="Arrived"
            value={
              <ul className="space-y-1">
                {settled.entries.map((entry) => (
                  <li key={entry.asset.id}>{entry.arrives}</li>
                ))}
              </ul>
            }
          />
          <Fact
            label="Account now holds"
            value={held.length > 0 ? held.join(" · ") : "nothing"}
          />
          <Fact
            label="Your wallet tBNB"
            value={`${amount(holdings.ownerNative, 18, 18)} tBNB`}
          />
          <Fact label="Network fee" value={settledGas(settled.sponsored)} />
          <Fact
            label="Transaction"
            value={
              <Hash
                value={settled.transactionHash}
                href={explorer ? `${explorer}${settled.transactionHash}` : null}
              />
            }
          />
        </dl>
        <Button className="mt-6" variant="ghost" onClick={onAgain}>
          Withdraw more
        </Button>
      </div>
    </div>
  );
}
