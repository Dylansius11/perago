import {
  type Address,
  type Hash,
  POLICY_RULES,
  type TaskIntent,
  type WalletPolicy,
} from "@perago/sdk";
import { describe, expect, it } from "vitest";

import { loadBscTestnetCatalog } from "./catalog.js";
import {
  type CompileInput,
  type CompileOutcome,
  compileCandidate,
} from "./compile.js";

const catalog = loadBscTestnetCatalog();
const token = (symbol: string): Address => {
  const entry = catalog.tokens.find((candidate) => candidate.symbol === symbol);
  if (!entry) throw new Error(`catalog has no ${symbol}`);
  return entry.address;
};
const wbnb = token("WBNB");
const cake = token("Cake");
const account = "0x17fcce2b0c0cc44c4f88c6c09b6364a766ee7944";
const stranger: Address = "0x000000000000000000000000000000000000dead";
const hash = `0x${"ab".repeat(32)}` as Hash;

const policy: WalletPolicy = {
  schemaVersion: "1",
  account,
  chainId: "97",
  version: "1",
  protectedAssets: [cake],
  activeAssets: [
    {
      token: wbnb,
      maxInputPerTask: "100000000000000000",
      rollingDailyCap: "300000000000000000",
    },
  ],
  services: ["SWAP"],
  approvedAdapterIds: ["pancakeswap-v3"],
  maxSlippageBps: "100",
  allowedRecipients: "SELF",
  maxTaskLifetimeSeconds: "3600",
};

const intent: TaskIntent = {
  schemaVersion: "1",
  account,
  chainId: "97",
  recipient: account,
  goal: "Swap 0.05 WBNB for CAKE",
  requestedExpirySeconds: "1800",
  salt: hash,
};

const swap = {
  kind: "SWAP",
  adapterId: "pancakeswap-v3",
  inputSymbol: "WBNB",
  inputAmount: "0.05",
  outputSymbol: "Cake",
  maxSlippageBps: 50,
  recipient: null,
};

function compile(
  action: Record<string, unknown>,
  overrides: Partial<CompileInput> = {},
): CompileOutcome {
  return compileCandidate({
    catalog,
    candidate: { action },
    dailySpent: new Map(),
    intent,
    intentHash: hash,
    policy,
    policyHash: hash,
    ...overrides,
  });
}

function failures(outcome: CompileOutcome) {
  if (outcome.status !== "REJECTED_POLICY") {
    throw new Error(`expected a policy rejection, got ${outcome.status}`);
  }
  return outcome.decision.rules
    .filter((rule) => rule.outcome === "FAIL")
    .map((rule) => [rule.rule, rule.reasonCode]);
}

