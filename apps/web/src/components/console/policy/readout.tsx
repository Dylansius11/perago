"use client";

import type { PolicyView, PublicConfig } from "@perago/sdk";
import type { ReactNode } from "react";
import { amount, compact, duration, utc } from "@/lib/format";
import type { Holdings } from "@/lib/queries";
import { Button, Hash, Label, Panel, Status, useSecondsUntil } from "../ui";
import { describePolicy, joinList } from "./describe";
import { diffPolicies } from "./diff";
import { Evidence } from "./evidence";
import { renewState } from "./renew";

/*
 * "Your policy": what the active Wallet Policy lets Perago do, in plain words,
 * derived only from the policy document and the public catalog. The chain
 * holds the policy's hash, not its contents; the readout says so and shows
 * the allowance the chain really holds so the two can be compared.
 */

function Row({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 border-b border-rule py-4 last:border-b-0 md:grid-cols-[10.5rem_minmax(0,1fr)] md:gap-8">
      <dt className="pt-[3px] font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
        {label}
      </dt>
      <dd className="min-w-0">
        <div className="text-[17px] leading-snug text-ink">{children}</div>
        {note ? (
          <div className="mt-1.5 text-[13px] leading-snug text-fog">{note}</div>
        ) : null}
      </dd>
    </div>
  );
}

function Limit({
  label,
  shown,
  exact,
  symbol,
}: {
  label: string;
  shown: string;
  exact: string;
  symbol: string;
}) {
  return (
    <div className="min-w-0">
      <Label className="block">{label}</Label>
      <p
        title={`${exact} ${symbol}`}
        className="mt-1 truncate font-mono text-[22px] leading-none tabular-nums text-ink"
      >
        <span className="mr-1.5 font-sans text-[13px] text-fog">up to</span>
        {shown}
        <span className="ml-1.5 text-[13px] text-fog">{symbol}</span>
      </p>
    </div>
  );
}

/** What the owner can do about a session that ended or is about to. */
export type RenewControl = {
  busy: boolean;
  disabled: boolean;
  onRenew: () => void;
};

