"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  CreateAccount,
  ReadinessRail,
  readinessOf,
  type Section,
  SectionNav,
} from "@/components/console/account";
import { FundsSection } from "@/components/console/funds";
import { PolicySection } from "@/components/console/policy";
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
  const loading = holdings.isPending || policies.isPending || tasks.isPending;
  const loaded = config.data !== undefined && !loading;

  // The sections render after their data, so a deep link such as /app#policy
  // has nothing to land on until now.
  useEffect(() => {
    if (!loaded) return;
    const id = window.location.hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [loaded]);

  if (!config.data || !owner || !account)
    return (
      <div className="relative h-52 border border-rule">
        <Scan />
      </div>
    );
  const ready = readinessOf(holdings.data, policies.data);

  const sections: Section[] = [
    ...(!ready.deployed ? [{ id: "account", label: "Account" }] : []),
    ...(ready.deployed && !ready.funded ? [{ id: "fund", label: "Fund" }] : []),
    ...(ready.deployed ? [{ id: "funds", label: "Funds" }] : []),
    ...(ready.deployed ? [{ id: "policy", label: "Policy" }] : []),
    ...(ready.policy ? [{ id: "goal", label: "Goal" }] : []),
    { id: "ledger", label: "Ledger" },
  ];
  const numberOf = (id: string) =>
    String(sections.findIndex((section) => section.id === id) + 1).padStart(
      2,
      "0",
    );

  return (
    <div className="space-y-0">
      <div className="grid border border-rule md:grid-cols-12">
        <div className="border-b border-rule px-6 py-8 md:col-span-9 md:border-b-0 md:border-r md:px-8 md:py-10">
          <Label>Console / Chain {config.data.chainId}</Label>
          <h1 className="mt-3 max-w-[21ch] text-4xl font-semibold leading-[1.02] tracking-[-0.03em] md:text-6xl">
            Your intent, carried through.
          </h1>
          <p className="mt-4 max-w-[64ch] text-[16px] leading-relaxed text-fog">
            One wallet. Explicit limits. One-use authority. A public,
            independently checkable receipt at the end.
          </p>
        </div>
        <div className="flex flex-col justify-between gap-6 px-6 py-8 md:col-span-3 md:px-8 md:py-10">
          <div className="space-y-3">
            <Status tone={config.data.venue === "fork" ? "pending" : "signal"}>
              {config.data.venue === "fork"
                ? "Local chain-97 fork"
                : "BSC Testnet"}
            </Status>
            {policies.data ? (
              <p>
                <a
                  href="#policy"
                  className="pressable inline-flex min-h-8 items-center"
                >
                  <Status tone={ready.policy ? "ok" : "idle"}>
                    {ready.policy
                      ? `Policy v${ready.policy.version} active`
                      : "No active policy"}
                  </Status>
                </a>
              </p>
            ) : null}
          </div>
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
        <>
          <SectionNav sections={sections} />
          <div className="grid items-start gap-0 border-x border-b border-rule lg:grid-cols-[minmax(19rem,4fr)_minmax(0,8fr)]">
            <div className="border-b border-rule p-5 md:p-7 lg:sticky lg:top-28 lg:border-b-0 lg:border-r">
              <ReadinessRail
                readiness={ready}
                holdings={holdings.data}
                config={config.data}
              />
            </div>
            <div className="min-w-0 divide-y divide-rule">
              {!ready.deployed ? (
                <Panel
                  id="account"
                  label={`${numberOf("account")} / Account`}
                  className="scroll-mt-28 !border-0"
                >
                  <CreateAccount owner={owner} account={account} />
                </Panel>
              ) : null}
              {ready.deployed && !ready.funded ? (
                <Panel
                  id="fund"
                  label={`${numberOf("fund")} / Fund`}
                  className="scroll-mt-28 !border-0"
                >
                  <h2 className="text-3xl font-semibold tracking-[-0.03em]">
                    Fund your account.
                  </h2>
                  <p className="mt-3 max-w-[60ch] text-fog">
                    The faucet transfers testnet tBNB to this smart account, not
                    to your owner wallet. You can also transfer tBNB or
                    supported tokens directly to its address.
                  </p>
                  <Link
                    href="/faucet"
                    className="pressable mt-6 inline-flex min-h-12 items-center bg-ink px-6 text-paper hover:bg-signal hover:text-ink"
                  >
                    Open faucet ↗
                  </Link>
                </Panel>
              ) : null}
              {ready.deployed && holdings.data ? (
                <FundsSection
                  owner={owner}
                  account={account}
                  config={config.data}
                  holdings={holdings.data}
                  number={numberOf("funds")}
                />
              ) : null}
              {ready.deployed ? (
                <PolicySection
                  config={config.data}
                  policies={policies.data ?? []}
                  holdings={holdings.data}
                  number={numberOf("policy")}
                />
              ) : null}
              {ready.policy ? (
                <Panel
                  id="goal"
                  label={`${numberOf("goal")} / One goal`}
                  className="scroll-mt-28 !border-0"
                >
                  <TaskComposer
                    config={config.data}
                    maxLifetime={ready.policy.policy.maxTaskLifetimeSeconds}
                  />
                </Panel>
              ) : null}
              <Panel
                id="ledger"
                label={`${numberOf("ledger")} / Task ledger`}
                className="scroll-mt-28 !border-0"
              >
                {tasks.data ? (
                  <TaskLedger tasks={tasks.data} />
                ) : tasks.isError ? (
                  <Button variant="ghost" onClick={() => void tasks.refetch()}>
                    Retry task list
                  </Button>
                ) : (
                  <Scan />
                )}
              </Panel>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
