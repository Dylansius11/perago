import {
  type PolicyRuleResult,
  REASON_MESSAGES,
  type TaskDetail,
} from "@perago/sdk";
import { describe, expect, it } from "vitest";
import {
  deriveVerdict,
  describeRules,
  lifecycle,
  percent,
  plain,
  selfWithdrawHint,
  standing,
  stoppedAt,
  suggestedGoal,
  type Token,
  windowText,
} from "./model";

const wbnb = "0xae13d989dac2f0debff460ac112a837c89baa7cd";
const cake = "0xfa60d973f7642b748046464e165a65b7323b0dee";
const account = "0x17fcce2b0c0cc44c4f88c6c09b6364a766ee7944";
const tokens: Token[] = [
  { symbol: "WBNB", address: wbnb, decimals: 18 },
  { symbol: "Cake", address: cake, decimals: 18 },
] as Token[];

function rule(
  name: PolicyRuleResult["rule"],
  limit: string,
  observed: string,
  reasonCode: string | null = null,
): PolicyRuleResult {
  return {
    rule: name,
    outcome: reasonCode ? "FAIL" : "PASS",
    reasonCode,
    limit,
    observed,
  } as PolicyRuleResult;
}

function decision(overrides: Partial<Record<string, PolicyRuleResult>> = {}) {
  const base: PolicyRuleResult[] = [
    rule("CHAIN", "97", "intent 97; catalog 97"),
    rule("ACCOUNT", account, account),
    rule("SERVICE", "SWAP,STAKE", "SWAP"),
    rule("PROTOCOL", "pancakeswap-v3,cake-pool", "pancakeswap-v3"),
    rule("ROUTE", `${wbnb}/${cake}@500`, `${wbnb}->${cake}`),
    rule("PROTECTED_ASSET", cake, wbnb),
    rule("ACTIVE_ASSET", wbnb, wbnb),
    rule(
      "INPUT_AMOUNT",
      "> 0 with at most 18 decimals",
      "0.01 (10000000000000000 base units)",
    ),
    rule("PER_TASK_CAP", "5000000000000000", "10000000000000000"),
    rule(
      "DAILY_CAP",
      "50000000000000000",
      "0 reserved in 24h + 10000000000000000",
    ),
    rule("SLIPPAGE", "100", "100 (policy default)"),
    rule("RECIPIENT", `SELF (${account})`, account),
    rule("LIFETIME", "1800", "1800"),
  ];
  const rules = base.map((entry) => overrides[entry.rule] ?? entry);
  return {
    outcome: rules.some((entry) => entry.outcome === "FAIL") ? "FAIL" : "PASS",
    rules,
    compilerVersion: "x",
    policyHash: "0x00",
  };
}

const overCap = decision({
  PER_TASK_CAP: rule(
    "PER_TASK_CAP",
    "5000000000000000",
    "10000000000000000",
    "PER_TASK_CAP_EXCEEDED",
  ),
});

function task(over: Record<string, unknown>): TaskDetail {
  return {
    taskId: "f8210c31-415c-4de9-aec0-a9243bc111c6",
    status: "DRAFT",
    goal: "swap 0.01 WBNB to CAKE",
    createdAt: "2026-10-28T07:02:34.923Z",
    updatedAt: "2026-10-28T07:02:35.505Z",
    intentHash: "0x01",
    planHash: null,
    plan: null,
    decision: null,
    decisionHash: null,
    simulation: null,
    mandate: null,
    execution: null,
    receipt: null,
    ...over,
  } as unknown as TaskDetail;
}

const rejected = task({ status: "REJECTED_POLICY", decision: overCap });

