"use client";

import type { TaskDetail } from "@perago/sdk";
import { usePublicConfig } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  Disclosure,
  Fact,
  Glyph,
  Hash,
  Label,
  Panel,
  Status,
  StatusBadge,
} from "../ui";
import { describeRules, outcomeOf, type RuleView } from "./model";
import { RichText } from "./verdict";

function RawLine({ rule }: { rule: RuleView }) {
  return (
    <p className="mt-2 font-mono text-[11px] leading-relaxed text-fog [overflow-wrap:anywhere]">
      observed {rule.rawObserved} · limit {rule.rawLimit}
      {rule.code ? ` · ${rule.code}` : ""}
    </p>
  );
}

/** A failing rule: icon, name, code, the sentence, then observed against limit in human units. */
function FailedRule({ rule }: { rule: RuleView }) {
  return (
    <li className="border-l-2 border-fail-ink bg-fail-ink/[0.045] py-4 pr-4 pl-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Glyph name="cross" className="text-fail-ink" />
        <span className="font-medium">{rule.label}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fail-ink">
          {rule.code}
        </span>
      </div>
      <p className="mt-2 max-w-[60ch] text-[17px] leading-snug">
        <RichText rich={rule.sentence} />
      </p>
      <dl className="mt-3 flex flex-wrap gap-x-10 gap-y-2">
        <div>
          <dt>
            <Label>Observed</Label>
          </dt>
          <dd className="mt-0.5 font-mono text-[14px] font-medium">
            <RichText rich={rule.observed} />
          </dd>
        </div>
        <div>
          <dt>
            <Label>Limit</Label>
          </dt>
          <dd className="mt-0.5 font-mono text-[14px] font-medium">
            <RichText rich={rule.limit} />
          </dd>
        </div>
      </dl>
      <RawLine rule={rule} />
    </li>
  );
}

function PassedRule({ rule }: { rule: RuleView }) {
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-rule py-3.5",
      )}
    >
      <Glyph name="check" className="mt-1 text-ok-ink" />
      <div className="min-w-0">
        <p className="text-[14px]">
          <span className="font-medium">{rule.label}</span>
          <span className="text-fog">
            {" · "}
            <RichText rich={rule.sentence} />
          </span>
        </p>
        <RawLine rule={rule} />
      </div>
    </li>
  );
}

/**
 * The rule-by-rule matrix, failures first. Passing checks stay one disclosure
 * away with their raw values, so nothing the API said is hidden.
 */
export function PolicyDecisionPanel({ task }: { task: TaskDetail }) {
  const config = usePublicConfig();
  const decision = task.decision;
  if (!decision) {
    return (
      <Panel
        label="Policy decision"
        aside={<Status tone="idle">Not run</Status>}
      >
        <p className="max-w-[60ch] text-fog">
          No rule evaluation exists yet, because the goal has not become a plan.
        </p>
      </Panel>
    );
  }
  const rules = describeRules(
    task,
    config.data?.tokens ?? [],
    config.data?.adapters ?? [],
  );
  const failed = rules.filter((rule) => !rule.pass);
  const passed = rules.filter((rule) => rule.pass);
  const settled = outcomeOf(task) !== null;
  const blocked = failed.length > 0;
  return (
    <Panel
      label="Policy decision"
      collapsible={!blocked}
      defaultOpen={!settled}
      aside={
        blocked ? (
          <StatusBadge tone="fail" glyph="block">
            {failed.length} of {rules.length} failed
          </StatusBadge>
        ) : (
          <StatusBadge tone="ok" glyph="check">
            {passed.length} of {rules.length} passed
          </StatusBadge>
        )
      }
    >
      {blocked ? (
        <ol className="space-y-3">
          {failed.map((rule) => (
            <FailedRule key={rule.rule} rule={rule} />
          ))}
        </ol>
      ) : null}
      <Disclosure
        className={blocked ? "mt-5" : ""}
        label={`${passed.length} of ${rules.length} checks passed`}
        hint="raw values included"
      >
        <ol className="border-t border-rule">
          {passed.map((rule) => (
            <PassedRule key={rule.rule} rule={rule} />
          ))}
        </ol>
        <dl>
          <Fact label="compiler" value={decision.compilerVersion} />
          <Fact
            label="decision hash"
            value={<Hash value={task.decisionHash ?? task.intentHash} full />}
          />
          <Fact
            label="policy hash"
            value={<Hash value={decision.policyHash} full />}
          />
        </dl>
      </Disclosure>
    </Panel>
  );
}
