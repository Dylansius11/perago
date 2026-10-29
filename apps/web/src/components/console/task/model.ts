import {
  type PolicyRule,
  type PolicyRuleResult,
  type PublicConfig,
  REASON_MESSAGES,
  type TaskDetail,
} from "@perago/sdk";
import { amount, compact, duration, short } from "../../../lib/format";
import type { GlyphName, Tone } from "../ui";

/*
 * What a task page says, derived from the API's task detail, the latest local
 * simulation refusal, and the public config. Nothing here reads a wallet, a
 * clock, or a cache: pending can never be drawn as success.
 */

export type Token = PublicConfig["tokens"][number];
export type Adapter = PublicConfig["adapters"][number];

/** Text with optional hover titles, so a compact amount keeps its exact value reachable. */
export type Part = string | { text: string; title: string };
export type Rich = readonly Part[];

export const plain = (rich: Rich): string =>
  rich.map((part) => (typeof part === "string" ? part : part.text)).join("");

const sameAddress = (a: string, b: string) =>
  a.toLowerCase() === b.toLowerCase();
const ADDRESS = /0x[0-9a-fA-F]{40}/gu;
const uint = (value: string): bigint | null =>
  /^\d+$/u.test(value) ? BigInt(value) : null;

export function tokenOf(
  tokens: readonly Token[],
  address: string | null | undefined,
): Token | null {
  if (!address) return null;
  return tokens.find((token) => sameAddress(token.address, address)) ?? null;
}

/** Display symbol; the chain's own casing is not trusted for a headline. */
export const symbolOf = (token: Token): string => token.symbol.toUpperCase();

/** A base-unit amount for a reader: compact, with the exact value on hover. */
export function money(value: string | bigint, token: Token | null): Part {
  const raw = value.toString();
  if (uint(raw) === null) return raw;
  if (!token) return `${raw} base units`;
  const exact = `${amount(raw, token.decimals, token.decimals)} ${symbolOf(token)}`;
  const text = `${compact(raw, token.decimals, token.decimals)} ${symbolOf(token)}`;
  return text === exact
    ? text
    : { text, title: `${exact} (${raw} base units)` };
}

