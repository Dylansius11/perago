import type { PublicConfig, WalletPolicy } from "@perago/sdk";
import { describe, expect, it } from "vitest";
import { describePolicy, joinList, percentOfBps } from "./describe";
import { diffPolicies, modeOf } from "./diff";

const wbnb = "0xae13d989dac2f0debff460ac112a837c89baa7cd" as const;
const cake = "0xfa60d973f7642b748046464e165a65b7323b0dee" as const;
const catalog: Pick<PublicConfig, "tokens" | "adapters"> = {
  tokens: [
    { symbol: "WBNB", address: wbnb, decimals: 18 },
    { symbol: "Cake", address: cake, decimals: 18 },
  ],
  adapters: [
    {
      id: "pancakeswap-v3",
      kind: "SWAP",
      protocol: "PancakeSwap V3",
      adapter: "0xb9faeb0bb29401a1308e0c1287913d94b18ec635",
    },
    {
      id: "cake-pool",
      kind: "STAKE",
      protocol: "PancakeSwap CAKE Pool",
      adapter: "0xb68d52c76036744c5f7676d530295b3e8dd9d8ae",
    },
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

describe("plain-language policy reading", () => {
  it("states services, adapters, protection, limits, slippage and lifetime from the document", () => {
    const facts = describePolicy(policy, catalog);
    expect(facts.services).toBe("swap and stake");
    expect(facts.adapters.map((adapter) => adapter.label)).toEqual([
      "PancakeSwap V3",
      "PancakeSwap CAKE Pool",
    ]);
    expect(facts.protectedTokens).toEqual(["Cake"]);
    expect(facts.offTokens).toEqual([]);
    expect(facts.limits).toEqual([
      {
        symbol: "WBNB",
        address: wbnb,
        perTask: { shown: "0.005", exact: "0.005" },
        daily: { shown: "0.05", exact: "0.05" },
      },
    ]);
    expect(facts.slippagePercent).toBe("1");
    expect(facts.lifetimeSeconds).toBe(1800);
  });

  it("names a token the catalog does not know by address and marks an unknown adapter", () => {
    const facts = describePolicy(
      {
        ...policy,
        approvedAdapterIds: ["mystery"],
        protectedAssets: ["0x1111111111111111111111111111111111111111"],
      },
      catalog,
    );
    expect(facts.adapters).toEqual([
      { id: "mystery", label: "mystery", kind: null, known: false },
    ]);
    expect(facts.protectedTokens).toEqual(["0x1111…1111"]);
    expect(facts.offTokens).toEqual(["Cake"]);
  });

  it("scales a huge limit for readers and keeps every digit", () => {
    const facts = describePolicy(
      {
        ...policy,
        activeAssets: [
          {
            token: wbnb,
            maxInputPerTask: "671532465496335924000000000000",
            rollingDailyCap: "1",
          },
        ],
      },
      catalog,
    );
    expect(facts.limits[0]?.perTask.shown).toBe("671.53B");
    expect(facts.limits[0]?.perTask.exact).toBe("671,532,465,496.335924");
  });

  it("converts basis points to a percentage without floating point", () => {
    expect(percentOfBps("100")).toBe("1");
    expect(percentOfBps("50")).toBe("0.5");
    expect(percentOfBps("25")).toBe("0.25");
    expect(percentOfBps("10000")).toBe("100");
    expect(percentOfBps("0")).toBe("0");
  });

  it("joins lists in plain English", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b"])).toBe("a and b");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("policy diff", () => {
  it("is empty for an unchanged policy", () => {
    expect(diffPolicies(policy, { ...policy, version: "11" }, catalog)).toEqual(
      [],
    );
  });

  it("lists each changed limit with its old and new value", () => {
    const next: WalletPolicy = {
      ...policy,
      version: "11",
      activeAssets: [
        {
          token: wbnb,
          maxInputPerTask: "10000000000000000",
          rollingDailyCap: "50000000000000000",
        },
      ],
      maxSlippageBps: "50",
      maxTaskLifetimeSeconds: "900",
    };
    expect(diffPolicies(policy, next, catalog)).toEqual([
      { label: "Per task WBNB", from: "0.005", to: "0.01" },
      { label: "Slippage", from: "1%", to: "0.5%" },
      { label: "Task lifetime", from: "30 min", to: "15 min" },
    ]);
  });

  it("reports a token that changes role", () => {
    const next: WalletPolicy = {
      ...policy,
      protectedAssets: [],
      activeAssets: [
        ...policy.activeAssets,
        { token: cake, maxInputPerTask: "1", rollingDailyCap: "2" },
      ],
    };
    const lines = diffPolicies(policy, next, catalog);
    expect(lines[0]).toEqual({
      label: "Cake",
      from: "protected",
      to: "active",
    });
    expect(lines).toContainEqual({
      label: "Per task Cake",
      from: "not spendable",
      to: "0.000000000000000001",
    });
    expect(modeOf(next, cake)).toBe("active");
    expect(modeOf({ ...policy, protectedAssets: [] }, cake)).toBe("off");
  });

  it("treats a first policy as every value changing from not set", () => {
    const lines = diffPolicies(null, policy, catalog);
    expect(lines).toContainEqual({
      label: "WBNB",
      from: "not set",
      to: "active",
    });
    expect(lines).toContainEqual({
      label: "Slippage",
      from: "not set",
      to: "1%",
    });
  });
});