function ActiveReadout({
  config,
  policy,
  holdings,
  renew,
}: {
  config: PublicConfig;
  policy: PolicyView;
  holdings: Holdings | undefined;
  renew: RenewControl;
}) {
  const facts = describePolicy(policy.policy, config);
  const sessionEnds =
    policy.validUntil === null ? null : Number(policy.validUntil);
  const left = useSecondsUntil(sessionEnds);
  const ended = left !== null && left <= 0;
  const renewal = renewState(left);
  const explorer = config.explorer;
  const services =
    facts.services.charAt(0).toUpperCase() + facts.services.slice(1);

  return (
    <div>
      {renewal ? (
        <div
          role="status"
          className={
            ended
              ? "mb-6 border-l-2 border-fail-ink py-1 pl-4"
              : "mb-6 border-l-2 border-statuspending py-1 pl-4"
          }
        >
          <Status tone={ended ? "fail" : "pending"}>
            {ended ? "Session ended" : "Session ends soon"}
          </Status>
          <p className="mt-1.5 max-w-[64ch] text-[15px] leading-snug text-ink">
            {ended
              ? "The 24-hour session for this policy has ended, so Perago cannot execute anything until you renew it. Your standing allowances stay set until you revoke or replace them."
              : "Less than 2 hours remain in this 24-hour session. When it ends, Perago cannot execute anything until you renew it."}
          </p>
          <p className="mt-1.5 max-w-[64ch] text-[14px] leading-snug text-fog">
            Renewing keeps these exact limits and starts a new 24-hour session.
            You review what your wallet signs first.
          </p>
          <Button
            className="mt-4"
            busy={renew.busy}
            disabled={renew.disabled}
            onClick={renew.onRenew}
          >
            Renew session
          </Button>
        </div>
      ) : null}

      <h2 className="max-w-[26ch] text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] md:text-4xl">
        {services}, inside these limits.
      </h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-fog">
        This is what policy v{policy.version} allows. Perago can propose only
        inside it. Nothing executes without your signature on a specific
        mandate.
      </p>

      <dl className="mt-6 border-t border-rule">
        <Row label="Perago may">
          <span className="font-medium">{services}</span>
        </Row>
        <Row
          label="Using"
          note={`Only ${facts.adapters.length === 1 ? "this pinned adapter" : `these ${facts.adapters.length} pinned adapters`} can be called. Anything else is refused.`}
        >
          <ul className="space-y-1.5">
            {facts.adapters.map((adapter) => (
              <li
                key={adapter.id}
                className="flex flex-wrap items-baseline gap-x-3"
              >
                <span className="w-14 shrink-0 font-mono text-[11px] uppercase tracking-[0.14em] text-fog">
                  {adapter.kind ?? "other"}
                </span>
                <span className="font-medium">{adapter.label}</span>
                {adapter.known ? null : (
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-pending-ink">
                    not in catalog
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Row>
        <Row label="Can spend">
          <div className="space-y-5">
            {facts.limits.map((limit) => (
              <div
                key={limit.address}
                className="grid grid-cols-2 items-end gap-x-8 gap-y-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)]"
              >
                <span className="col-span-2 w-fit self-center border border-rule px-2 py-1 font-mono text-[12px] sm:col-span-1">
                  {limit.symbol}
                </span>
                <Limit
                  label="Per task"
                  shown={limit.perTask.shown}
                  exact={limit.perTask.exact}
                  symbol={limit.symbol}
                />
                <Limit
                  label="Per 24 hours"
                  shown={limit.daily.shown}
                  exact={limit.daily.exact}
                  symbol={limit.symbol}
                />
              </div>
            ))}
          </div>
        </Row>
        <Row
          label="Never touches"
          note={
            facts.offTokens.length > 0
              ? `${joinList(facts.offTokens)} ${facts.offTokens.length === 1 ? "is" : "are"} off: not spendable, and not protected.`
              : "Protected tokens cannot be the input of any task."
          }
        >
          {facts.protectedTokens.length > 0 ? (
            <ul className="flex flex-wrap gap-x-5 gap-y-1">
              {facts.protectedTokens.map((symbol) => (
                <li key={symbol} className="font-medium">
                  {symbol}{" "}
                  <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ok-ink">
                    protected
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-fog">No protected tokens</span>
          )}
        </Row>
        <Row label="Slippage" note={`${facts.slippageBps} bps`}>
          At most <span className="font-medium">{facts.slippagePercent}%</span>
        </Row>
        <Row
          label="Results go to"
          note={
            <Hash
              value={policy.policy.account}
              href={
                explorer ? `${explorer.address}${policy.policy.account}` : null
              }
            />
          }
        >
          <span className="font-medium">Your smart account only</span>
        </Row>
        <Row label="Each task">
          Expires within{" "}
          <span className="font-medium">{duration(facts.lifetimeSeconds)}</span>{" "}
          and needs your signature.
        </Row>
        <Row
          label="Session"
          note="The scoped key Perago uses to submit a mandate you signed. It can call one function on MandateExecutor and cannot spend native value."
        >
          {sessionEnds === null ? (
            <span className="text-fog">unavailable</span>
          ) : ended ? (
            <>
              Ended{" "}
              <span className="font-mono text-[15px]">{utc(sessionEnds)}</span>
            </>
          ) : (
            <>
              Valid until{" "}
              <span className="font-mono text-[15px]">{utc(sessionEnds)}</span>
              <span className="ml-2 font-mono text-[12px] text-fog">
                {left === null ? "" : `${duration(left)} left`}
              </span>
            </>
          )}
        </Row>
      </dl>

      <div className="mt-6 border border-rule">
        <div className="flex items-center justify-between gap-4 border-b border-rule px-4 py-2.5">
          <Label>Onchain anchor</Label>
          <Status tone={holdings ? "ok" : "idle"}>
            {holdings ? "live read" : "reading"}
          </Status>
        </div>
        <dl className="px-4">
          <Evidence
            label="Policy hash"
            value={<Hash value={policy.policyHash} />}
            note="The hash is what the contract checks. A mandate signed against any other hash is refused. The policy contents live in the Perago API."
          />
          {config.tokens.map((token) => {
            const entry = holdings?.tokens[token.symbol];
            const cap = facts.limits.find(
              (limit) =>
                limit.address.toLowerCase() === token.address.toLowerCase(),
            );
            return (
              <Evidence
                key={token.address}
                label={`${token.symbol} allowance`}
                value={
                  entry ? (
                    <span
                      title={`${amount(entry.allowance, token.decimals, token.decimals)} ${token.symbol}`}
                    >
                      {compact(entry.allowance, token.decimals)} {token.symbol}
                    </span>
                  ) : (
                    <span className="text-fog">reading</span>
                  )
                }
                note={
                  cap
                    ? `Standing allowance to MandateExecutor. Policy cap per 24 hours: ${cap.daily.shown} ${token.symbol}.`
                    : "Standing allowance to MandateExecutor. This token is not active, so it should be 0."
                }
              />
            );
          })}
          <Evidence
            label="MandateExecutor"
            value={
              <Hash
                value={config.mandateExecutor}
                href={
                  explorer
                    ? `${explorer.address}${config.mandateExecutor}`
                    : null
                }
              />
            }
          />
          <Evidence
            label="Last updated"
            value={utc(policy.updatedAt)}
            note="From the API record of this policy."
          />
        </dl>
      </div>
    </div>
  );
}

function EmptyReadout({ revoked }: { revoked: PolicyView | null }) {
  return (
    <div role="status">
      <h2 className="max-w-[24ch] text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] md:text-4xl">
        {revoked ? "All access is revoked." : "No policy is active."}
      </h2>
      <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-fog">
        {revoked
          ? `Policy v${revoked.version} was ended on chain and its session was removed. The standing allowances were set to 0. Perago cannot propose or execute anything until you activate a new policy.`
          : "Perago may do nothing for this account yet. Set limits below and sign them to begin. Until then no task can be planned."}
      </p>
      {revoked ? (
        <dl className="mt-6 border-t border-rule">
          <Evidence label="Revoked policy" value={`v${revoked.version}`} />
          <Evidence
            label="Recorded"
            value={utc(revoked.updatedAt)}
            note="From the API record of this policy."
          />
        </dl>
      ) : null}
    </div>
  );
}

export function PolicyReadout({
  id,
  label,
  config,
  active,
  revoked,
  draft,
  confirming,
  holdings,
  onResumeDraft,
  resumeDisabled,
  renew,
  actions,
}: {
  id: string;
  label: string;
  config: PublicConfig;
  active: PolicyView | null;
  revoked: PolicyView | null;
  draft: PolicyView | null;
  confirming: PolicyView | null;
  holdings: Holdings | undefined;
  onResumeDraft: () => void;
  resumeDisabled: boolean;
  renew: RenewControl;
  actions: ReactNode;
}) {
  const draftChanges = draft
    ? diffPolicies(active?.policy ?? null, draft.policy, config)
    : [];
  return (
    <Panel
      id={id}
      label={label}
      className="scroll-mt-28 !border-0"
      aside={
        active ? (
          <Status tone="ok">Active · v{active.version}</Status>
        ) : confirming ? (
          <Status tone="pending">Confirming · v{confirming.version}</Status>
        ) : (
          <Status tone="idle">{revoked ? "Revoked" : "No policy"}</Status>
        )
      }
    >
      {active ? (
        <ActiveReadout
          config={config}
          policy={active}
          holdings={holdings}
          renew={renew}
        />
      ) : (
        <EmptyReadout revoked={revoked} />
      )}

      {confirming ? (
        <div
          role="status"
          className="mt-6 border-l-2 border-statuspending py-1 pl-4"
        >
          <Status tone="pending">
            Policy v{confirming.version} is confirming
          </Status>
          <p className="mt-1.5 max-w-[64ch] text-[14px] leading-snug text-fog">
            A signed transition is waiting for the API to read it from the
            chain. Nothing changes until that finishes.
          </p>
        </div>
      ) : null}

      {draft ? (
        <div className="mt-6 border border-dashed border-rule p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <Status tone="pending">
                Draft v{draft.version} · not active
              </Status>
              <p className="mt-1.5 max-w-[56ch] text-[14px] leading-snug text-fog">
                Saved from a review that stopped before you signed. It changes
                nothing until you do.
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={resumeDisabled}
              onClick={onResumeDraft}
            >
              Resume this draft
            </Button>
          </div>
          {draftChanges.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-dashed border-rule pt-3 font-mono text-[12px] text-fog">
              {draftChanges.map((line) => (
                <li key={line.label}>
                  {line.label}: {line.from} <span aria-hidden>&#8594;</span>
                  <span className="sr-only"> to </span> {line.to}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {actions ? (
        <div className="mt-6 border-t border-rule pt-6">{actions}</div>
      ) : null}
    </Panel>
  );
}