describe("deterministic compiler", () => {
  it("builds the plan from catalog and policy values, not model values", () => {
    const outcome = compile(swap);
    expect(outcome.status).toBe("READY_TO_SIMULATE");
    if (outcome.status !== "READY_TO_SIMULATE") return;
    expect(outcome.plan.action).toEqual({
      kind: "SWAP",
      adapterId: "pancakeswap-v3",
      inputToken: wbnb,
      inputAmount: "50000000000000000",
      outputToken: cake,
      poolFee: "500",
      maxSlippageBps: "50",
      recipient: account,
    });
    expect(outcome.plan.lifetimeSeconds).toBe("1800");
    expect(outcome.decision.rules.map((rule) => rule.rule)).toEqual([
      ...POLICY_RULES,
    ]);
    expect(outcome.decision.outcome).toBe("PASS");
  });

  it("uses the policy ceiling only when the owner stated no slippage", () => {
    const outcome = compile({ ...swap, maxSlippageBps: null });
    expect(outcome.status).toBe("READY_TO_SIMULATE");
    if (outcome.status !== "READY_TO_SIMULATE") return;
    expect(outcome.plan.action.maxSlippageBps).toBe("100");
  });

  it.each([
    [
      "protected asset",
      { ...swap, inputSymbol: "Cake", outputSymbol: "WBNB" },
      {},
      [
        ["PROTECTED_ASSET", "PROTECTED_ASSET_SPEND"],
        ["ACTIVE_ASSET", "ASSET_NOT_ACTIVE"],
        ["PER_TASK_CAP", "ASSET_NOT_ACTIVE"],
        ["DAILY_CAP", "ASSET_NOT_ACTIVE"],
      ],
    ],
    [
      "service and protocol",
      {
        kind: "STAKE",
        adapterId: "cake-pool",
        inputSymbol: "WBNB",
        inputAmount: "0.05",
        maxSlippageBps: null,
        recipient: null,
      },
      {},
      [
        ["SERVICE", "SERVICE_NOT_ALLOWED"],
        ["PROTOCOL", "PROTOCOL_NOT_APPROVED"],
        ["ROUTE", "ROUTE_UNSUPPORTED"],
      ],
    ],
    [
      "per-task cap by one base unit",
      { ...swap, inputAmount: "0.100000000000000001" },
      {},
      [["PER_TASK_CAP", "PER_TASK_CAP_EXCEEDED"]],
    ],
    [
      "rolling daily cap",
      swap,
      { dailySpent: new Map([[wbnb, 250_000_000_000_000_001n]]) },
      [["DAILY_CAP", "DAILY_CAP_EXCEEDED"]],
    ],
    [
      "slippage",
      { ...swap, maxSlippageBps: 101 },
      {},
      [["SLIPPAGE", "SLIPPAGE_EXCEEDED"]],
    ],
    [
      "planner recipient",
      { ...swap, recipient: stranger },
      {},
      [["RECIPIENT", "RECIPIENT_NOT_ALLOWED"]],
    ],
    [
      "intent recipient",
      swap,
      { intent: { ...intent, recipient: stranger } },
      [["RECIPIENT", "RECIPIENT_NOT_ALLOWED"]],
    ],
    [
      "expiry",
      swap,
      { intent: { ...intent, requestedExpirySeconds: "3601" } },
      [["LIFETIME", "LIFETIME_EXCEEDED"]],
    ],
    [
      "precision instead of rounding",
      { ...swap, inputAmount: "0.0000000000000000001" },
      {},
      [
        ["INPUT_AMOUNT", "AMOUNT_INVALID"],
        ["PER_TASK_CAP", "AMOUNT_INVALID"],
        ["DAILY_CAP", "AMOUNT_INVALID"],
      ],
    ],
    [
      "same-token swap",
      { ...swap, outputSymbol: "WBNB" },
      {},
      [["ROUTE", "ROUTE_UNSUPPORTED"]],
    ],
  ])(
    "rejects a broader %s without clamping",
    (_name, action, overrides, expected) => {
      expect(failures(compile(action, overrides))).toEqual(expected);
    },
  );

  it("accepts spend exactly at the per-task and daily caps", () => {
    expect(
      compile(
        { ...swap, inputAmount: "0.1" },
        { dailySpent: new Map([[wbnb, 200_000_000_000_000_000n]]) },
      ).status,
    ).toBe("READY_TO_SIMULATE");
  });

  it.each([
    ["unknown action", { kind: "TRANSFER", inputSymbol: "WBNB" }],
    ["model calldata", { ...swap, calldata: "0xa9059cbb" }],
    ["model address field", { ...swap, tokenIn: wbnb }],
    ["token outside the catalog", { ...swap, outputSymbol: "U" }],
    ["adapter of the wrong kind", { ...swap, adapterId: "cake-pool" }],
    ["unknown adapter", { ...swap, adapterId: "pancakeswap-v2" }],
    ["numeric amount", { ...swap, inputAmount: 0.05 }],
    ["exponent amount", { ...swap, inputAmount: "5e-2" }],
  ])("fails %s as invalid planner output", (_name, action) => {
    expect(compile(action)).toEqual({
      status: "PLANNING_FAILED",
      reasonCode: "PLANNER_OUTPUT_INVALID",
    });
  });

  it("fails non-object planner output as invalid", () => {
    expect(
      compileCandidate({
        catalog,
        candidate: null,
        dailySpent: new Map(),
        intent,
        intentHash: hash,
        policy,
        policyHash: hash,
      }).status,
    ).toBe("PLANNING_FAILED");
  });

  it("returns a clarification without compiling anything", () => {
    expect(
      compile({ kind: "CLARIFY", question: "How much WBNB should I swap?" }),
    ).toEqual({
      status: "NEEDS_CLARIFICATION",
      reasonCode: "INTENT_NEEDS_CLARIFICATION",
      question: "How much WBNB should I swap?",
    });
  });
});

