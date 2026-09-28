import { describe, expect, it } from "vitest";
import { submitOwnerOnce } from "./owner-submission";

const transactionHash = `0x${"a".repeat(64)}` as `0x${string}`;
const userOperationHash = `0x${"b".repeat(64)}` as `0x${string}`;

describe("owner transaction recovery", () => {
  it("confirms a previously broadcast transaction without a second wallet send", async () => {
    const rows = new Map<string, string>();
    const store = {
      getItem: (key: string) => rows.get(key) ?? null,
      setItem: (key: string, value: string) => {
        rows.set(key, value);
      },
      removeItem: (key: string) => {
        rows.delete(key);
      },
    };
    let sends = 0;
    let reads = 0;
    const attempt = () =>
      submitOwnerOnce({
        key: "chain-97:owner:call",
        store,
        send: async () => {
          sends += 1;
          return { transactionHash, userOperationHash };
        },
        confirm: async (pending) => {
          reads += 1;
          expect(pending).toEqual({ transactionHash, userOperationHash });
          if (reads === 1) throw new Error("receipt RPC unavailable");
          return "mined";
        },
      });

    await expect(attempt()).rejects.toThrow("receipt RPC unavailable");
    expect(rows.size).toBe(1);
    await expect(attempt()).resolves.toBe("mined");
    expect(sends).toBe(1);
    expect(reads).toBe(2);
    expect(rows.size).toBe(0);
  });
});
