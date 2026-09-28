import { describe, expect, it } from "vitest";

import { executionReceiptSchema } from "../src/index.js";

const hash = (fill: string) => `0x${fill.repeat(64)}`;
const address = (fill: string) => `0x${fill.repeat(40)}`;

const receipt = {
  schemaVersion: "1" as const,
  status: "SUCCEEDED" as const,
  chainId: "97",
  account: address("1"),
  mandateExecutor: address("2"),
  mandateHash: hash("3"),
  policyHash: hash("4"),
  intentHash: hash("5"),
  planHash: hash("6"),
  simulationHash: hash("7"),
  actionHash: hash("8"),
  postconditionHash: hash("9"),
  nonce: "1",
  authorityConsumed: true as const,
  terminalReasonCode: "ONCHAIN_SUCCEEDED",
  terminalMessage: "Verified execution succeeded onchain.",
  transactions: {
    authorize: hash("a"),
    begin: hash("b"),
    userOperation: hash("c"),
    execution: hash("d"),
  },
  authorization: { blockNumber: "10", blockHash: hash("e") },
  begin: { blockNumber: "11", blockHash: hash("f") },
  terminal: {
    transactionHash: hash("d"),
    blockNumber: "11",
    blockHash: hash("f"),
    logIndex: 1,
  },
  explorer: {
    authorization: "https://testnet.bscscan.com/tx/0x1",
    begin: "https://testnet.bscscan.com/tx/0x2",
    execution: "https://testnet.bscscan.com/tx/0x3",
    terminal: "https://testnet.bscscan.com/tx/0x4",
    block: "https://testnet.bscscan.com/block/11",
  },
  verification: {
    status: "PASSED" as const,
    hash: hash("a"),
    failureReasonHash: hash("0"),
    reasonCode: "ONCHAIN_SUCCEEDED",
  },
};

describe("execution receipt settlement", () => {
  it("accepts only complete finalized payout evidence", () => {
    const settlement = {
      status: "CONFIRMED" as const,
      commerceContract: address("b"),
      jobId: "7",
      transactionHash: hash("c"),
      blockNumber: "12",
      blockHash: hash("d"),
      evaluatorLogIndex: 0,
      completionLogIndex: 1,
      paymentLogIndex: 2,
      provider: address("e"),
      paymentToken: address("f"),
      amount: "100",
    };
    expect(
      executionReceiptSchema.parse({ ...receipt, settlement }),
    ).toMatchObject({
      settlement,
    });
    expect(
      executionReceiptSchema.safeParse({
        ...receipt,
        settlement: { ...settlement, paymentLogIndex: -1 },
      }).success,
    ).toBe(false);
  });

  it("distinguishes a completed-or-expired success without payout from pending", () => {
    expect(
      executionReceiptSchema.parse({
        ...receipt,
        settlement: {
          status: "UNPAID",
          commerceContract: address("b"),
          jobId: "7",
        },
      }).settlement.status,
    ).toBe("UNPAID");
  });
});
