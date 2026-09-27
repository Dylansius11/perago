import {
  apexCommerceAbi,
  outcomeEvaluatorAbi,
  type SettlementDeployment,
} from "@perago/sdk";
import {
  type Address,
  encodeAbiParameters,
  encodeEventTopics,
  type Hash,
  keccak256,
  toHex,
} from "viem";
import { describe, expect, it } from "vitest";

import {
  projectFinalizedCommerce,
  readFinalizedCommerceState,
} from "./receipt-index.js";

const hash = (fill: string) => `0x${fill.repeat(64)}` as `0x${string}`;
const address = (fill: string) => `0x${fill.repeat(40)}` as `0x${string}`;

const codeHash = keccak256("0x6000");
const settlement: SettlementDeployment = {
  evaluator: { address: address("1"), codeHash },
  commerce: {
    address: address("2"),
    codeHash,
    implementation: address("3"),
    implementationCodeHash: codeHash,
  },
  paymentToken: {
    address: address("4"),
    codeHash,
    implementation: address("5"),
    implementationCodeHash: codeHash,
  },
  hook: { address: address("6"), codeHash },
  provider: address("7"),
};

const input = {
  receiptStatus: "SUCCEEDED" as const,
  mandateHash: hash("8"),
  account: address("9"),
  commerceContract: settlement.commerce.address,
  jobId: 7n,
  settled: true,
  job: {
    id: 7n,
    client: address("9"),
    provider: settlement.provider,
    evaluator: settlement.evaluator.address,
    hook: settlement.hook.address,
    budget: 100n,
    status: 3,
  },
  paymentToken: settlement.paymentToken.address,
  events: [
    {
      name: "CommerceJobSettled" as const,
      transactionHash: hash("b"),
      blockNumber: 12n,
      blockHash: hash("c"),
      logIndex: 2,
      args: {
        commerceContract: settlement.commerce.address,
        jobId: 7n,
        mandateHash: hash("8"),
      },
    },
    {
      name: "JobCompleted" as const,
      transactionHash: hash("b"),
      blockNumber: 12n,
      blockHash: hash("c"),
      logIndex: 0,
      args: { jobId: 7n, evaluator: settlement.evaluator.address },
    },
    {
      name: "PaymentReleased" as const,
      transactionHash: hash("b"),
      blockNumber: 12n,
      blockHash: hash("c"),
      logIndex: 1,
      args: { jobId: 7n, provider: settlement.provider, amount: 100n },
    },
  ],
};

describe("finalized commerce projection", () => {
  it("confirms only the same finalized evaluator and APEX payout", () => {
    expect(projectFinalizedCommerce(settlement, input)).toEqual({
      status: "CONFIRMED",
      settlementTxHash: hash("b"),
      evidence: {
        transactionHash: hash("b"),
        blockNumber: "12",
        blockHash: hash("c"),
        evaluatorLogIndex: 2,
        completionLogIndex: 0,
        paymentLogIndex: 1,
        provider: settlement.provider,
        paymentToken: settlement.paymentToken.address,
        amount: "100",
      },
    });
  });

  it("keeps success pending for mismatched payment evidence", () => {
    expect(
      projectFinalizedCommerce(settlement, {
        ...input,
        events: input.events.map((event) =>
          event.name === "PaymentReleased"
            ? { ...event, args: { ...event.args, amount: 99n } }
            : event,
        ),
      }),
    ).toEqual({ status: "PENDING", settlementTxHash: null });
  });

  it("never marks a failed mandate paid and exposes rejected success as unpaid", () => {
    expect(
      projectFinalizedCommerce(settlement, {
        ...input,
        receiptStatus: "FAILED",
      }),
    ).toEqual({ status: "INELIGIBLE", settlementTxHash: null });
    expect(
      projectFinalizedCommerce(settlement, {
        ...input,
        job: { ...input.job, status: 4 },
        settled: false,
        events: [],
      }),
    ).toEqual({ status: "UNPAID", settlementTxHash: null });
  });
});

