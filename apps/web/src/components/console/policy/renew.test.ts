import type { WalletPolicy } from "@perago/sdk";
import { describe, expect, it } from "vitest";
import { RENEW_WINDOW_SECONDS, renewedPolicy, renewState } from "./renew";

describe("renewState", () => {
  it("offers a renewal once the session has ended", () => {
    expect(renewState(0)).toBe("ended");
    expect(renewState(-1)).toBe("ended");
    expect(renewState(-86_400)).toBe("ended");
  });

  it("offers one while under two hours remain", () => {
    expect(renewState(1)).toBe("ending");
    expect(renewState(RENEW_WINDOW_SECONDS - 1)).toBe("ending");
  });

  it("stays quiet at two hours and above", () => {
    expect(RENEW_WINDOW_SECONDS).toBe(7_200);
    expect(renewState(RENEW_WINDOW_SECONDS)).toBeNull();
    expect(renewState(86_400)).toBeNull();
  });

  it("stays quiet when the policy carries no end time", () => {
    expect(renewState(null)).toBeNull();
  });
});

describe("renewedPolicy", () => {
  const swapOnly: WalletPolicy = {
    schemaVersion: "1",
    account: "0x17fcce2b0c0cc44c4f88c6c09b6364a766ee7944",
    chainId: "97",
    version: "3",
    protectedAssets: ["0x00000000000000000000000000000000000000aa"],
    activeAssets: [
      {
        token: "0x00000000000000000000000000000000000000bb",
        maxInputPerTask: "5",
        rollingDailyCap: "50",
      },
    ],
    services: ["SWAP"],
    approvedAdapterIds: ["pancakeswap-v3"],
    maxSlippageBps: "100",
    allowedRecipients: "SELF",
    maxTaskLifetimeSeconds: "1800",
  };

  it("keeps every limit and changes only the version", () => {
    const next = renewedPolicy(swapOnly, ["3"]);
    expect(next).toEqual({ ...swapOnly, version: "4" });
    expect(next.services).toEqual(["SWAP"]);
    expect(next.approvedAdapterIds).toEqual(["pancakeswap-v3"]);
    expect(next.activeAssets).toEqual(swapOnly.activeAssets);
    expect(next.protectedAssets).toEqual(swapOnly.protectedAssets);
  });

  it("takes the version after the highest one the account has used", () => {
    expect(renewedPolicy(swapOnly, ["3", "9", "4"]).version).toBe("10");
  });
});
