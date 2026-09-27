import { describe, expect, it } from "vitest";
import {
  pendingPolicyKey,
  readPendingPolicy,
  writePendingPolicy,
} from "./policy-pending";

const identity = {
  account: "0x1111111111111111111111111111111111111111" as const,
  owner: "0x2222222222222222222222222222222222222222" as const,
  chainId: 97,
};
const record = {
  policyId: "a7c32119-15fb-48a4-a6e7-cad789ea2a20",
  body: {
    ownerEpoch: "1",
    validUntil: "1790600000",
    permission: {
      account: identity.account,
      entityId: 1,
      nativeSpendLimit: "0",
      selectors: ["0x12345678" as const],
      sessionSigner: identity.owner,
      target: "0x3333333333333333333333333333333333333333" as const,
      validAfter: "1790500000",
      validUntil: "1790600000",
    },
    rootSignature: `0x${"11".repeat(65)}` as `0x${string}`,
    transactionHash: `0x${"22".repeat(32)}` as `0x${string}`,
    userOperationHash: `0x${"33".repeat(32)}` as `0x${string}`,
  },
};

function memoryStore(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  } as Storage;
}

describe("pending policy finality recovery", () => {
  it("restores only a valid signed confirmation for the same owner and account", () => {
    const store = memoryStore();
    writePendingPolicy(store, identity, record);
    expect(readPendingPolicy(store, identity)).toEqual(record);
    expect(
      readPendingPolicy(store, { ...identity, owner: identity.account }),
    ).toBeNull();
    expect(readPendingPolicy(store, { ...identity, chainId: 56 })).toBeNull();
  });

  it("fails closed on corrupted evidence rather than suggesting a second broadcast", () => {
    const store = memoryStore();
    writePendingPolicy(store, identity, record);
    store.setItem(pendingPolicyKey(identity), "{}");
    expect(() => readPendingPolicy(store, identity)).toThrow();
  });
});
