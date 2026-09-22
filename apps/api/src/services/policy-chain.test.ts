import { type Address, type Hash, mandateExecutorAbi } from "@perago/sdk";
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  type Hex,
  keccak256,
  type PublicClient,
} from "viem";
import {
  entryPoint07Abi,
  getUserOperationHash,
} from "viem/account-abstraction";
import { describe, expect, it } from "vitest";

import type { PolicyChainExpectation } from "./policies.js";
import { createViemPolicyChainVerifier } from "./policy-chain.js";

const account: Address = "0x1111111111111111111111111111111111111111";
const owner = "0x2222222222222222222222222222222222222222";
const executor = "0x3333333333333333333333333333333333333333";
const entryPoint = "0x4444444444444444444444444444444444444444";
const implementation = "0x5555555555555555555555555555555555555555";
const zeroAddress = "0x0000000000000000000000000000000000000000";
const policyHash = `0x${"aa".repeat(32)}` as Hash;
const permissionHash = `0x${"bb".repeat(32)}` as Hash;
const transitionCallData = "0x1234";
const policyTxHash = `0x${"ee".repeat(32)}` as Hash;
const blockHash = `0x${"12".repeat(32)}` as Hash;

const expectation: PolicyChainExpectation = {
  account,
  activePolicyHash: policyHash,
  chainId: "97",
  ownerEpoch: "1",
  permissionHash,
  rootOwner: owner,
  transactionHash: policyTxHash,
  transition: "ACTIVATE",
  transitionCallData,
  userOperationHash: userOperationHash(transitionCallData),
};

function packedUserOperation(callData: Hex, nonce = 0n) {
  return {
    accountGasLimits: `0x${"00".repeat(32)}` as Hex,
    callData,
    gasFees: `0x${"00".repeat(32)}` as Hex,
    initCode: "0x" as Hex,
    nonce,
    paymasterAndData: "0x" as Hex,
    preVerificationGas: 0n,
    sender: account,
    signature: "0x" as Hex,
  };
}

function userOperationHash(callData: Hex, nonce = 0n): Hash {
  return getUserOperationHash({
    chainId: 97,
    entryPointAddress: entryPoint,
    entryPointVersion: "0.7",
    userOperation: {
      callData,
      callGasLimit: 0n,
      maxFeePerGas: 0n,
      maxPriorityFeePerGas: 0n,
      nonce,
      preVerificationGas: 0n,
      sender: account,
      signature: "0x",
      verificationGasLimit: 0n,
    },
  });
}

function userOperationInput(
  operations = [packedUserOperation(transitionCallData)],
): Hex {
  return encodeFunctionData({
    abi: entryPoint07Abi,
    args: [operations, zeroAddress],
    functionName: "handleOps",
  });
}

function userOperationLog(userOpHash: Hash, transactionHash: Hash) {
  return {
    address: entryPoint,
    blockHash,
    blockNumber: 100n,
    data: encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "bool" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [0n, true, 1n, 1n],
    ),
    logIndex: 0,
    removed: false,
    topics: encodeEventTopics({
      abi: entryPoint07Abi,
      args: { paymaster: zeroAddress, sender: account, userOpHash },
      eventName: "UserOperationEvent",
    }),
    transactionHash,
    transactionIndex: 0,
  };
}

function accountPolicyLog() {
  return {
    address: executor,
    blockHash,
    blockNumber: 100n,
    data: encodeAbiParameters(
      [{ type: "uint64" }, { type: "bytes32" }, { type: "bytes32" }],
      [1n, policyHash, permissionHash],
    ),
    logIndex: 1,
    removed: false,
    topics: encodeEventTopics({
      abi: mandateExecutorAbi,
      args: { account, rootOwner: owner },
      eventName: "AccountPolicySet",
    }),
    transactionHash: policyTxHash,
    transactionIndex: 0,
  };
}

function client(
  currentBlock = 103n,
  operations = [packedUserOperation(transitionCallData)],
  eventUserOperationHash = expectation.userOperationHash,
): PublicClient {
  const code: Record<string, Hex> = {
    [entryPoint]: "0x01",
    [implementation]: "0x02",
    [executor]: "0x03",
    [account]: "0x04",
  };
  return {
    async getChainId() {
      return 97;
    },
    async getBlock() {
      return { hash: blockHash, timestamp: 1_790_000_000n };
    },
    async getBlockNumber() {
      return currentBlock;
    },
    async getCode({ address }: { address: Address }) {
      return code[address];
    },
    async getTransaction() {
      return {
        input: userOperationInput(operations),
        to: entryPoint,
      };
    },
    async getTransactionReceipt() {
      return {
        blockHash,
        blockNumber: 100n,
        logs: [
          userOperationLog(eventUserOperationHash, policyTxHash),
          accountPolicyLog(),
        ],
        status: "success",
        transactionHash: policyTxHash,
      };
    },
    async readContract() {
      return {
        activePolicyHash: policyHash,
        ownerEpoch: 1n,
        permissionHash,
        rootOwner: owner,
      };
    },
  } as unknown as PublicClient;
}

function verifier(
  currentBlock = 103n,
  executorCodeHash: Hash = keccak256("0x03"),
) {
  return createViemPolicyChainVerifier({
    client: client(currentBlock),
    confirmationDepth: 3,
    entryPoint,
    expectedCodeHashes: {
      [entryPoint]: keccak256("0x01"),
      [implementation]: keccak256("0x02"),
      [executor]: executorCodeHash,
    },
    implementation,
    mandateExecutor: executor,
  });
}

describe("P3-002 policy chain confirmation", () => {
  it("verifies exact confirmed UserOperations, policy event, state, and pinned code", async () => {
    await expect(verifier().verify(expectation)).resolves.toEqual({
      account,
      activePolicyHash: policyHash,
      blockNumber: 100n,
      observedAt: new Date(1_790_000_000_000),
      ownerEpoch: "1",
      permissionHash,
      rootOwner: owner,
      status: "CONFIRMED",
    });
  });

  it("keeps policy state pending before configured confirmation depth", async () => {
    await expect(verifier(101n).verify(expectation)).resolves.toEqual({
      status: "PENDING",
    });
  });

  it("rejects evidence that does not prove the exact smart-account call", async () => {
    await expect(
      verifier().verify({
        ...expectation,
        transitionCallData: "0xabcd",
      }),
    ).rejects.toThrow("lacks the expected smart-account call");
  });

  it("rejects a transaction whose event and calldata belong to different UserOperations", async () => {
    const otherCallData = "0xabcd";
    const otherUserOperationHash = userOperationHash(otherCallData);
    const splitEvidenceVerifier = createViemPolicyChainVerifier({
      client: client(
        103n,
        [
          packedUserOperation(otherCallData),
          packedUserOperation(transitionCallData, 1n),
        ],
        otherUserOperationHash,
      ),
      confirmationDepth: 3,
      entryPoint,
      expectedCodeHashes: {
        [entryPoint]: keccak256("0x01"),
        [implementation]: keccak256("0x02"),
        [executor]: keccak256("0x03"),
      },
      implementation,
      mandateExecutor: executor,
    });

    await expect(
      splitEvidenceVerifier.verify({
        ...expectation,
        userOperationHash: otherUserOperationHash,
      }),
    ).rejects.toThrow("lacks the expected smart-account call");
  });

  it("rejects drift in pinned deployment bytecode", async () => {
    await expect(
      verifier(103n, `0x${"99".repeat(32)}`).verify(expectation),
    ).rejects.toThrow(`code hash changed for ${executor}`);
  });
});
