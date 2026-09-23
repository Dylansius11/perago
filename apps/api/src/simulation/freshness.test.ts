import type { ReasonCode } from "@perago/sdk";
import { describe, expect, it } from "vitest";

import type { ChainSnapshot } from "./context.js";
import {
  assessFreshness,
  type FreshnessInput,
  type SimulatedFacts,
} from "./freshness.js";

const hash = (fill: string) => `0x${fill.repeat(64)}` as const;
const address = (fill: string) => `0x${fill.repeat(40)}` as const;

const simulated: SimulatedFacts = {
  accountImplementation: address("7"),
  block: { hash: hash("d"), number: "100", timestamp: "2000000000" },
  codeHashes: {
    account: hash("1"),
    adapter: hash("4"),
    mandateExecutor: hash("3"),
    protocolTarget: hash("6"),
    verifier: hash("5"),
  },
  ownerEpoch: "1",
  policyHash: hash("a"),
  quoteExpiresAt: "2000000120",
  rootOwner: address("2"),
};

function current(overrides: Partial<ChainSnapshot> = {}): ChainSnapshot {
  return {
    accountConfig: {
      activePolicyHash: hash("a"),
      ownerEpoch: "1",
      permissionHash: hash("9"),
      rootOwner: address("2"),
    },
    accountImplementation: address("7"),
    allowUnboundCommerceJobs: true,
    block: { hash: hash("e"), number: 150n, timestamp: 2_000_000_119n },
    codeHashes: { ...simulated.codeHashes },
    ...overrides,
  };
}

const fresh: FreshnessInput = {
  canonicalHashAtSimulatedBlock: hash("d"),
  current: current(),
  nonceUsed: false,
  policyActive: true,
  simulated,
  wallet: { ownerEpoch: "1", rootOwner: address("2") },
};

describe("simulation freshness", () => {
  it("keeps a simulation whose every committed fact still holds", () => {
    expect(assessFreshness(fresh)).toEqual([]);
  });

  it("expires the quote at, not after, its deadline", () => {
    const atDeadline = current({
      block: { hash: hash("e"), number: 150n, timestamp: 2_000_000_120n },
    });
    expect(assessFreshness({ ...fresh, current: atDeadline })).toEqual([
      "STALE_QUOTE",
    ]);
  });

  const cases: [string, Partial<FreshnessInput>, ReasonCode][] = [
    [
      "a reorganized simulation block",
      { canonicalHashAtSimulatedBlock: hash("0") },
      "STALE_BLOCK",
    ],
    [
      "a simulation block the node no longer serves",
      { canonicalHashAtSimulatedBlock: null },
      "STALE_BLOCK",
    ],
    [
      "a policy that left ACTIVE offchain",
      { policyActive: false },
      "STALE_POLICY",
    ],
    [
      "a different active policy onchain",
      {
        current: current({
          accountConfig: {
            ...current().accountConfig,
            activePolicyHash: hash("b"),
          },
        }),
      },
      "STALE_POLICY",
    ],
    [
      "a new root owner onchain",
      {
        current: current({
          accountConfig: {
            ...current().accountConfig,
            rootOwner: address("8"),
          },
        }),
      },
      "STALE_ACCOUNT",
    ],
    [
      "a bumped owner epoch onchain",
      {
        current: current({
          accountConfig: { ...current().accountConfig, ownerEpoch: "2" },
        }),
      },
      "STALE_ACCOUNT",
    ],
    [
      "a wallet row that changed owner",
      { wallet: { ownerEpoch: "2", rootOwner: address("2") } },
      "STALE_ACCOUNT",
    ],
    [
      "an upgraded account implementation",
      { current: current({ accountImplementation: address("c") }) },
      "STALE_ACCOUNT",
    ],
    [
      "changed account code",
      {
        current: current({
          codeHashes: { ...simulated.codeHashes, account: hash("0") },
        }),
      },
      "STALE_ACCOUNT",
    ],
    ...(
      ["adapter", "mandateExecutor", "protocolTarget", "verifier"] as const
    ).map(
      (contract) =>
        [
          `changed ${contract} code`,
          {
            current: current({
              codeHashes: { ...simulated.codeHashes, [contract]: hash("0") },
            }),
          },
          "STALE_CODE",
        ] satisfies [string, Partial<FreshnessInput>, ReasonCode],
    ),
    ["a used or invalidated nonce", { nonceUsed: true }, "STALE_NONCE"],
  ];

  it.each(cases)("invalidates %s", (_name, change, reason) => {
    expect(assessFreshness({ ...fresh, ...change })).toEqual([reason]);
  });

  it("reports every stale fact, in a fixed order", () => {
    expect(
      assessFreshness({
        ...fresh,
        canonicalHashAtSimulatedBlock: hash("0"),
        nonceUsed: true,
        policyActive: false,
      }),
    ).toEqual(["STALE_BLOCK", "STALE_POLICY", "STALE_NONCE"]);
  });
});