const succeeded = task({
  status: "SIGNED",
  decision: decision(),
  plan: {
    action: {
      kind: "SWAP",
      inputToken: wbnb,
      outputToken: cake,
      inputAmount: "5000000000000000",
    },
  },
  simulation: {
    status: "PASSED",
    result: { action: { kind: "SWAP" }, outcomeUnit: "TOKEN" },
  },
  mandate: {
    status: "SUCCEEDED",
    createdAt: "2026-10-28T07:04:00.000Z",
    mandate: {
      inputToken: wbnb,
      maxInput: "5000000000000000",
      outputToken: cake,
      minOutput: "157627883482158231193000476781",
    },
  },
  execution: { status: "TERMINAL", updatedAt: "2026-10-28T07:04:34.000Z" },
  receipt: { status: "SUCCEEDED", terminalReasonCode: "ONCHAIN_SUCCEEDED" },
});

describe("policy rules in plain language", () => {
  it("states the per-task cap with token symbols and decimals", () => {
    const view = describeRules(rejected, tokens, []).find(
      (entry) => entry.rule === "PER_TASK_CAP",
    );
    expect(view && plain(view.sentence)).toBe(
      "This task would spend 0.01 WBNB. Your policy allows at most 0.005 WBNB per task.",
    );
    expect(view && plain(view.observed)).toBe("0.01 WBNB");
    expect(view?.rawObserved).toBe("10000000000000000");
  });

  it("reports slippage as a percentage and the window in minutes", () => {
    expect(percent(100n)).toBe("1%");
    expect(percent(150n)).toBe("1.5%");
    expect(percent(25n)).toBe("0.25%");
    expect(windowText(1800n)).toBe("30 minutes");
    expect(windowText(90n)).toBe("1 min 30 s");
  });

  it("explains an inactive asset instead of a missing cap", () => {
    const inactive = task({
      status: "REJECTED_POLICY",
      decision: decision({
        ACTIVE_ASSET: rule("ACTIVE_ASSET", wbnb, cake, "ASSET_NOT_ACTIVE"),
        PROTECTED_ASSET: rule(
          "PROTECTED_ASSET",
          cake,
          cake,
          "PROTECTED_ASSET_SPEND",
        ),
        PER_TASK_CAP: rule(
          "PER_TASK_CAP",
          "no limit: asset not active",
          "10000000000000000",
          "ASSET_NOT_ACTIVE",
        ),
      }),
    });
    const sentences = describeRules(inactive, tokens, []).map((entry) =>
      plain(entry.sentence),
    );
    expect(sentences).toContain(
      "CAKE is protected in your policy, so it can never be spent.",
    );
    expect(sentences).toContain(
      "CAKE is not active in your policy, so it has no per-task limit and cannot be spent.",
    );
    expect(suggestedGoal(inactive, tokens)).toBeNull();
  });

  it("suggests a goal inside the cap only when a cap is the sole failure", () => {
    expect(suggestedGoal(rejected, tokens)).toBe("Swap 0.005 WBNB to CAKE");
  });

  it("limits the suggestion by what the daily cap still allows", () => {
    const daily = task({
      status: "REJECTED_POLICY",
      decision: decision({
        PER_TASK_CAP: rule(
          "PER_TASK_CAP",
          "10000000000000000",
          "500000000000000000",
          "PER_TASK_CAP_EXCEEDED",
        ),
        DAILY_CAP: rule(
          "DAILY_CAP",
          "50000000000000000",
          "45000000000000000 reserved in 24h + 500000000000000000",
          "DAILY_CAP_EXCEEDED",
        ),
      }),
    });
    expect(suggestedGoal(daily, tokens)).toBe("Swap 0.005 WBNB to CAKE");
  });
});

const awaitingSimulation = task({
  status: "READY_TO_SIMULATE",
  decision: decision(),
  plan: {
    action: {
      kind: "SWAP",
      inputToken: wbnb,
      outputToken: cake,
      inputAmount: "1000000000000000",
    },
  },
});
const balanceRefusal = {
  taskId: awaitingSimulation.taskId,
  simulationId: null,
  code: "INSUFFICIENT_BALANCE",
  detail: "holds 400000000000000; the plan spends 1000000000000000",
};

