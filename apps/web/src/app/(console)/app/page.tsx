"use client";

import Link from "next/link";
import {
  CreateAccount,
  ReadinessRail,
  readinessOf,
  WrapNative,
} from "@/components/console/account";
import { PolicyComposer } from "@/components/console/policy";
import { TaskComposer, TaskLedger } from "@/components/console/tasks";
import {
  Button,
  FailureNotice,
  Label,
  Panel,
  Scan,
  Status,
} from "@/components/console/ui";
import { WalletGate } from "@/components/console/wallet-gate";
import { toFailure } from "@/lib/failure";
import {
  useHoldings,
  usePolicies,
  usePublicConfig,
  useTasks,
} from "@/lib/queries";
import { useSession } from "@/lib/session";

export default function ConsolePage() {
  return (
    <WalletGate>
      <AccountConsole />
    </WalletGate>
  );
}

function AccountConsole() {
  const { owner, account } = useSession();
  const config = usePublicConfig();
  const policies = usePolicies();
  const tasks = useTasks();
  const holdings = useHoldings(config.data);
  if (!config.data || !owner || !account)
    return (
      <div className="relative h-52 border border-rule">
        <Scan />
      </div>
    );
  const wbnb = config.data.tokens.find((token) => token.symbol === "WBNB");
  const ready = readinessOf(holdings.data, policies.data);
  const loading = holdings.isPending || policies.isPending || tasks.isPending;

  return (
    <div className="space-y-0">
      <div className="grid border border-rule md:grid-cols-12">
        <div className="border-b border-rule px-6 py-8 md:col-span-9 md:border-b-0 md:border-r md:px-8 md:py-11">
          <Label>Workspace / Chain {config.data.chainId}</Label>
          <h1 className="mt-3 max-w-[21ch] text-4xl font-semibold leading-[1.02] tracking-[-0.03em] md:text-6xl">
            Your intent, carried through.
          </h1>
          <p className="mt-4 max-w-[64ch] text-[16px] leading-relaxed text-fog">
            One wallet. Explicit limits. One-use authority. A public,
            independently checkable receipt at the end.
          </p>
        </div>
        <div className="flex flex-col justify-between gap-6 px-6 py-8 md:col-span-3 md:px-8 md:py-11">
          <Status tone={config.data.venue === "fork" ? "pending" : "signal"}>
            {config.data.venue === "fork"
              ? "Local chain-97 fork"
              : "BSC Testnet"}
          </Status>
          <p className="font-mono text-xs leading-relaxed text-fog">
            {config.data.deploymentLabel} · Account {account.slice(0, 10)}…
            {account.slice(-6)}
          </p>
        </div>
      </div>
      {holdings.isError || policies.isError || tasks.isError ? (
        <div className="border-x border-b border-rule p-5">
          <FailureNotice
            failure={toFailure(holdings.error ?? policies.error ?? tasks.error)}
            onRetry={() => {
              void holdings.refetch();
              void policies.refetch();
              void tasks.refetch();
            }}
          />
        </div>
      ) : null}
      {loading ? (
        <div className="relative h-40 border-x border-b border-rule">
          <Scan />
        </div>
      ) : null}
      {!loading && !holdings.isError && !policies.isError ? (
        <div className="grid items-start gap-0 border-x border-b border-rule lg:grid-cols-[minmax(19rem,4fr)_minmax(0,8fr)]">
          <div className="border-b border-rule p-5 md:p-7 lg:sticky lg:top-16 lg:border-b-0 lg:border-r">
            <ReadinessRail
              readiness={ready}
              holdings={holdings.data}
              config={config.data}
            />
          </div>
          <div className="min-w-0 divide-y divide-rule">
            {!ready.deployed ? (
              <Panel label="01 / Account" className="!border-0">
                <div className="p-5 md:p-8">
                  <CreateAccount owner={owner} account={account} />
                </div>
              </Panel>
            ) : null}
            {ready.deployed && !ready.funded ? (
              <Panel label="02 / Fund" className="!border-0">
                <div className="p-5 md:p-8">
                  <h2 className="text-3xl font-semibold tracking-[-0.03em]">
                    Fund your account.
                  </h2>
                  <p className="mt-3 max-w-[60ch] text-fog">
                    The faucet transfers testnet tBNB to this smart account—not
                    to your owner wallet. You can also transfer tBNB or
                    supported tokens directly to its address.
                  </p>
                  <Link
                    href="/faucet"
                    className="pressable mt-6 inline-flex min-h-12 items-center bg-ink px-6 text-paper hover:bg-signal hover:text-ink"
                  >
                    Open faucet ↗
                  </Link>
                </div>
              </Panel>
            ) : null}
            {ready.deployed &&
            ready.funded &&
            !ready.policy &&
            wbnb &&
            holdings.data &&
            holdings.data.accountNative > 0n &&
            holdings.data.tokens.WBNB?.balance === 0n ? (
              <Panel label="03 / Prepare input" className="!border-0">
                <div className="p-5 md:p-8">
                  <h2 className="mb-3 text-2xl font-semibold">
                    Turn testnet BNB into swap input.
                  </h2>
                  <WrapNative
                    owner={owner}
                    account={account}
                    wbnb={wbnb.address}
                    available={holdings.data.accountNative}
                  />
                </div>
              </Panel>
            ) : null}
            {ready.deployed ? (
              <Panel label="04 / Wallet Policy" className="!border-0">
                <div className="p-5 md:p-8">
                  <h2 className="text-3xl font-semibold tracking-[-0.03em]">
                    Set the boundary first.
                  </h2>
                  <p className="mb-8 mt-2 max-w-[64ch] text-fog">
                    Your policy limits what may be proposed. Only a later
                    signature over a specific simulated mandate can authorize
                    one action.
                  </p>
                  <PolicyComposer
                    config={config.data}
                    policies={policies.data ?? []}
                    holdings={holdings.data}
                  />
                </div>
              </Panel>
            ) : null}
            {ready.policy ? (
              <Panel label="05 / One goal" className="!border-0">
                <div className="p-5 md:p-8">
                  <TaskComposer
                    config={config.data}
                    maxLifetime={ready.policy.policy.maxTaskLifetimeSeconds}
                  />
                </div>
              </Panel>
            ) : null}
            <Panel label="Task ledger" className="!border-0">
              <div className="p-5 md:p-8">
                {tasks.data ? (
                  <TaskLedger tasks={tasks.data} />
                ) : tasks.isError ? (
                  <Button variant="ghost" onClick={() => void tasks.refetch()}>
                    Retry task list
                  </Button>
                ) : (
                  <Scan />
                )}
              </div>
            </Panel>
          </div>
        </div>
      ) : null}
    </div>
  );
}
