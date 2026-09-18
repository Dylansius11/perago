import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  compiledPlanSchema,
  getTaskMandateTypedData,
  hashTaskIntent,
  hashWalletPolicy,
  taskMandateTypeString,
  taskMandateTypes,
  walletPolicySchema,
} from "../src/index.js";

const account = "0x1111111111111111111111111111111111111111";
const owner = "0x2222222222222222222222222222222222222222";
const executor = "0x3333333333333333333333333333333333333333";
const adapter = "0x4444444444444444444444444444444444444444";
const tokenIn = "0x5555555555555555555555555555555555555555";
const tokenOut = "0x6666666666666666666666666666666666666666";
const hash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const walletPolicy = {
  schemaVersion: "1",
  account,
  chainId: "97",
  version: "1",
  protectedAssets: [tokenOut],
  activeAssets: [
    {
      token: tokenIn,
      maxInputPerTask: "340282366920938463463374607431768211456",
      rollingDailyCap: "680564733841876926926749214863536422912",
    },
  ],
  services: ["SWAP"],
  approvedAdapterIds: ["pancakeswap-v3"],
  maxSlippageBps: "100",
  allowedRecipients: "SELF",
  maxTaskLifetimeSeconds: "3600",
};

const taskMandate = {
  account,
  rootOwner: owner,
  ownerEpoch: "1",
  executor,
  chainId: "97",
  nonce: "340282366920938463463374607431768211456",
  expiresAt: "2000000000",
  policyHash: hash,
  intentHash: hash,
  planHash: hash,
  simulationHash: hash,
  adapter,
  adapterSelector: "0x12345678",
  inputToken: tokenIn,
  maxInput: "340282366920938463463374607431768211456",
  outputToken: tokenOut,
  minOutput: "1",
  recipient: account,
  actionHash: hash,
  postconditionHash: hash,
  commerceContract: "0x0000000000000000000000000000000000000000",
  commerceJobId: "0",
};

describe("canonical mandate domain", () => {
  it("rejects unknown fields and numeric token amounts", () => {
    expect(() =>
      walletPolicySchema.parse({ ...walletPolicy, unexpected: true }),
    ).toThrow();
    expect(() =>
      walletPolicySchema.parse({
        ...walletPolicy,
        activeAssets: [{ ...walletPolicy.activeAssets[0], maxInputPerTask: 1 }],
      }),
    ).toThrow();
  });

  it("rejects protected active overlap and unsupported actions", () => {
    expect(() =>
      walletPolicySchema.parse({ ...walletPolicy, protectedAssets: [tokenIn] }),
    ).toThrow();
    expect(() =>
      compiledPlanSchema.parse({
        schemaVersion: "1",
        chainId: "97",
        policyHash: hash,
        action: { kind: "TRANSFER" },
      }),
    ).toThrow();
  });

  it("accepts only closed swap and stake actions", () => {
    expect(
      compiledPlanSchema.parse({
        schemaVersion: "1",
        chainId: "97",
        policyHash: hash,
        action: {
          kind: "SWAP",
          adapterId: "pancakeswap-v3",
          tokenIn,
          tokenOut,
          poolFee: "500",
          amountIn: "1",
          minAmountOut: "1",
          recipient: account,
          deadline: "2000000000",
        },
      }).action.kind,
    ).toBe("SWAP");
    expect(
      compiledPlanSchema.parse({
        schemaVersion: "1",
        chainId: "97",
        policyHash: hash,
        action: {
          kind: "STAKE",
          adapterId: "cake-pool",
          asset: tokenIn,
          amount: "1",
          minPositionOut: "1",
          recipient: account,
          deadline: "2000000000",
          poolId: hash,
        },
      }).action.kind,
    ).toBe("STAKE");
  });

  it("produces stable canonical JSON and hashes", () => {
    expect(canonicalJson({ z: [true, "x"], a: 1 })).toBe(
      '{"a":1,"z":[true,"x"]}',
    );
    expect(() => canonicalJson(1n)).toThrow();
    expect(hashWalletPolicy(walletPolicy)).toBe(
      hashWalletPolicy({
        ...walletPolicy,
        account: `${account.slice(0, 2)}${account.slice(2).toUpperCase()}`,
      }),
    );
    expect(
      hashTaskIntent({
        schemaVersion: "1",
        account,
        chainId: "97",
        recipient: account,
        goal: "Swap",
        requestedExpirySeconds: "3600",
      }),
    ).toBe(
      hashTaskIntent({
        schemaVersion: "1",
        account,
        chainId: "97",
        recipient: account,
        goal: "Swap",
        requestedExpirySeconds: "3600",
      }),
    );
  });

  it("matches the frozen TaskMandate EIP-712 field order and widths", () => {
    expect(taskMandateTypeString).toBe(
      "TaskMandate(address account,address rootOwner,uint64 ownerEpoch,address executor,uint256 chainId,uint256 nonce,uint48 expiresAt,bytes32 policyHash,bytes32 intentHash,bytes32 planHash,bytes32 simulationHash,address adapter,bytes4 adapterSelector,address inputToken,uint256 maxInput,address outputToken,uint256 minOutput,address recipient,bytes32 actionHash,bytes32 postconditionHash,address commerceContract,uint256 commerceJobId)",
    );
    expect(
      taskMandateTypes.TaskMandate.map(
        (field) => `${field.type} ${field.name}`,
      ),
    ).toEqual([
      "address account",
      "address rootOwner",
      "uint64 ownerEpoch",
      "address executor",
      "uint256 chainId",
      "uint256 nonce",
      "uint48 expiresAt",
      "bytes32 policyHash",
      "bytes32 intentHash",
      "bytes32 planHash",
      "bytes32 simulationHash",
      "address adapter",
      "bytes4 adapterSelector",
      "address inputToken",
      "uint256 maxInput",
      "address outputToken",
      "uint256 minOutput",
      "address recipient",
      "bytes32 actionHash",
      "bytes32 postconditionHash",
      "address commerceContract",
      "uint256 commerceJobId",
    ]);

    const typedData = getTaskMandateTypedData(taskMandate, {
      chainId: "97",
      verifyingContract: adapter,
    });
    expect(typedData.message.maxInput).toBe(
      340282366920938463463374607431768211456n,
    );
    expect(hashTypedData(typedData)).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(() =>
      getTaskMandateTypedData(taskMandate, {
        chainId: "56",
        verifyingContract: adapter,
      }),
    ).toThrow();
  });
});
