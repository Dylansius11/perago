import type { WalletPolicy } from "@perago/sdk";
import { describe, expect, it } from "vitest";
import {
  hasErrors,
  initialEditorState,
  minutesFromSeconds,
  parseAmountField,
  secondsFromMinutes,
  validateEditor,
} from "./editor-model";

const wbnb = "0xae13d989dac2f0debff460ac112a837c89baa7cd" as const;
const cake = "0xfa60d973f7642b748046464e165a65b7323b0dee" as const;
const catalog = {
  tokens: [
    { symbol: "WBNB", address: wbnb, decimals: 18 },
    { symbol: "Cake", address: cake, decimals: 18 },
  ],
};
const policy: WalletPolicy = {
  schemaVersion: "1",
  account: "0x17fcce2b0c0cc44c4f88c6c09b6364a766ee7944",
  chainId: "97",
  version: "10",
  protectedAssets: [cake],
  activeAssets: [
    {
      token: wbnb,
      maxInputPerTask: "5000000000000000",
      rollingDailyCap: "50000000000000000",
    },
  ],
  services: ["SWAP", "STAKE"],
  approvedAdapterIds: ["pancakeswap-v3", "cake-pool"],
  maxSlippageBps: "100",
  allowedRecipients: "SELF",
  maxTaskLifetimeSeconds: "1800",
};

describe("policy editor model", () => {
  it("starts from the policy in force", () => {
    expect(initialEditorState(policy, catalog)).toEqual({
      assets: {
        WBNB: { mode: "active", max: "0.005", daily: "0.05" },
        Cake: { mode: "protected", max: "0.01", daily: "0.05" },
      },
      slippageBps: "100",
      lifetimeMinutes: "30",
    });
  });

  it("starts a first policy with WBNB active and everything else protected", () => {
    const state = initialEditorState(null, catalog);
    expect(state.assets.WBNB?.mode).toBe("active");
    expect(state.assets.Cake?.mode).toBe("protected");
    expect(hasErrors(validateEditor(state, catalog))).toBe(false);
  });

  it("accepts the policy in force without errors", () => {
    expect(
      hasErrors(validateEditor(initialEditorState(policy, catalog), catalog)),
    ).toBe(false);
  });

  it("explains each invalid amount", () => {
    expect(parseAmountField("", 18)).toEqual({ error: "Enter an amount." });
    expect(parseAmountField("1e3", 18)).toEqual({
      error: "Use digits and one decimal point only.",
    });
    expect(parseAmountField("0.0000000000000000001", 18)).toEqual({
      error: "At most 18 decimal places.",
    });
    expect(parseAmountField("0", 18)).toEqual({
      error: "Must be more than zero.",
    });
    expect(parseAmountField("0.005", 18)).toEqual({
      value: 5_000_000_000_000_000n,
    });
  });

  it("flags a per-task limit above the 24-hour cap on the per-task field", () => {
    const state = initialEditorState(policy, catalog);
    state.assets.WBNB = { mode: "active", max: "1", daily: "0.5" };
    expect(validateEditor(state, catalog).assets.WBNB).toEqual({
      max: "Cannot be more than the 24-hour cap.",
    });
  });

  it("requires at least one active token", () => {
    const state = initialEditorState(policy, catalog);
    state.assets.WBNB = { mode: "protected", max: "1", daily: "2" };
    expect(validateEditor(state, catalog).general).toMatch(
      /at least one token/u,
    );
  });

  it("checks slippage and lifetime ranges", () => {
    const state = initialEditorState(policy, catalog);
    expect(
      validateEditor({ ...state, slippageBps: "10001" }, catalog).slippage,
    ).toMatch(/10,000/u);
    expect(
      validateEditor({ ...state, slippageBps: "1.5" }, catalog).slippage,
    ).toBeDefined();
    expect(
      validateEditor({ ...state, lifetimeMinutes: "0" }, catalog).lifetime,
    ).toBeDefined();
    expect(
      validateEditor({ ...state, lifetimeMinutes: "abc" }, catalog).lifetime,
    ).toBeDefined();
  });

  it("converts between minutes and whole seconds", () => {
    expect(minutesFromSeconds("1800")).toBe("30");
    expect(minutesFromSeconds("90")).toBe("1.5");
    expect(secondsFromMinutes("30")).toBe(1800);
    expect(secondsFromMinutes("7.5")).toBe(450);
    expect(secondsFromMinutes("0.33")).toBeNull();
    expect(secondsFromMinutes("-1")).toBeNull();
  });
});