describe("simulation preflight refusals", () => {
  it("blocks the verdict with token-formatted account holdings and spend", () => {
    const verdict = deriveVerdict(
      awaitingSimulation,
      tokens,
      [],
      balanceRefusal,
    );
    expect(verdict.kind).toBe("simulation-blocked");
    expect(verdict.standing).toMatchObject({
      label: "Blocked",
      tone: "fail",
      live: false,
    });
    expect(plain(verdict.headline)).toBe("Not enough WBNB to run this.");
    expect(verdict.detail).toBe(
      "Your account holds 0.0004 WBNB. This task spends 0.001 WBNB. Nothing was signed.",
    );
  });

  it.each([
    "QUOTE_UNAVAILABLE",
    "SESSION_EXPIRES_FIRST",
    "MINIMUM_OUTPUT_ZERO",
  ] as const)(
    "uses the published reason copy for %s, not raw refusal detail",
    (code) => {
      const verdict = deriveVerdict(awaitingSimulation, tokens, [], {
        ...balanceRefusal,
        code,
        detail: "raw protocol detail",
      });
      expect(verdict.kind).toBe("simulation-blocked");
      expect(verdict.detail).toBe(REASON_MESSAGES[code]);
      expect(verdict.reasons[0]?.code).toBe(code);
      expect(verdict.note).toBe("Nothing was signed.");
    },
  );

  it("keeps the running verdict when no refusal was received", () => {
    const verdict = deriveVerdict(awaitingSimulation, tokens, []);
    expect(verdict.kind).toBe("preparing");
    expect(plain(verdict.headline)).toBe(
      "Policy passed. Running the exact simulation.",
    );
  });

  it("does not carry a refusal into a different task", () => {
    expect(
      deriveVerdict(
        { ...awaitingSimulation, taskId: "another-task" },
        tokens,
        [],
        balanceRefusal,
      ).kind,
    ).toBe("preparing");
  });

  it("clears the blocked verdict and rail after a later passing simulation", () => {
    const passed = task({
      ...awaitingSimulation,
      status: "SIMULATED",
      simulation: { simulationId: "new-pass", status: "PASSED", result: {} },
    });
    expect(deriveVerdict(passed, tokens, [], balanceRefusal).kind).toBe(
      "preparing",
    );
    expect(lifecycle(passed, balanceRefusal)[3]).toMatchObject({
      state: "done",
      detail: "Passed",
    });
  });

  it("marks Simulation blocked, without a running lifecycle step", () => {
    const steps = lifecycle(awaitingSimulation, balanceRefusal);
    expect(steps[3]).toMatchObject({
      state: "failed",
      detail: "Blocked",
      live: false,
    });
    expect(steps.some((step) => step.live)).toBe(false);
    expect(steps[4]?.detail).toBe("Not reached");
  });

  it("does not expose base units when token metadata is unavailable", () => {
    const verdict = deriveVerdict(awaitingSimulation, [], [], balanceRefusal);
    expect(verdict.kind).toBe("simulation-blocked");
    expect(verdict.detail).toBe(REASON_MESSAGES.INSUFFICIENT_BALANCE);
  });
});

