import type { SettlementDeployment } from "@perago/sdk";
import { keccak256, type PublicClient, toHex } from "viem";
import { describe, expect, it } from "vitest";

import { readSubmittedCommerceJob } from "./commerce.js";

const addr = (digit: string) => `0x${digit.repeat(40)}` as `0x${string}`;
const runtime = "0x6000" as const;
const hash = keccak256(runtime);
const settlement: SettlementDeployment = {
  evaluator: { address: addr("1"), codeHash: hash },
  commerce: {
    address: addr("2"),
    codeHash: hash,
    implementation: addr("3"),
    implementationCodeHash: hash,
  },
  paymentToken: {
    address: addr("4"),
    codeHash: hash,
    implementation: addr("5"),
    implementationCodeHash: hash,
  },
  hook: { address: addr("6"), codeHash: hash },
  provider: addr("7"),
};
const executor = addr("8");
const account = addr("9");
const job = {
  id: 7n,
  client: account,
  provider: settlement.provider,
  evaluator: settlement.evaluator.address,
  description: "job",
  budget: 10n,
  expiredAt: 1_601n,
  status: 2,
  hook: settlement.hook.address,
  submittedAt: 1n,
  deliverable: toHex(1, { size: 32 }),
};

function clientWith(
  changes: {
    job?: Partial<typeof job>;
    implementation?: string;
    fee?: bigint;
  } = {},
): PublicClient {
  return {
    getCode: async () => runtime,
    getStorageAt: async ({ address }: { address: string }) =>
      toHex(
        BigInt(
          address === settlement.commerce.address
            ? (changes.implementation ?? settlement.commerce.implementation)
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
  } as unknown as PublicClient;
}

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

describe("pinned APEX job simulation", () => {
  it("binds a submitted, funded job to the exact smart account and reviewed evaluator", async () => {
    expect(
      await readSubmittedCommerceJob({ ...input, client: clientWith() }),
    ).toEqual({
      commerceContract: settlement.commerce.address,
      commerceJobId: "7",
    });
  });

  it("returns stable, actionable reasons for a changed job, implementation, or fee", async () => {
    await expect(
      readSubmittedCommerceJob({
        ...input,
        client: clientWith({ job: { provider: addr("a") } }),
      }),
    ).rejects.toMatchObject({
      code: "COMMERCE_JOB_INVALID",
      detail: "commerce job provider changed",
    });
    await expect(
      readSubmittedCommerceJob({
        ...input,
        client: clientWith({ implementation: addr("b") }),
      }),
    ).rejects.toMatchObject({ code: "DEPLOYMENT_MISMATCH" });
    await expect(
      readSubmittedCommerceJob({
        ...input,
        client: clientWith({ fee: 100n }),
      }),
    ).rejects.toMatchObject({ code: "COMMERCE_JOB_INVALID" });
  });
});
