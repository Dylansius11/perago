import type { Address, WalletPolicy } from "@perago/sdk";
import { describe, expect, it } from "vitest";
import {
  allowanceReady,
  automaticStep,
  mandateStale,
  promptCount,
  restoreAmount,
  rollingCap,
} from "./journey";

const account: Address = "0x1111111111111111111111111111111111111111";
const wbnb: Address = "0x5555555555555555555555555555555555555555";
const cake: Address = "0x6666666666666666666666666666666666666666";

const policy = {
  schemaVersion: "1",
  account,
  chainId: "97",
  version: "1",
  protectedAssets: [cake],
  activeAssets: [
    { token: wbnb, maxInputPerTask: "100", rollingDailyCap: "200" },
  ],
  services: ["SWAP"],
  approvedAdapterIds: ["pancakeswap-v3"],
  maxSlippageBps: "100",
  allowedRecipients: "SELF",
  maxTaskLifetimeSeconds: "1800",
} as const satisfies WalletPolicy;

describe("executor allowance readiness", () => {
  it("requires a read allowance that covers the mandate input", () => {
    expect(allowanceReady(null, "100")).toBe(false);
    expect(allowanceReady(99n, "100")).toBe(false);
    expect(allowanceReady(100n, "100")).toBe(true);
    expect(allowanceReady(10_000n, "100")).toBe(true);
  });

  it("reads the active policy cap for a token without case, and nothing for others", () => {
    expect(
      rollingCap(policy, "0x5555555555555555555555555555555555555555"),
    ).toBe(200n);
    expect(rollingCap(policy, cake)).toBeNull();
  });

  it("restores exactly the policy cap, and refuses when the cap cannot cover the plan", () => {
    expect(restoreAmount(200n, "100")).toBe(200n);
    expect(restoreAmount(100n, "100")).toBe(100n);
    expect(restoreAmount(99n, "100")).toBeNull();
    expect(restoreAmount(null, "100")).toBeNull();
  });
});

describe("prepared mandate freshness", () => {
  const simulation = { status: "PASSED", simulationHash: "0xaa" };
  const fresh = {
    preparedQuoteExpiresAt: "2000000120",
    preparedSimulationHash: "0xaa",
    simulation,
    nowSeconds: 2_000_000_000,
  };

  it("accepts a prepared mandate bound to the current passing simulation", () => {
    expect(mandateStale(fresh)).toBe(false);
  });

  it("refuses an expired quote, including the exact expiry second", () => {
    expect(mandateStale({ ...fresh, nowSeconds: 2_000_000_119 })).toBe(false);
    expect(mandateStale({ ...fresh, nowSeconds: 2_000_000_120 })).toBe(true);
    expect(mandateStale({ ...fresh, nowSeconds: 2_000_000_121 })).toBe(true);
  });

  it("refuses a simulation that moved, failed, or is missing", () => {
    expect(
      mandateStale({
        ...fresh,
        simulation: { status: "PASSED", simulationHash: "0xbb" },
      }),
    ).toBe(true);
    expect(
      mandateStale({
        ...fresh,
        simulation: { ...simulation, status: "STALE" },
      }),
    ).toBe(true);
    expect(mandateStale({ ...fresh, simulation: null })).toBe(true);
  });

  it("refuses when nothing was prepared", () => {
    expect(
      mandateStale({
        preparedQuoteExpiresAt: null,
        preparedSimulationHash: null,
        simulation,
        nowSeconds: 2_000_000_000,
      }),
    ).toBe(true);
  });
});

describe("wallet prompt count", () => {
  it("needs one prompt for the mandate alone", () => {
    expect(
      promptCount({ needsRestore: false, sponsorshipEnabled: true }),
    ).toEqual({
      restore: 0,
      mandate: 1,
      total: 1,
    });
    expect(
      promptCount({ needsRestore: false, sponsorshipEnabled: false }),
    ).toEqual({ restore: 0, mandate: 1, total: 1 });
  });

  it("adds one sponsored restore prompt, or two without sponsorship", () => {
    expect(
      promptCount({ needsRestore: true, sponsorshipEnabled: true }),
    ).toEqual({
      restore: 1,
      mandate: 1,
      total: 2,
    });
    expect(
      promptCount({ needsRestore: true, sponsorshipEnabled: false }),
    ).toEqual({
      restore: 2,
      mandate: 1,
      total: 3,
    });
  });
});

describe("one-pass automation", () => {
  const base = {
    taskId: "task-1",
    planPresent: true,
    decisionPassed: true,
    simulation: null,
    mandateSigned: false,
    prepared: false,
    attempted: new Set<string>(),
  } as const;

  it("simulates once for a compiled, accepted task with no simulation", () => {
    expect(automaticStep(base)).toEqual({
      step: "simulate",
      key: "task-1:simulate:none",
    });
  });

  it("never repeats an attempted simulation, and never retries a reverted one", () => {
    expect(
      automaticStep({ ...base, attempted: new Set(["task-1:simulate:none"]) }),
    ).toBeNull();
    expect(
      automaticStep({
        ...base,
        simulation: { simulationId: "sim-1", status: "REVERTED" },
      }),
    ).toBeNull();
  });

  it("re-simulates each stale simulation once, even after the first automatic run", () => {
    const stale = {
      ...base,
      simulation: { simulationId: "sim-1", status: "STALE" },
    } as const;
    expect(
      automaticStep({
        ...stale,
        attempted: new Set(["task-1:simulate:none", "task-1:prepare:sim-0"]),
      }),
    ).toEqual({ step: "simulate", key: "task-1:simulate:sim-1" });
    expect(
      automaticStep({
        ...stale,
        attempted: new Set(["task-1:simulate:sim-1"]),
      }),
    ).toBeNull();
    expect(
      automaticStep({
        ...base,
        simulation: { simulationId: "sim-1", status: "PASSED" },
      }),
    ).toEqual({ step: "prepare", key: "task-1:prepare:sim-1" });
  });

  it("stops re-simulating after three automatic runs so a moving quote cannot loop", () => {
    expect(
      automaticStep({
        ...base,
        simulation: { simulationId: "sim-3", status: "STALE" },
        attempted: new Set([
          "task-1:simulate:none",
          "task-1:simulate:sim-1",
          "task-1:simulate:sim-2",
        ]),
      }),
    ).toBeNull();
  });

  it("stops once a mandate is prepared or signed, and waits for a passing decision", () => {
    expect(
      automaticStep({
        ...base,
        simulation: { simulationId: "sim-1", status: "PASSED" },
        prepared: true,
      }),
    ).toBeNull();
    expect(
      automaticStep({
        ...base,
        simulation: { simulationId: "sim-1", status: "PASSED" },
        mandateSigned: true,
      }),
    ).toBeNull();
    expect(automaticStep({ ...base, decisionPassed: false })).toBeNull();
    expect(automaticStep({ ...base, planPresent: false })).toBeNull();
  });

  it("does not re-prepare the same simulation after a failed attempt", () => {
    expect(
      automaticStep({
        ...base,
        simulation: { simulationId: "sim-1", status: "PASSED" },
        attempted: new Set(["task-1:prepare:sim-1"]),
      }),
    ).toBeNull();
  });
});