it("reads bounded finalized logs and rejects a payment in another transaction", async () => {
  const topics = (
    abi: typeof apexCommerceAbi | typeof outcomeEvaluatorAbi,
    eventName: string,
    args: Record<string, string | bigint>,
  ) =>
    encodeEventTopics({
      abi,
      eventName: eventName as never,
      args: args as never,
    }) as readonly Hash[];
  const evaluatorLog = {
    address: settlement.evaluator.address,
    blockHash: hash("c"),
    blockNumber: 12n,
    data: "0x",
    logIndex: 2,
    topics: topics(outcomeEvaluatorAbi, "CommerceJobSettled", {
      commerceContract: settlement.commerce.address,
      jobId: 7n,
      mandateHash: hash("8"),
    }),
    transactionHash: hash("b"),
  };
  const completedLog = {
    address: settlement.commerce.address,
    blockHash: hash("c"),
    blockNumber: 12n,
    data: encodeAbiParameters([{ type: "bytes32" }], [hash("0")]),
    logIndex: 0,
    topics: topics(apexCommerceAbi, "JobCompleted", {
      jobId: 7n,
      evaluator: settlement.evaluator.address,
    }),
    transactionHash: hash("b"),
  };
  const paidLog = {
    address: settlement.commerce.address,
    blockHash: hash("c"),
    blockNumber: 12n,
    data: encodeAbiParameters([{ type: "uint256" }], [100n]),
    logIndex: 1,
    topics: topics(apexCommerceAbi, "PaymentReleased", {
      jobId: 7n,
      provider: settlement.provider,
    }),
    transactionHash: hash("d"),
  };
  const unrelatedPayment = {
    ...paidLog,
    logIndex: 3,
    topics: topics(apexCommerceAbi, "PaymentReleased", {
      jobId: 8n,
      provider: settlement.provider,
    }),
    transactionHash: hash("e"),
  };
  const client = {
    getLogs: async ({ address: target }: { address: Address }) =>
      target === settlement.evaluator.address
        ? [evaluatorLog]
        : [completedLog, paidLog, unrelatedPayment],
    getCode: async () => "0x6000" as const,
    getStorageAt: async ({ address: target }: { address: Address }) =>
      toHex(
        BigInt(
          target === settlement.commerce.address
            ? settlement.commerce.implementation
            : settlement.paymentToken.implementation,
        ),
        { size: 32 },
      ),
    readContract: async ({ functionName }: { functionName: string }) => {
      switch (functionName) {
        case "executor":
          return address("a");
        case "commerce":
          return settlement.commerce.address;
        case "provider":
          return settlement.provider;
        case "hook":
          return settlement.hook.address;
        case "paymentToken":
        case "jobPaymentToken":
          return settlement.paymentToken.address;
        case "settled":
          return true;
        case "getJob":
          return input.job;
        default:
          throw new Error(`unexpected read ${functionName}`);
      }
    },
  };
  const observed = await readFinalizedCommerceState({
    client: client as never,
    settlement,
    receiptStatus: "SUCCEEDED",
    account: input.account,
    commerceContract: settlement.commerce.address,
    mandateExecutor: address("a"),
    jobId: 7n,
    mandateHash: input.mandateHash,
    fromBlock: 11n,
    finalizedBlock: 12n,
    observedAt: new Date("2026-01-01T00:00:00Z"),
  });
  expect(observed).toMatchObject({
    status: "PENDING",
    settlementTxHash: null,
    jobStatus: 3,
  });
  expect(observed.events).toHaveLength(3);
  const priorClient = {
    ...client,
    getBlock: async () => ({ hash: hash("c") }),
    getTransactionReceipt: async () => ({
      transactionHash: hash("b"),
      status: "success",
      blockNumber: 12n,
      blockHash: hash("c"),
      logs: [
        completedLog,
        { ...paidLog, transactionHash: hash("b") },
        evaluatorLog,
      ],
    }),
    getLogs: async () => {
      throw new Error(
        "a previously confirmed payout must not rescan old blocks",
      );
    },
  };
  const repeated = await readFinalizedCommerceState({
    client: priorClient as never,
    settlement,
    receiptStatus: "SUCCEEDED",
    account: input.account,
    commerceContract: settlement.commerce.address,
    mandateExecutor: address("a"),
    jobId: 7n,
    mandateHash: input.mandateHash,
    fromBlock: 13n,
    finalizedBlock: 12n,
    priorSettlementTxHash: hash("b"),
    observedAt: new Date("2026-01-01T00:00:00Z"),
  });
  expect(repeated).toMatchObject({
    status: "CONFIRMED",
    settlementTxHash: hash("b"),
  });
});