describe("closed stake branch", () => {
  const stakePolicy: WalletPolicy = {
    ...policy,
    protectedAssets: [],
    activeAssets: [
      ...policy.activeAssets,
      {
        token: cake,
        maxInputPerTask: "5000000000000000000",
        rollingDailyCap: "20000000000000000000",
      },
    ],
    services: ["SWAP", "STAKE"],
    approvedAdapterIds: ["pancakeswap-v3", "cake-pool"],
  };
  const stake = {
    kind: "STAKE",
    adapterId: "cake-pool",
    inputSymbol: "Cake",
    inputAmount: "1",
    maxSlippageBps: null,
    recipient: null,
  };
  const compileStake = (
    action: Record<string, unknown>,
    overrides: Partial<CompileInput> = {},
  ) => compile(action, { policy: stakePolicy, ...overrides });

  it("stakes only into the catalog's one pinned pool, for the policy account", () => {
    const outcome = compileStake(stake);
    expect(outcome.status).toBe("READY_TO_SIMULATE");
    if (outcome.status !== "READY_TO_SIMULATE") return;
    expect(outcome.plan.action).toEqual({
      kind: "STAKE",
      adapterId: "cake-pool",
      inputToken: cake,
      inputAmount: "1000000000000000000",
      maxSlippageBps: "100",
      recipient: account,
    });
  });

  it.each([
    ["the swap adapter as the stake target", { adapterId: "pancakeswap-v3" }],
    ["an adapter outside the catalog", { adapterId: "cake-pool-locked" }],
    ["a model-chosen pool", { poolId: `0x${"11".repeat(32)}` }],
    ["a model-chosen lock duration", { lockDuration: "31536000" }],
    ["a model-chosen output token", { outputSymbol: "WBNB" }],
    ["a model-chosen minimum position", { minPositionOut: "1" }],
  ])("fails %s as invalid planner output", (_name, change) => {
    expect(compileStake({ ...stake, ...change })).toEqual({
      status: "PLANNING_FAILED",
      reasonCode: "PLANNER_OUTPUT_INVALID",
    });
  });

  it.each([
    [
      "an asset other than the pool's",
      { inputSymbol: "WBNB", inputAmount: "0.05" },
      {},
      [["ROUTE", "ROUTE_UNSUPPORTED"]],
    ],
    [
      "a policy without the stake service",
      {},
      { policy: { ...stakePolicy, services: ["SWAP" as const] } },
      [["SERVICE", "SERVICE_NOT_ALLOWED"]],
    ],
    [
      "a policy that does not approve the pool",
      {},
      {
        policy: { ...stakePolicy, approvedAdapterIds: ["pancakeswap-v3"] },
      },
      [["PROTOCOL", "PROTOCOL_NOT_APPROVED"]],
    ],
    [
      "a stake above the per-task cap",
      { inputAmount: "5.000000000000000001" },
      {},
      [["PER_TASK_CAP", "PER_TASK_CAP_EXCEEDED"]],
    ],
    [
      "a stake for another recipient",
      { recipient: stranger },
      {},
      [["RECIPIENT", "RECIPIENT_NOT_ALLOWED"]],
    ],
  ])("rejects %s in policy", (_name, change, overrides, expected) => {
    expect(failures(compileStake({ ...stake, ...change }, overrides))).toEqual(
      expected,
    );
  });
});