describe("verdict", () => {
  it("blocks a rejected task with the failing rule and says nothing moved", () => {
    const verdict = deriveVerdict(rejected, tokens, []);
    expect(verdict.kind).toBe("blocked");
    expect(plain(verdict.headline)).toBe("Blocked by your policy.");
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]?.code).toBe("PER_TASK_CAP_EXCEEDED");
    expect(verdict.note).toBe("Nothing was signed. No funds moved.");
  });

  it("states a succeeded swap with compact amounts and the elapsed time", () => {
    const verdict = deriveVerdict(succeeded, tokens, []);
    expect(verdict.kind).toBe("succeeded");
    expect(plain(verdict.headline)).toBe(
      "Swapped 0.005 WBNB for at least 157.62B CAKE.",
    );
    expect(verdict.detail).toBe("Verified onchain. Authority ended.");
    expect(verdict.elapsedSeconds).toBe(34);
    const scaled = verdict.headline.find(
      (part) => typeof part !== "string" && part.text === "157.62B CAKE",
    );
    expect(scaled).toMatchObject({
      title: expect.stringContaining("157627883482158231193000476781"),
    });
  });

  it("never draws pending work as success", () => {
    const signed = task({
      status: "SIGNED",
      decision: decision(),
      mandate: { status: "SIGNED", createdAt: "2026-10-28T07:04:00.000Z" },
    });
    expect(deriveVerdict(signed, tokens, []).kind).toBe("signed");
    expect(deriveVerdict(signed, tokens, []).standing.tone).toBe("pending");
    expect(deriveVerdict(task({}), tokens, []).kind).toBe("draft");
  });

  it("keeps the reason code with a failed execution", () => {
    const failed = task({
      status: "SIGNED",
      mandate: { status: "FAILED", createdAt: "2026-10-28T07:04:00.000Z" },
      receipt: { status: "FAILED", terminalReasonCode: "ONCHAIN_FAILED" },
    });
    const verdict = deriveVerdict(failed, tokens, []);
    expect(verdict.kind).toBe("failed");
    expect(verdict.reasons[0]?.code).toBe("ONCHAIN_FAILED");
  });
});

