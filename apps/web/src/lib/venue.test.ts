import { describe, expect, it } from "vitest";
import { probeMatchingHead } from "./venue";

const block = (fill: string) => `0x${fill.repeat(64)}`;

describe("wallet chain-history gate", () => {
  it("rejects a wallet that shares an ancestor but not the console head", async () => {
    const requested: bigint[] = [];
    const matched = await probeMatchingHead({
      readHead: async () => ({ number: 12n, hash: block("a") }),
      readWalletBlock: async (number) => {
        requested.push(number);
        return { hash: number <= 10n ? block("a") : block("b") };
      },
    });
    expect(matched).toBe(false);
    expect(requested).toEqual([12n]);
  });
});
