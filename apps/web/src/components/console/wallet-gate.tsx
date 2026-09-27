"use client";

import type { ReactNode } from "react";
import { useSwitchChain } from "wagmi";
import { RPC_URL } from "@/lib/env";
import { toFailure } from "@/lib/failure";
import { usePublicConfig } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { useVenue } from "@/lib/venue";
import { CHAIN_ID } from "@/lib/wagmi";
import { useStagedAction } from "./action";
import { Button, FailureNotice, Hash, Label, Scan, Swap } from "./ui";
import { ConnectList } from "./wallet";

/*
 * Gates in the order a write depends on them: the API answers, a wallet is
 * connected, it is on chain 97, it reads the same chain history as this
 * console, and the owner holds a session. Each gate is a real state with its
 * own way out; none is a dead end.
 */

function GateFrame({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 border border-rule bg-paper md:grid-cols-12">
      <div className="border-b border-rule px-6 py-10 md:col-span-5 md:border-b-0 md:border-r md:px-8 md:py-12">
        <Label>{eyebrow}</Label>
        <h1 className="mt-4 max-w-[16ch] text-3xl font-semibold tracking-[-0.03em] md:text-[2.6rem] md:leading-[1.05]">
          {title}
        </h1>
      </div>
      <div className="px-6 py-8 md:col-span-7 md:px-8 md:py-12">{children}</div>
    </div>
  );
}

export function WalletGate({ children }: { children: ReactNode }) {
  const config = usePublicConfig();
  const venue = useVenue();
  const { session, owner, account, signIn } = useSession();
  const switchChain = useSwitchChain();
  const signing = useStagedAction<void>();

  let key: string;
  let body: ReactNode;

  if (config.isPending) {
    key = "loading";
    body = (
      <div className="relative h-40 border border-rule">
        <Scan />
      </div>
    );
  } else if (config.isError) {
    key = "api";
    body = (
      <GateFrame
        eyebrow="API unreachable"
        title="The Perago API is not answering."
      >
        <FailureNotice
          failure={toFailure(config.error)}
          onRetry={() => void config.refetch()}
        />
        <p className="mt-6 max-w-[52ch] text-fog">
          Nothing can be planned, simulated, or signed while the API is down,
          and nothing already signed has changed. Mandates that are executing
          keep their onchain state; their receipts return once the API does.
        </p>
      </GateFrame>
    );
  } else if (venue.status === "disconnected") {
    key = "connect";
    body = (
      <GateFrame
        eyebrow="Step 1 · Owner wallet"
        title="Connect the wallet that owns your account."
      >
        <p className="mb-6 max-w-[52ch] text-fog">
          That wallet becomes the root owner of a Modular Account V2 on BSC
          Testnet. Every change to the account needs its signature; Perago only
          ever holds a narrow, expiring session.
        </p>
        <ConnectList />
      </GateFrame>
    );
  } else if (venue.status === "wrong-chain") {
    const failure = switchChain.error ? toFailure(switchChain.error) : null;
    key = "chain";
    body = (
      <GateFrame
        eyebrow="Wrong network"
        title="Switch your wallet to BSC Testnet."
      >
        <p className="max-w-[52ch] text-fog">
          Your wallet is on chain {venue.chainId ?? "unknown"}. Perago signs and
          executes only on chain {CHAIN_ID}; a signature for another chain would
          be refused by the contract anyway, so nothing is offered until you
          switch.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button
            arrow
            busy={switchChain.isPending}
            onClick={() => switchChain.mutate({ chainId: CHAIN_ID })}
          >
            Switch to chain {CHAIN_ID}
          </Button>
        </div>
        {failure ? (
          <div className="mt-6">
            <FailureNotice failure={failure} />
          </div>
        ) : null}
      </GateFrame>
    );
  } else if (venue.status === "mismatch") {
    key = "mismatch";
    body = (
      <GateFrame
        eyebrow="Different chain history"
        title="Your wallet and this console see different chains."
      >
        <p className="max-w-[56ch] text-fog">
          The wallet is on chain {CHAIN_ID}, but its RPC returns a different
          block than the one this console reads. Anything you signed would be
          sent to a chain the screen never showed, so writes stay locked.
        </p>
        {config.data?.venue === "fork" ? (
          <div className="mt-6 border-l-2 border-statuspending pl-4">
            <p className="font-medium">This console runs on a local fork.</p>
            <p className="mt-1 text-fog">
              Point your wallet's chain-{CHAIN_ID} network at the fork RPC:
            </p>
            <div className="mt-2 text-[13px]">
              <Hash value={RPC_URL ?? "http://127.0.0.1:8545"} full />
            </div>
          </div>
        ) : (
          <p className="mt-4 max-w-[56ch] text-fog">
            Reset your wallet's BSC Testnet network to a public testnet RPC,
            then reload.
          </p>
        )}
      </GateFrame>
    );
  } else if (venue.status === "checking") {
    key = "checking";
    body = (
      <div className="relative flex h-40 items-center justify-center border border-rule">
        <Label>Checking your wallet reads chain 97</Label>
        <Scan />
      </div>
    );
  } else if (!session) {
    key = "session";
    const state = signing.state;
    body = (
      <GateFrame eyebrow="Step 2 · Session" title="Sign in with your wallet.">
        <p className="max-w-[56ch] text-fog">
          One plain-text signature proves you control the owner. It names this
          API, chain {CHAIN_ID}, your wallet, and your smart account, expires in
          minutes, and can be used once. It moves no funds and grants no onchain
          authority.
        </p>
        <dl className="mt-6 border-t border-rule text-[13px]">
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-b border-rule py-3">
            <dt className="font-mono text-fog">owner</dt>
            <dd className="min-w-0">
              {owner ? <Hash value={owner} full /> : null}
            </dd>
          </div>
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-4 border-b border-rule py-3">
            <dt className="font-mono text-fog">smart account</dt>
            <dd className="min-w-0">
              {account ? <Hash value={account} full /> : null}
            </dd>
          </div>
        </dl>
        <div className="mt-6">
          <Button
            arrow
            busy={signing.busy}
            onClick={() =>
              void signing.run(async (advance) => {
                advance("sign");
                await signIn();
              })
            }
          >
            {signing.busy ? "Waiting for your signature" : "Sign in"}
          </Button>
        </div>
        {state.phase === "failed" ? (
          <div className="mt-6">
            <FailureNotice
              failure={state.failure}
              onRetry={() => signing.reset()}
              retryLabel="Dismiss"
            />
          </div>
        ) : null}
      </GateFrame>
    );
  } else {
    key = "ready";
    body = children;
  }

  return <Swap id={key}>{body}</Swap>;
}