/** `100` bps as `1%`, `150` as `1.5%`, in integer math. */
export function percent(bpsValue: bigint): string {
  const whole = bpsValue / 100n;
  const fraction = (bpsValue % 100n)
    .toString()
    .padStart(2, "0")
    .replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}%` : `${whole}%`;
}

/** Whole minutes when exact, otherwise the console's own duration format. */
export function windowText(seconds: bigint): string {
  const total = Number(seconds);
  if (total > 0 && total % 60 === 0) {
    const minutes = total / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return duration(total);
}

function reasonSentence(code: string | null): string {
  if (code && code in REASON_MESSAGES)
    return REASON_MESSAGES[code as keyof typeof REASON_MESSAGES];
  return "The API refused this check.";
}

/* ------------------------------------------------------------------ */
/* Policy rules                                                        */
/* ------------------------------------------------------------------ */

export const RULE_LABEL: Record<PolicyRule, string> = {
  CHAIN: "Chain",
  ACCOUNT: "Account",
  SERVICE: "Service",
  PROTOCOL: "Protocol",
  ROUTE: "Route",
  PROTECTED_ASSET: "Protected asset",
  ACTIVE_ASSET: "Active asset",
  INPUT_AMOUNT: "Amount",
  PER_TASK_CAP: "Per-task limit",
  DAILY_CAP: "24-hour limit",
  SLIPPAGE: "Slippage",
  RECIPIENT: "Recipient",
  LIFETIME: "Signing window",
};

export type RuleView = {
  rule: PolicyRule;
  label: string;
  pass: boolean;
  code: string | null;
  sentence: Rich;
  /** Human-readable observed and limit values, for the observed-versus-limit pair. */
  observed: Rich;
  limit: Rich;
  rawObserved: string;
  rawLimit: string;
};

export type RuleContext = {
  tokens: readonly Token[];
  adapters: readonly Adapter[];
  /** The token this task would spend, resolved once for every rule. */
  input: Token | null;
};

/** Rewrites every 20-byte address in `text` as a token symbol when the config knows it. */
function readable(text: string, tokens: readonly Token[]): string {
  return text.replace(ADDRESS, (address) => {
    const token = tokenOf(tokens, address);
    return token ? symbolOf(token) : short(address, 8, 6);
  });
}

function serviceName(kind: string): string {
  return kind === "SWAP" ? "swap" : kind === "STAKE" ? "stake" : kind;
}

/** The token a rejected task would spend: the plan when it exists, else the rules' own evidence. */
export function inputTokenOf(
  task: TaskDetail,
  tokens: readonly Token[],
): Token | null {
  const fromPlan = tokenOf(tokens, task.plan?.action.inputToken);
  if (fromPlan) return fromPlan;
  const rules = task.decision?.rules ?? [];
  for (const name of ["PROTECTED_ASSET", "ACTIVE_ASSET"] as const) {
    const found = tokenOf(
      tokens,
      rules.find((rule) => rule.rule === name)?.observed,
    );
    if (found) return found;
  }
  return null;
}

function dailyParts(rule: PolicyRuleResult) {
  const match = /^(\d+) reserved in 24h \+ (\d+)$/u.exec(rule.observed);
  return {
    limit: uint(rule.limit),
    reserved: match?.[1] ? uint(match[1]) : null,
    adds: match?.[2] ? uint(match[2]) : null,
  };
}

function describeRule(result: PolicyRuleResult, ctx: RuleContext): RuleView {
  const { tokens, adapters, input } = ctx;
  const pass = result.outcome === "PASS";
  const code = result.reasonCode;
  const view = (sentence: Rich, observed: Rich, limit: Rich): RuleView => ({
    rule: result.rule,
    label: RULE_LABEL[result.rule],
    pass,
    code,
    sentence,
    observed,
    limit,
    rawObserved: result.observed,
    rawLimit: result.limit,
  });
  const asReason: Rich = [reasonSentence(code)];
  const rawObserved: Rich = [readable(result.observed, tokens)];
  const rawLimit: Rich = [readable(result.limit, tokens)];
  const symbol = input ? symbolOf(input) : "This asset";

  switch (result.rule) {
    case "CHAIN":
      return view(
        pass
          ? [
              `The task runs on chain ${result.limit}, the chain your policy covers.`,
            ]
          : asReason,
        rawObserved,
        [`chain ${result.limit}`],
      );
    case "ACCOUNT":
      return view(
        pass ? ["The task is for your smart account."] : asReason,
        [short(result.observed, 8, 6)],
        ["your smart account"],
      );
    case "SERVICE": {
      const allowed = result.limit.split(",").map(serviceName).join(" and ");
      return view(
        pass
          ? [`Your policy allows ${serviceName(result.observed)}.`]
          : [
              `Your policy does not allow ${serviceName(result.observed)}. It allows ${allowed}.`,
            ],
        [serviceName(result.observed)],
        [allowed],
      );
    }
    case "PROTOCOL": {
      const protocol =
        adapters.find((adapter) => adapter.id === result.observed)?.protocol ??
        result.observed;
      return view(
        pass
          ? [`${protocol} is an approved protocol in your policy.`]
          : [`${protocol} is not an approved protocol in your policy.`],
        [protocol],
        [
          result.limit
            .split(",")
            .map(
              (id) =>
                adapters.find((adapter) => adapter.id === id)?.protocol ?? id,
            )
            .join(", "),
        ],
      );
    }
    case "ROUTE": {
      const [from, to] = result.observed.split("->");
      const pair =
        from && to
          ? `${readable(from, tokens)} to ${readable(to, tokens)}`
          : readable(result.observed, tokens);
      return view(
        pass
          ? [`A pinned route exists for ${pair}.`]
          : [`No pinned route exists for ${pair}.`],
        [pair],
        rawLimit,
      );
    }
    case "PROTECTED_ASSET": {
      const token = tokenOf(tokens, result.observed);
      const name = token ? symbolOf(token) : short(result.observed, 8, 6);
      return view(
        pass
          ? [`${name} is not on your protected list.`]
          : [`${name} is protected in your policy, so it can never be spent.`],
        [name],
        [result.limit ? readable(result.limit, tokens) : "none protected"],
      );
    }
    case "ACTIVE_ASSET": {
      const token = tokenOf(tokens, result.observed);
      const name = token ? symbolOf(token) : short(result.observed, 8, 6);
      return view(
        pass
          ? [`${name} is active in your policy.`]
          : [`${name} is not an active asset in your policy.`],
        [name],
        [result.limit ? readable(result.limit, tokens) : "none active"],
      );
    }
    case "INPUT_AMOUNT": {
      const base = /\((\d+) base units\)/u.exec(result.observed)?.[1];
      const shown: Part = base ? money(base, input) : result.observed;
      return view(
        pass ? ["The amount is ", shown, "."] : asReason,
        [shown],
        [
          result.limit
            .replace("> 0 with at most ", "more than 0, up to ")
            .replace(/ decimals$/u, " decimals"),
        ],
      );
    }
    case "PER_TASK_CAP": {
      const spend = uint(result.observed);
      const cap = uint(result.limit);
      const spendPart: Part =
        spend !== null ? money(spend, input) : result.observed;
      const capPart: Part | null = cap !== null ? money(cap, input) : null;
      let sentence: Rich;
      if (pass) {
        sentence = capPart
          ? [
              "This task spends ",
              spendPart,
              ". Your policy allows up to ",
              capPart,
              " per task.",
            ]
          : ["Within your per-task limit."];
      } else if (code === "PER_TASK_CAP_EXCEEDED" && capPart) {
        sentence = [
          "This task would spend ",
          spendPart,
          ". Your policy allows at most ",
          capPart,
          " per task.",
        ];
      } else if (code === "ASSET_NOT_ACTIVE") {
        sentence = [
          `${symbol} is not active in your policy, so it has no per-task limit and cannot be spent.`,
        ];
      } else sentence = asReason;
      return view(sentence, [spendPart], capPart ? [capPart] : [result.limit]);
    }
    case "DAILY_CAP": {
      const daily = dailyParts(result);
      const limit: Part | null =
        daily.limit !== null ? money(daily.limit, input) : null;
      const reserved: Part | null =
        daily.reserved !== null ? money(daily.reserved, input) : null;
      const adds: Part | null =
        daily.adds !== null ? money(daily.adds, input) : null;
      let sentence: Rich;
      if (limit && reserved && adds) {
        sentence = pass
          ? [
              "Your policy allows up to ",
              limit,
              " per 24 hours. ",
              reserved,
              " is reserved so far and this task adds ",
              adds,
              ".",
            ]
          : code === "DAILY_CAP_EXCEEDED"
            ? [
                "Your policy allows at most ",
                limit,
                " per 24 hours. ",
                reserved,
                " is already reserved and this task would add ",
                adds,
                ".",
              ]
            : code === "ASSET_NOT_ACTIVE"
              ? [
                  `${symbol} is not active in your policy, so it has no 24-hour limit and cannot be spent.`,
                ]
              : asReason;
      } else sentence = asReason;
      return view(
        sentence,
        reserved && adds
          ? [reserved, " reserved + ", adds, " new"]
          : rawObserved,
        limit ? [limit, " per 24 h"] : [result.limit],
      );
    }
    case "SLIPPAGE": {
      const observed = /^\d+/u.exec(result.observed)?.[0];
      const seen = observed ? uint(observed) : null;
      const cap = uint(result.limit);
      return view(
        seen !== null && cap !== null
          ? pass
            ? [
                `Slippage is capped at ${percent(seen)}, within your ${percent(cap)} limit.`,
              ]
            : [
                `This task allows up to ${percent(seen)} slippage. Your policy allows at most ${percent(cap)}.`,
              ]
          : asReason,
        [seen !== null ? percent(seen) : result.observed],
        [cap !== null ? percent(cap) : result.limit],
      );
    }
    case "RECIPIENT":
      return view(
        pass
          ? ["The output goes to your smart account."]
          : [
              "The output would go to another address. Your policy only allows your smart account.",
            ],
        [readable(result.observed, tokens)],
        ["your smart account"],
      );
    case "LIFETIME": {
      const asked = uint(result.observed);
      const cap = uint(result.limit);
      return view(
        asked !== null && cap !== null
          ? pass
            ? [
                `The signing window is ${windowText(asked)}, within your ${windowText(cap)} limit.`,
              ]
            : code === "LIFETIME_EXCEEDED"
              ? [
                  `This task asks for a ${windowText(asked)} window. Your policy allows at most ${windowText(cap)}.`,
                ]
              : asReason
          : asReason,
        [asked !== null ? windowText(asked) : result.observed],
        [cap !== null ? windowText(cap) : result.limit],
      );
    }
  }
}

export function describeRules(
  task: TaskDetail,
  tokens: readonly Token[],
  adapters: readonly Adapter[],
): RuleView[] {
  const ctx: RuleContext = {
    tokens,
    adapters,
    input: inputTokenOf(task, tokens),
  };
  return (task.decision?.rules ?? []).map((rule) => describeRule(rule, ctx));
}

/** One entry per distinct reason code, so related checks do not repeat the same sentence. */
export function distinctFailures(rules: readonly RuleView[]): RuleView[] {
  const seen = new Set<string>();
  const out: RuleView[] = [];
  for (const rule of rules) {
    if (rule.pass) continue;
    const key = rule.code ?? rule.rule;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
}

/**
 * A goal that fits the active limits, offered only when a spend cap is the sole
 * reason for refusal; any other refusal cannot be repaired by changing the amount.
 */
export function suggestedGoal(
  task: TaskDetail,
  tokens: readonly Token[],
): string | null {
  const rules = task.decision?.rules;
  if (!rules) return null;
  const failing = rules.filter((rule) => rule.outcome === "FAIL");
  if (
    failing.length === 0 ||
    failing.some(
      (rule) =>
        (rule.rule !== "PER_TASK_CAP" && rule.rule !== "DAILY_CAP") ||
        rule.reasonCode === "ASSET_NOT_ACTIVE",
    )
  )
    return null;
  const input = inputTokenOf(task, tokens);
  const byRule = (name: PolicyRule) => rules.find((rule) => rule.rule === name);
  const perTask = uint(byRule("PER_TASK_CAP")?.limit ?? "");
  const dailyRule = byRule("DAILY_CAP");
  const daily = dailyRule ? dailyParts(dailyRule) : null;
  if (!input || perTask === null) return null;
  let allowed = perTask;
  if (daily?.limit != null && daily.reserved !== null) {
    const left =
      daily.limit > daily.reserved ? daily.limit - daily.reserved : 0n;
    if (left < allowed) allowed = left;
  }
  if (allowed <= 0n) return null;
  const text = amount(allowed, input.decimals, input.decimals);
  if (text === "0") return null;
  const service = byRule("SERVICE")?.observed;
  if (service === "STAKE") return `Stake ${text} ${symbolOf(input)}`;
  const outAddress = byRule("ROUTE")?.observed.split("->")[1];
  const output = tokenOf(tokens, outAddress);
  return output
    ? `Swap ${text} ${symbolOf(input)} to ${symbolOf(output)}`
    : null;
}

/* ------------------------------------------------------------------ */
/* Standing: one human status for a ledger row or a chip               */
/* ------------------------------------------------------------------ */

export type Standing = {
  label: string;
  tone: Tone;
  glyph: GlyphName;
  /** Work is in flight, so the mark may blink. */
  live: boolean;
};

const MANDATE_TERMINAL = ["SUCCEEDED", "FAILED", "REVOKED", "EXPIRED"] as const;
export type Outcome = (typeof MANDATE_TERMINAL)[number];

export function outcomeOf(task: TaskDetail): Outcome | null {
  const status = task.receipt?.status ?? task.mandate?.status ?? null;
  return MANDATE_TERMINAL.find((value) => value === status) ?? null;
}

export function standing(input: {
  status: string;
  mandateStatus: string | null;
  executionStatus: string | null;
}): Standing {
  const { status, mandateStatus, executionStatus } = input;
  switch (mandateStatus) {
    case "SUCCEEDED":
      return { label: "Succeeded", tone: "ok", glyph: "check", live: false };
    case "FAILED":
      return { label: "Failed", tone: "fail", glyph: "cross", live: false };
    case "REVOKED":
      return { label: "Revoked", tone: "idle", glyph: "minus", live: false };
    case "EXPIRED":
      return { label: "Expired", tone: "idle", glyph: "clock", live: false };
  }
  if (executionStatus === "REJECTED")
    return { label: "Rejected", tone: "fail", glyph: "cross", live: false };
  if (mandateStatus === "EXECUTING")
    return { label: "Executing", tone: "pending", glyph: "clock", live: true };
  if (mandateStatus === "AUTHORIZED")
    return { label: "Authorized", tone: "pending", glyph: "clock", live: true };
  switch (status) {
    case "REJECTED_POLICY":
      return {
        label: "Blocked by policy",
        tone: "fail",
        glyph: "block",
        live: false,
      };
    case "DRAFT":
      return { label: "Draft", tone: "idle", glyph: "draft", live: false };
    case "COMPILING":
      return {
        label: "Compiling",
        tone: "pending",
        glyph: "clock",
        live: true,
      };
    case "READY_TO_SIMULATE":
      return {
        label: "Simulating",
        tone: "pending",
        glyph: "clock",
        live: true,
      };
    case "SIMULATED":
      return {
        label: "Simulated",
        tone: "pending",
        glyph: "clock",
        live: true,
      };
    case "READY_TO_SIGN":
      return {
        label: "Ready to sign",
        tone: "signal",
        glyph: "arrow",
        live: false,
      };
    case "SIGNED":
      return { label: "Signed", tone: "pending", glyph: "clock", live: true };
    case "CANCELLED":
      return { label: "Cancelled", tone: "idle", glyph: "minus", live: false };
    default:
      return {
        label:
          status.charAt(0) + status.slice(1).toLowerCase().replace(/_/gu, " "),
        tone: "idle",
        glyph: "dot",
        live: false,
      };
  }
}

export function standingOf(task: TaskDetail): Standing {
  return standing({
    status: task.status,
    mandateStatus: task.receipt?.status ?? task.mandate?.status ?? null,
    executionStatus: task.execution?.status ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Verdict                                                             */
/* ------------------------------------------------------------------ */

export type VerdictKind =
  | "blocked"
  | "succeeded"
  | "failed"
  | "revoked"
  | "expired"
  | "rejected"
  | "retrying"
  | "executing"
  | "authorized"
  | "signed"
  | "ready"
  | "simulation-blocked"
  | "simulation-failed"
  | "simulation-stale"
  | "preparing"
  | "compiling"
  | "draft"
  | "cancelled"
  | "unknown";

export type Reason = {
  code: string;
  label: string | null;
  sentence: Rich;
  observed: Rich | null;
  limit: Rich | null;
};

export type Verdict = {
  kind: VerdictKind;
  standing: Standing;
  headline: Rich;
  detail: string | null;
  reasons: Reason[];
  /** What did not happen, said plainly. */
  note: string | null;
  /** Seconds from the signature to the terminal state, when both timestamps exist. */
  elapsedSeconds: number | null;
};

function actionSummary(
  task: TaskDetail,
  tokens: readonly Token[],
): Rich | null {
  const mandate = task.mandate?.mandate;
  if (!mandate) return null;
  const kind =
    task.simulation?.result.action.kind ?? task.plan?.action.kind ?? null;
  const spent = money(mandate.maxInput, tokenOf(tokens, mandate.inputToken));
  if (kind === "SWAP") {
    return [
      "Swapped ",
      spent,
      " for at least ",
      money(mandate.minOutput, tokenOf(tokens, mandate.outputToken)),
      ".",
    ];
  }
  if (kind === "STAKE") {
    return [
      "Staked ",
      spent,
      " for at least ",
      `${mandate.minOutput} pool shares`,
      ".",
    ];
  }
  return ["Executed within the signed limits, up to ", spent, "."];
}

export function elapsedSeconds(task: TaskDetail): number | null {
  if (!task.mandate || !task.execution) return null;
  const from = Date.parse(task.mandate.createdAt);
  const to = Date.parse(task.execution.updatedAt);
  if (Number.isNaN(from) || Number.isNaN(to) || to < from) return null;
  return Math.round((to - from) / 1000);
}

function codeReasons(code: string | null, detail: string | null): Reason[] {
  if (!code) return [];
  return [
    {
      code,
      label: null,
      sentence: [detail ?? reasonSentence(code)],
      observed: null,
      limit: null,
    },
  ];
}

/** A refused attempt is local to this task, not a persisted task status. */
export type SimulationRefusal = {
  taskId: string;
  code: string;
  detail: string | null;
  /** The simulation visible before this attempt; a new result supersedes it. */
  simulationId: string | null;
};

function simulationBlocked(
  task: TaskDetail,
  refusal: SimulationRefusal | null,
): refusal is SimulationRefusal {
  return (
    refusal !== null &&
    refusal.taskId === task.taskId &&
    task.mandate === null &&
    (task.simulation?.simulationId ?? null) === refusal.simulationId &&
    ["READY_TO_SIMULATE", "SIMULATED", "READY_TO_SIGN"].includes(task.status)
  );
}

export function deriveVerdict(
  task: TaskDetail,
  tokens: readonly Token[],
  adapters: readonly Adapter[],
  refusal: SimulationRefusal | null = null,
): Verdict {
  const base = standingOf(task);
  const outcome = outcomeOf(task);
  const mandateStatus = task.receipt?.status ?? task.mandate?.status ?? null;
  const execution = task.execution;
  const make = (
    kind: VerdictKind,
    headline: Rich,
    extra: Partial<Omit<Verdict, "kind" | "headline">> = {},
  ): Verdict => ({
    kind,
    standing: base,
    headline,
    detail: null,
    reasons: [],
    note: null,
    elapsedSeconds: null,
    ...extra,
  });

  if (outcome === "SUCCEEDED") {
    return make(
      "succeeded",
      actionSummary(task, tokens) ?? ["The task succeeded."],
      {
        detail: "Verified onchain. Authority ended.",
        elapsedSeconds: elapsedSeconds(task),
      },
    );
  }
  if (outcome === "FAILED") {
    const code = task.receipt?.terminalReasonCode ?? "ONCHAIN_FAILED";
    return make("failed", ["The task failed onchain."], {
      reasons: codeReasons(code, null),
      note: "Authority ended. This mandate cannot run again.",
      elapsedSeconds: elapsedSeconds(task),
    });
  }
  if (outcome === "REVOKED") {
    return make("revoked", ["Revoked before it ran."], {
      reasons: codeReasons("ONCHAIN_REVOKED", null),
      note: "Authority ended. This mandate cannot run again.",
    });
  }
  if (outcome === "EXPIRED") {
    return make("expired", ["Expired before it ran."], {
      reasons: codeReasons("ONCHAIN_EXPIRED", null),
      note: "Authority ended. This mandate cannot run again.",
    });
  }

  if (task.status === "REJECTED_POLICY") {
    const rules = describeRules(task, tokens, adapters);
    return make("blocked", ["Blocked by your policy."], {
      reasons: distinctFailures(rules).map((rule) => ({
        code: rule.code ?? rule.rule,
        label: rule.label,
        sentence: rule.sentence,
        observed: rule.observed,
        limit: rule.limit,
      })),
      note: "Nothing was signed. No funds moved.",
    });
  }

  if (execution?.status === "REJECTED") {
    return make("rejected", ["The executor rejected this task."], {
      reasons: codeReasons(execution.lastErrorCode, execution.lastErrorDetail),
    });
  }
  if (execution?.status === "RETRY_WAIT") {
    return make("retrying", ["Execution hit a problem and will retry."], {
      detail: "The executor retries on its own. Nothing is final yet.",
      reasons: codeReasons(execution.lastErrorCode, execution.lastErrorDetail),
    });
  }
  if (
    mandateStatus === "EXECUTING" ||
    ["EXECUTING", "VERIFYING", "SETTLING"].includes(execution?.status ?? "")
  ) {
    return make("executing", ["Executing onchain."], {
      detail: "Not complete until the chain result is verified.",
    });
  }
  if (mandateStatus === "AUTHORIZED") {
    return make("authorized", ["Authorized onchain."], {
      detail:
        "The executor runs it next. You can still revoke until execution begins.",
    });
  }
  if (task.mandate || task.status === "SIGNED") {
    return make("signed", ["Signed. Waiting for the chain."], {
      detail:
        "The API is reconciling the chain before the mandate is authorized. Nothing has executed.",
    });
  }

  if (simulationBlocked(task, refusal)) {
    const input = inputTokenOf(task, tokens);
    const balance = /^holds (\d+); the plan spends (\d+)$/u.exec(
      refusal.detail ?? "",
    );
    const insufficient = refusal.code === "INSUFFICIENT_BALANCE";
    const formatted = insufficient && input && balance;
    return make(
      "simulation-blocked",
      insufficient && input
        ? [`Not enough ${symbolOf(input)} to run this.`]
        : ["Simulation is blocked."],
      {
        standing: {
          label: "Blocked",
          tone: "fail",
          glyph: "block",
          live: false,
        },
        detail: formatted
          ? `Your account holds ${plain([money(balance[1] ?? "", input)])}. This task spends ${plain([money(balance[2] ?? "", input)])}. Nothing was signed.`
          : reasonSentence(refusal.code),
        reasons: codeReasons(refusal.code, null),
        note: formatted ? null : "Nothing was signed.",
      },
    );
  }

  if (task.simulation?.status === "REVERTED") {
    const failure = task.simulation.result.failure;
    return make("simulation-failed", ["The simulation failed."], {
      reasons: [
        {
          code: "SIMULATION_REVERTED",
          label: "Simulation",
          sentence: [failure?.reason ?? reasonSentence("SIMULATION_REVERTED")],
          observed: null,
          limit: null,
        },
      ],
      note: "Nothing can be signed for this plan.",
    });
  }
  if (task.status === "READY_TO_SIGN") {
    return make("ready", ["Ready for your signature."], {
      detail:
        "Policy passed and the exact simulation is current. Review the terms below. Nothing is signed yet.",
    });
  }
  if (task.simulation?.status === "STALE") {
    return make("simulation-stale", ["The simulation is stale."], {
      detail:
        "It runs again before anything can be signed. Nothing is signed yet.",
    });
  }
  if (task.status === "SIMULATED") {
    return make("preparing", ["Simulated. Preparing the mandate."], {
      detail: "Nothing is signed yet.",
    });
  }
  if (task.status === "READY_TO_SIMULATE") {
    return make("preparing", ["Policy passed. Running the exact simulation."], {
      detail: "Nothing is signed yet.",
    });
  }
  if (task.status === "COMPILING") {
    return make("compiling", ["Compiling your goal."], {
      detail: "The planner is turning it into a plan. Nothing is signed yet.",
    });
  }
  if (task.status === "DRAFT") {
    return make("draft", ["Saved, not compiled."], {
      detail:
        "The goal was saved but never became a plan, so no policy check has run.",
      note: "Nothing was signed. No funds moved.",
    });
  }
  if (task.status === "CANCELLED") {
    return make("cancelled", ["Cancelled."], {
      note: "Nothing was signed. No funds moved.",
    });
  }
  return make("unknown", [`Status: ${task.status}.`]);
}

/** Tasks that can no longer move forward without a new goal: downstream panels would only say "waiting". */
export function stoppedAt(task: TaskDetail): string | null {
  if (task.status === "REJECTED_POLICY") return "stopped at policy";
  if (task.status === "DRAFT") return "no plan compiled";
  if (task.status === "CANCELLED") return "cancelled";
  return null;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export type StepKey =
  | "goal"
  | "policy"
  | "plan"
  | "simulation"
  | "signature"
  | "execution"
  | "verified";

export type StepState = "done" | "current" | "failed" | "todo";

export type Step = {
  key: StepKey;
  label: string;
  state: StepState;
  /** One or two words under the label. */
  detail: string;
  /** Only the current step of a task that is progressing on its own may animate. */
  live: boolean;
};

export function lifecycle(
  task: TaskDetail,
  refusal: SimulationRefusal | null = null,
): Step[] {
  const outcome = outcomeOf(task);
  const decision = task.decision;
  const simulation = task.simulation;
  const signed = task.mandate !== null;
  const rejected = task.status === "REJECTED_POLICY";
  const blocked = simulationBlocked(task, refusal);
  const raw: Array<{ key: StepKey; label: string; done: StepState }> = [
    { key: "goal", label: "Goal", done: "done" },
    {
      key: "policy",
      label: "Policy",
      done: decision
        ? decision.outcome === "PASS"
          ? "done"
          : "failed"
        : rejected
          ? "failed"
          : "todo",
    },
    { key: "plan", label: "Plan", done: task.plan ? "done" : "todo" },
    {
      key: "simulation",
      label: "Simulation",
      done:
        (blocked || simulation?.status === "REVERTED") && !signed
          ? "failed"
          : simulation && (simulation.status === "PASSED" || signed)
            ? "done"
            : "todo",
    },
    { key: "signature", label: "Signature", done: signed ? "done" : "todo" },
    {
      key: "execution",
      label: "Execution",
      done: outcome === "SUCCEEDED" ? "done" : outcome ? "failed" : "todo",
    },
    {
      key: "verified",
      label: "Verified",
      done: outcome === "SUCCEEDED" ? "done" : "todo",
    },
  ];
  const live = standingOf(task).live;
  const failedAt = raw.findIndex((step) => step.done === "failed");
  const firstTodo = raw.findIndex((step) => step.done === "todo");
  const stopped = stoppedAt(task) !== null;
  const currentIndex = failedAt === -1 && !stopped ? firstTodo : -1;
  const decisionRules = decision?.rules ?? [];
  const passed = decisionRules.filter((rule) => rule.outcome === "PASS").length;
  return raw.map((step, index): Step => {
    const state: StepState =
      step.done === "todo" && index === currentIndex ? "current" : step.done;
    const unreached = failedAt !== -1 || outcome !== null || stopped;
    let detail: string;
    switch (state) {
      case "done":
        detail =
          step.key === "goal"
            ? "Saved"
            : step.key === "policy"
              ? `${passed} of ${decisionRules.length} passed`
              : step.key === "plan"
                ? "Compiled"
                : step.key === "simulation"
                  ? signed
                    ? "Used"
                    : "Passed"
                  : step.key === "signature"
                    ? "Signed"
                    : step.key === "execution"
                      ? "Executed"
                      : "Verified";
        break;
      case "failed":
        detail =
          step.key === "policy"
            ? "Blocked"
            : step.key === "simulation"
              ? blocked
                ? "Blocked"
                : "Reverted"
              : outcome === "REVOKED"
                ? "Revoked"
                : outcome === "EXPIRED"
                  ? "Expired"
                  : "Failed";
        break;
      case "current":
        detail =
          step.key === "policy"
            ? task.status === "COMPILING"
              ? "Running"
              : "Not run"
            : step.key === "plan"
              ? "Compiling"
              : step.key === "simulation"
                ? simulation?.status === "STALE"
                  ? "Stale, re-run"
                  : "Running"
                : step.key === "signature"
                  ? task.status === "READY_TO_SIGN"
                    ? "Your turn"
                    : "Preparing"
                  : step.key === "execution"
                    ? task.mandate?.status === "SIGNED"
                      ? "Waiting for chain"
                      : "In progress"
                    : "In progress";
        break;
      default:
        detail =
          step.key === "policy" && task.status === "DRAFT"
            ? "Not run"
            : unreached
              ? "Not reached"
              : "Up next";
    }
    return {
      key: step.key,
      label: step.label,
      state,
      detail,
      live: state === "current" && live,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Moving funds to the owner's own wallet                              */
/* ------------------------------------------------------------------ */

/** What a task page can pre-fill on the Funds withdrawal form; null means the form just opens. */
export type SelfWithdrawHint = { symbol: string | null; amount: string | null };

const OWN_WALLET_GOAL =
  /\b(?:my|own)\s+(?:own\s+)?(?:wallet|metamask|phantom|eoa|address)\b|\bback to me\b|\bto me\b/iu;

/** The spend the task named: the plan when it exists, else the rules' own evidence. */
function namedSpend(
  task: TaskDetail,
  tokens: readonly Token[],
): SelfWithdrawHint {
  const token = inputTokenOf(task, tokens);
  const base =
    task.plan?.action.inputAmount ??
    /\((\d+) base units\)/u.exec(
      task.decision?.rules.find((rule) => rule.rule === "INPUT_AMOUNT")
        ?.observed ?? "",
    )?.[1];
  if (!token || !base) return { symbol: null, amount: null };
  return {
    symbol: token.symbol,
    amount: amount(base, token.decimals, token.decimals).replaceAll(",", ""),
  };
}

/**
 * Shown under a policy refusal when the output was headed for the connected
 * owner wallet. The recipient comes from the decision's own evidence, then
 * the plan; only when neither names an address does the goal text decide
 * whether a generic hint is worth showing. It never builds calldata.
 */
export function selfWithdrawHint(
  task: TaskDetail,
  owner: string | null,
  tokens: readonly Token[],
): SelfWithdrawHint | null {
  if (!owner) return null;
  const refused = task.decision?.rules.find(
    (rule) =>
      rule.rule === "RECIPIENT" &&
      rule.outcome === "FAIL" &&
      rule.reasonCode === "RECIPIENT_NOT_ALLOWED",
  );
  if (!refused) return null;
  const named = refused.observed.match(ADDRESS) ?? [];
  const recipients =
    named.length > 0 ? named : task.plan ? [task.plan.action.recipient] : null;
  const toOwner =
    recipients === null
      ? OWN_WALLET_GOAL.test(task.goal)
      : recipients.some((address) => sameAddress(address, owner));
  if (!toOwner) return null;
  return recipients === null
    ? { symbol: null, amount: null }
    : namedSpend(task, tokens);
}
