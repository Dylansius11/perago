import { decodeFunctionData, hashTypedData, parseAbi, slice } from "viem";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_EXECUTE_SELECTOR,
  EXECUTE_USER_OP_SELECTOR,
  encodeSessionPerformCallData,
  executionProofSchema,
  getTaskMandateTypedData,
  mandateExecutorAbi,
  pendingTransactionSchema,
  signedMandateDocumentSchema,
} from "../src/index.js";

const hash = `0x${"aa".repeat(32)}`;
const executor = "0x9999999999999999999999999999999999999999";
const mandate = {
  account: "0x1111111111111111111111111111111111111111",
  rootOwner: "0x2222222222222222222222222222222222222222",
  ownerEpoch: "1",
  executor: "0x3333333333333333333333333333333333333333",
  chainId: "97",
  nonce: "7",
  expiresAt: "2000000000",
  policyHash: hash,
  intentHash: hash,
  planHash: hash,
  simulationHash: hash,
  adapter: "0x4444444444444444444444444444444444444444",
  adapterSelector: "0x12345678",
  inputToken: "0x5555555555555555555555555555555555555555",
  maxInput: "1000",
  outputToken: "0x6666666666666666666666666666666666666666",
  minOutput: "1",
  recipient: "0x1111111111111111111111111111111111111111",
  actionHash: hash,
  postconditionHash: hash,
  commerceContract: "0x0000000000000000000000000000000000000000",
  commerceJobId: "0",
};
const document = {
  primaryType: "TaskMandate",
  domain: { chainId: "97", verifyingContract: executor },
  message: mandate,
};
const accountAbi = parseAbi([
  "function execute(address target, uint256 value, bytes data) payable returns (bytes)",
]);

describe("signed mandate document", () => {
  it("rebuilds the exact digest the root owner signed", () => {
    const parsed = signedMandateDocumentSchema.parse(document);
    expect(hashTypedData(getTaskMandateTypedData(parsed.message, parsed.domain))).toBe(
      hashTypedData(getTaskMandateTypedData(mandate, document.domain)),
    );
  });

  it("rejects a message whose chain differs from its domain", () => {
    expect(
      signedMandateDocumentSchema.safeParse({
        ...document,
        domain: { ...document.domain, chainId: "56" },
      }).success,
    ).toBe(false);
  });
});

describe("pending transaction", () => {
  const pending = {
    kind: "PERFORM",
    transactionHash: hash,
    rawTransaction: "0x02f8",
    userOperationHash: hash,
  };

  it("binds a UserOperation hash to PERFORM and nothing else", () => {
    expect(pendingTransactionSchema.safeParse(pending).success).toBe(true);
    expect(
      pendingTransactionSchema.safeParse({ ...pending, userOperationHash: null })
        .success,
    ).toBe(false);
    expect(
      pendingTransactionSchema.safeParse({ ...pending, kind: "AUTHORIZE" })
        .success,
    ).toBe(false);
  });
});

describe("session perform call", () => {
  it("calls only MandateExecutor.perform with the signed mandate and proof", () => {
    const proof = executionProofSchema.parse({
      mandateHash: hash,
      account: mandate.account,
      executor: mandate.executor,
      validUntil: "1999999999",
    });
    const callData = encodeSessionPerformCallData({
      action: "0xabcd",
      document: signedMandateDocumentSchema.parse(document),
      proof,
      proofSignature: `0x${"11".repeat(65)}`,
    });

    expect(slice(callData, 0, 4)).toBe(EXECUTE_USER_OP_SELECTOR);
    const inner = slice(callData, 4);
    expect(slice(inner, 0, 4)).toBe(ACCOUNT_EXECUTE_SELECTOR);
    const outer = decodeFunctionData({ abi: accountAbi, data: inner });
    expect(outer.args[0].toLowerCase()).toBe(executor);
    expect(outer.args[1]).toBe(0n);

    const perform = decodeFunctionData({
      abi: mandateExecutorAbi,
      data: outer.args[2],
    });
    expect(perform.functionName).toBe("perform");
    expect(perform.args).toEqual([
      getTaskMandateTypedData(mandate, document.domain).message,
      "0xabcd",
      { ...proof, validUntil: 1999999999 },
      `0x${"11".repeat(65)}`,
    ]);
  });
});
