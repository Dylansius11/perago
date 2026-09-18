import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";

import { getTaskMandateTypedData } from "../src/index.js";

const hash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const mandate = {
  account: "0x1111111111111111111111111111111111111111",
  rootOwner: "0x2222222222222222222222222222222222222222",
  ownerEpoch: "1",
  executor: "0x3333333333333333333333333333333333333333",
  chainId: "97",
  nonce: "340282366920938463463374607431768211456",
  expiresAt: "2000000000",
  policyHash: hash,
  intentHash: hash,
  planHash: hash,
  simulationHash: hash,
  adapter: "0x4444444444444444444444444444444444444444",
  adapterSelector: "0x12345678",
  inputToken: "0x5555555555555555555555555555555555555555",
  maxInput: "340282366920938463463374607431768211456",
  outputToken: "0x6666666666666666666666666666666666666666",
  minOutput: "1",
  recipient: "0x1111111111111111111111111111111111111111",
  actionHash: hash,
  postconditionHash: hash,
  commerceContract: "0x0000000000000000000000000000000000000000",
  commerceJobId: "0",
};

describe("TaskMandate cross-stack fixture", () => {
  it("matches the Solidity EIP-712 digest", () => {
    expect(
      hashTypedData(
        getTaskMandateTypedData(mandate, {
          chainId: "97",
          verifyingContract: mandate.adapter,
        }),
      ),
    ).toBe(
      "0x9b204a82d741df2398ef74a699cc6a9b5cc4dae63aac247b0d69c29e4f206574",
    );
  });
});
