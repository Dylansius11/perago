import type { SettlementDeployment } from "@perago/sdk";
import { keccak256, type PublicClient, toHex } from "viem";
import { describe, expect, it } from "vitest";

import { readCommerceView } from "./commerce.ts";

const addr = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const codeHash = keccak256("0x6000");
const settlement: SettlementDeployment = {
  evaluator: { address: addr("1"), codeHash },
  commerce: {
    address: addr("2"),
    codeHash,
    implementation: addr("3"),
    implementationCodeHash: codeHash,
  },
  paymentToken: {
    address: addr("4"),
    codeHash,
    implementation: addr("5"),
    implementationCodeHash: codeHash,
  },
  hook: { address: addr("6"), codeHash },
  provider: addr("7"),
};
const executor = addr("8");
const account = addr("9");
const job = {
  id: 7n,
  client: account,
  provider: settlement.provider,
  evaluator: settlement.evaluator.address,
  hook: settlement.hook.address,
  budget: 10n,
  expiredAt: 1_601n,
  status: 2,
  description: "job",
  submittedAt: 1n,
  deliverable: toHex(1, { size: 32 }),
};
const input = {
  settlement,
  executor,
  account,
  jobId: 7n,
  blockNumber: 10n,
  mandateExpiresAt: 880n,
  executionWindowSeconds: 600n,
  now: 1n,
};
const clientWith = (
  changes: {
    job?: Partial<typeof job>;
    fee?: bigint;
    code?: "0x6000" | "0x6001";
  } = {},
) =>
  ({
    getCode: async () => changes.code ?? "0x6000",
    getStorageAt: async ({ address }: { address: string }) =>
      toHex(
        BigInt(
          address === settlement.commerce.address
            ? settlement.commerce.implementation
            : settlement.paymentToken.implementation,
        ),
        { size: 32 },
      ),
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "executor":
          return executor;
        case "commerce":
          return settlement.commerce.address;
        case "provider":
          return settlement.provider;
        case "hook":
          return settlement.hook.address;
        case "paymentToken":
          return settlement.paymentToken.address;
        case "getJob":
          return { ...job, ...changes.job };
        case "jobPaymentToken":
          return settlement.paymentToken.address;
        case "platformFeeBP":
          return changes.fee ?? 0n;
        default:
          throw new Error(`unexpected chain read ${functionName}`);
      }
    },
  }) as unknown as PublicClient;

describe("worker commerce observation", () => {
  it("reads the pinned job and denies a changed provider before any authority is consumed", async () => {
    expect(await readCommerceView({ ...input, client: clientWith() })).toEqual({
      status: "Submitted",
      valid: true,
      refundable: true,
      expiredAt: 1_601n,
    });
    expect(
      await readCommerceView({
        ...input,
        client: clientWith({ job: { provider: addr("a") } }),
      }),
    ).toEqual({
      status: "Submitted",
      valid: false,
      refundable: false,
      expiredAt: 1_601n,
    });
  });

  it("returns a terminal paid state without proposing a second payment", async () => {
    expect(
      await readCommerceView({
        ...input,
        client: clientWith({ job: { status: 3 } }),
      }),
    ).toMatchObject({
      status: "Completed",
    });
    expect(
      await readCommerceView({ ...input, client: clientWith({ fee: 100n }) }),
    ).toMatchObject({ valid: false });
  });

  it("keeps an unchanged funded job eligible for a failed mandate refund", async () => {
    expect(
      await readCommerceView({
        ...input,
        client: clientWith({ job: { status: 1 } }),
      }),
    ).toEqual({
      status: "Funded",
      valid: true,
      refundable: true,
      expiredAt: 1_601n,
    });
    expect(
      await readCommerceView({
        ...input,
        client: clientWith({ job: { status: 1, provider: addr("a") } }),
      }),
    ).toMatchObject({
      status: "Funded",
      valid: false,
    });
  });
  it("keeps an expired job's exact identity eligible for permissionless escrow recovery", async () => {
    expect(
      await readCommerceView({
        ...input,
        now: 1_601n,
        client: clientWith(),
      }),
    ).toMatchObject({ status: "Submitted", valid: false, refundable: true });
  });
  it("throws when a pinned contract's runtime code drifts", async () => {
    await expect(
      readCommerceView({ ...input, client: clientWith({ code: "0x6001" }) }),
    ).rejects.toThrow("pinned code");
  });
});
