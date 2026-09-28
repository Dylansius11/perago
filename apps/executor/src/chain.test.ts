import type { Address, ExecutionJob, SettlementDeployment } from "@perago/sdk";
import { keccak256, type PublicClient, toHex } from "viem";
import { describe, expect, it } from "vitest";

import { readChainView } from "./chain.ts";
import type { ExecutorDeployment } from "./config.ts";

const addr = (digit: string) => `0x${digit.repeat(40)}` as Address;
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
const job = (commerceJobId: string) =>
  ({
    mandateHash: toHex(1, { size: 32 }),
    document: {
      message: {
        inputToken: addr("a"),
        account,
        commerceJobId,
        expiresAt: "1",
      },
    },
    pending: null,
  }) as ExecutionJob;
const deployment = {
  mandateExecutor: addr("b"),
  executionWindowSeconds: 600n,
  settlement,
} as ExecutorDeployment;
const client = () =>
  ({
    getBlock: async () => ({ number: 10n, timestamp: 1n }),
    getCode: async () => "0x6000",
    getStorageAt: async ({ address }: { address: Address }) =>
      toHex(
        BigInt(
          address === settlement.commerce.address
            ? settlement.commerce.implementation
            : settlement.paymentToken.implementation,
        ),
        { size: 32 },
      ),
    getTransactionCount: async () => 0,
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "mandateRecord":
          return { status: 1, executionStartedAt: 0n };
        case "allowance":
        case "balanceOf":
          return 10n;
        case "executor":
          return deployment.mandateExecutor;
        case "commerce":
          return settlement.commerce.address;
        case "provider":
          return settlement.provider;
        case "hook":
          return settlement.hook.address;
        case "paymentToken":
          return settlement.paymentToken.address;
        case "getJob":
          return {
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
        case "jobPaymentToken":
          return settlement.paymentToken.address;
        case "platformFeeBP":
          return 0n;
        default:
          throw new Error(`unexpected chain read ${functionName}`);
      }
    },
  }) as unknown as PublicClient;

describe("readChainView commerce observation", () => {
  it("returns null without reading commerce for an unbound mandate", async () => {
    expect(
      await readChainView({
        client: client(),
        deployment,
        executor,
        job: job("0"),
      }),
    ).toMatchObject({
      commerce: null,
    });
  });

  it("reads a bound job at the mandate block timestamp", async () => {
    expect(
      await readChainView({
        client: client(),
        deployment,
        executor,
        job: job("7"),
      }),
    ).toMatchObject({
      commerce: { status: "Submitted", valid: true, expiredAt: 1_601n },
    });
  });
});