describe("lifecycle", () => {
  it("fails Policy and marks every later step not reached", () => {
    const steps = lifecycle(rejected);
    expect(steps.map((step) => step.state)).toEqual([
      "done",
      "failed",
      "todo",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
    expect(steps.slice(2).every((step) => step.detail === "Not reached")).toBe(
      true,
    );
    expect(steps.some((step) => step.live)).toBe(false);
  });

  it("marks a succeeded task done end to end", () => {
    expect(lifecycle(succeeded).every((step) => step.state === "done")).toBe(
      true,
    );
    expect(lifecycle(succeeded)[3]?.detail).toBe("Used");
  });

  it("points at the signature when the task awaits the owner", () => {
    const ready = task({
      status: "READY_TO_SIGN",
      decision: decision(),
      plan: { action: { kind: "SWAP" } },
      simulation: { status: "PASSED", result: {} },
    });
    const current = lifecycle(ready).find((step) => step.state === "current");
    expect(current?.key).toBe("signature");
    expect(current?.detail).toBe("Your turn");
    expect(current?.live).toBe(false);
  });
});

describe("standing", () => {
  it("humanizes ledger statuses with distinct tones", () => {
    const of = (
      status: string,
      mandateStatus: string | null = null,
      executionStatus: string | null = null,
    ) => standing({ status, mandateStatus, executionStatus });
    expect(of("SIGNED", "SUCCEEDED").label).toBe("Succeeded");
    expect(of("REJECTED_POLICY").label).toBe("Blocked by policy");
    expect(of("REJECTED_POLICY").tone).toBe("fail");
    expect(of("DRAFT").label).toBe("Draft");
    expect(of("SIGNED", "EXECUTING").label).toBe("Executing");
    expect(of("SIGNED", "FAILED").tone).toBe("fail");
  });

  it("names why a task stopped", () => {
    expect(stoppedAt(rejected)).toBe("stopped at policy");
    expect(stoppedAt(succeeded)).toBeNull();
  });
});

describe("a draft that never compiled", () => {
  it("has no current step and says what did not run", () => {
    const steps = lifecycle(task({}));
    expect(steps.some((step) => step.state === "current")).toBe(false);
    expect(steps[1]?.detail).toBe("Not run");
    expect(steps[2]?.detail).toBe("Not reached");
  });
});

describe("moving funds to your own wallet", () => {
  const owner = "0x1111111111111111111111111111111111111111";
  const stranger = "0x2222222222222222222222222222222222222222";
  const refused = (observed: string, over: Record<string, unknown> = {}) =>
    task({
      status: "REJECTED_POLICY",
      goal: "Send 0.01 WBNB to my wallet",
      decision: decision({
        RECIPIENT: rule(
          "RECIPIENT",
          `SELF (${account})`,
          observed,
          "RECIPIENT_NOT_ALLOWED",
        ),
      }),
      ...over,
    });

  it("points at Funds when the refused recipient is the owner wallet", () => {
    const hint = selfWithdrawHint(
      refused(`planner ${owner}; intent ${account}`),
      owner,
      tokens,
    );
    expect(hint).toEqual({ symbol: "WBNB", amount: "0.01" });
  });

  it("compares addresses without caring about case", () => {
    expect(
      selfWithdrawHint(
        refused(
          `planner ${owner.toUpperCase().replace("0X", "0x")}; intent ${account}`,
        ),
        owner,
        tokens,
      ),
    ).not.toBeNull();
  });

  it("stays silent for any other recipient", () => {
    expect(
      selfWithdrawHint(
        refused(`planner ${stranger}; intent ${account}`),
        owner,
        tokens,
      ),
    ).toBeNull();
  });

  it("stays silent when any named recipient is foreign, whichever side names it", () => {
    for (const observed of [
      `planner ${owner}; intent ${stranger}`,
      `planner ${stranger}; intent ${owner}`,
      `planner ${owner}; intent ${owner}; also ${stranger}`,
    ]) {
      expect(selfWithdrawHint(refused(observed), owner, tokens)).toBeNull();
    }
  });

  it("lets a foreign plan recipient override a rule that names the owner", () => {
    const conflicting = refused(`planner ${owner}; intent ${account}`, {
      plan: {
        account,
        action: {
          kind: "SWAP",
          inputToken: wbnb,
          outputToken: cake,
          inputAmount: "5000000000000000",
          recipient: stranger,
        },
      },
    });
    expect(selfWithdrawHint(conflicting, owner, tokens)).toBeNull();
  });

  it("treats the smart account as the allowed context beside the owner", () => {
    expect(
      selfWithdrawHint(
        refused(`planner ${owner}; intent ${account}`),
        owner,
        tokens,
      ),
    ).not.toBeNull();
  });

  it("stays silent when the recipient rule did not fail, or failed for another reason", () => {
    expect(selfWithdrawHint(rejected, owner, tokens)).toBeNull();
    expect(selfWithdrawHint(refused(owner), null, tokens)).toBeNull();
    const other = task({
      status: "REJECTED_POLICY",
      goal: "send it to my wallet",
      decision: overCap,
    });
    expect(selfWithdrawHint(other, owner, tokens)).toBeNull();
  });

  it("reads the recipient from the plan when the rule shows none", () => {
    const withPlan = refused("another address", {
      plan: {
        action: {
          kind: "SWAP",
          inputToken: wbnb,
          outputToken: cake,
          inputAmount: "5000000000000000",
          recipient: owner,
        },
      },
    });
    expect(selfWithdrawHint(withPlan, owner, tokens)).toEqual({
      symbol: "WBNB",
      amount: "0.005",
    });
  });

  it("falls back to the goal text only to show a generic hint", () => {
    const generic = refused("another address", {
      goal: "send my WBNB back to my wallet",
      decision: decision({
        RECIPIENT: rule(
          "RECIPIENT",
          `SELF (${account})`,
          "another address",
          "RECIPIENT_NOT_ALLOWED",
        ),
        INPUT_AMOUNT: rule(
          "INPUT_AMOUNT",
          "> 0 with at most 18 decimals",
          "unparsed",
        ),
      }),
    });
    expect(selfWithdrawHint(generic, owner, tokens)).toEqual({
      symbol: null,
      amount: null,
    });
    expect(
      selfWithdrawHint(
        { ...generic, goal: "send my WBNB to a friend" },
        owner,
        tokens,
      ),
    ).toBeNull();
  });
});
