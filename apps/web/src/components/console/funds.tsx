"use client";

import type { Address, PublicConfig } from "@perago/sdk";
import { useEffect, useState } from "react";
import type { Holdings } from "@/lib/queries";
import { WrapNative } from "./account";
import { type FundsIntent, parseFundsIntent } from "./funds/model";
import { WithdrawToWallet } from "./funds/withdraw";
import { Hash, Label, Panel, Segmented } from "./ui";

/*
 * Funds: both directions of moving value across the smart account's edge.
 * Adding is the wrap flow plus the account's address; withdrawing is an owner
 * action signed by the root owner and always paid to that owner. Both panes
 * stay mounted, so switching never abandons a signature in progress.
 */

type Direction = "add" | "withdraw";

const DIRECTIONS: readonly { value: Direction; label: string }[] = [
  { value: "add", label: "Add" },
  { value: "withdraw", label: "Withdraw to wallet" },
];

export function FundsSection({
  owner,
  account,
  config,
  holdings,
  number,
}: {
  owner: Address;
  account: Address;
  config: PublicConfig;
  holdings: Holdings;
  /** Section number, e.g. "03", shared with the in-page navigation. */
  number: string;
}) {
  const [direction, setDirection] = useState<Direction>("add");
  const [intent, setIntent] = useState<FundsIntent | null>(null);
  const wbnb = config.tokens.find((token) => token.symbol === "WBNB");
  const symbols = ["tBNB", ...config.tokens.map((token) => token.symbol)];

  // A `?funds=withdraw` link from a refused task opens the withdrawal once.
  // It never signs anything: the owner still reviews and approves.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read the link once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const asked = parseFundsIntent(window.location.search, symbols);
    if (!asked) return;
    for (const key of ["funds", "asset", "amount"]) params.delete(key);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    setDirection(asked.direction);
    setIntent(asked);
  }, []);

  return (
    <Panel
      id="funds"
      label={`${number} / Funds`}
      className="scroll-mt-28 !border-0"
    >
      <h2 className="max-w-[22ch] text-2xl font-semibold leading-[1.1] tracking-[-0.03em] md:text-3xl">
        Add to the account, or take funds back.
      </h2>
      <p className="mt-3 max-w-[62ch] text-fog">
        The smart account holds what Perago works with. Your wallet owns it, so
        only your wallet can move funds out.
      </p>
      <Segmented
        className="mt-6 max-w-md"
        label="Direction"
        value={direction}
        options={DIRECTIONS}
        onChange={setDirection}
      />

      <div className="mt-8" hidden={direction !== "add"}>
        <h3 className="text-xl font-semibold tracking-[-0.02em]">
          Turn testnet BNB into swap input.
        </h3>
        {wbnb && holdings.accountNative > 0n ? (
          <div className="mt-4">
            <WrapNative
              owner={owner}
              account={account}
              wbnb={wbnb.address}
              available={holdings.accountNative}
            />
          </div>
        ) : (
          <p className="mt-3 max-w-[56ch] text-fog">
            The account holds no tBNB to wrap right now.
          </p>
        )}
        <div className="mt-8 border-t border-rule pt-5">
          <Label className="block">Deposit address</Label>
          <p className="mt-1.5 max-w-[56ch] text-[14px] leading-snug text-fog">
            To add funds, send tBNB or a supported token to your smart account.
            Use this address, not your wallet's.
          </p>
          <div className="mt-3 text-[13px]">
            <Hash
              value={account}
              full
              wrap
              href={
                config.explorer ? `${config.explorer.address}${account}` : null
              }
            />
          </div>
        </div>
      </div>

      <div className="mt-8" hidden={direction !== "withdraw"}>
        <WithdrawToWallet
          owner={owner}
          account={account}
          config={config}
          holdings={holdings}
          prefill={intent}
        />
      </div>
    </Panel>
  );
}
