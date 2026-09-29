import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";

import { readFinalizedMandate } from "./chain.js";

const zero = `0x${"00".repeat(32)}` as const;

describe("finalized mandate scan", () => {
  it("resolves a never-authorized mandate without depending on historical log availability", async () => {
    const client = {
      getBlock: async () => ({ hash: zero, number: 1000n }),
      readContract: async () => ({
        status: 0,
        verificationHash: zero,
        failureReasonHash: zero,
      }),
      getLogs: async () => {
        throw new Error("historical log scan exceeded the provider window");
      },
    } as unknown as PublicClient;

    const result = await readFinalizedMandate({
      client,
      mandateExecutor: "0x1111111111111111111111111111111111111111",
      mandateHash: zero,
      fromBlock: 1n,
      now: new Date("2026-09-28T16:00:00Z"),
    });

    expect(result).toMatchObject({
      finalized: { hash: zero, number: 1000n },
      recordStatus: "NONE",
      events: [],
      verificationHash: zero,
      failureReasonHash: zero,
    });
  });
  it("still requires canonical event history for an authorized mandate", async () => {
    const client = {
      getBlock: async () => ({ hash: zero, number: 1000n }),
      readContract: async () => ({
        status: 1,
        verificationHash: zero,
        failureReasonHash: zero,
      }),
      getLogs: async () => {
        throw new Error("historical logs unavailable");
      },
    } as unknown as PublicClient;

    await expect(
      readFinalizedMandate({
        client,
        mandateExecutor: "0x1111111111111111111111111111111111111111",
        mandateHash: zero,
        fromBlock: 1n,
        now: new Date("2026-09-28T16:00:00Z"),
      }),
    ).rejects.toThrow("historical logs unavailable");
  });
});
