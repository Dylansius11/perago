import { type Address, type Hash, mandateExecutorAbi } from "@perago/sdk";
import {
  decodeEventLog,
  decodeFunctionData,
  getAddress,
  type Hex,
  keccak256,
  type PublicClient,
  type TransactionReceipt,
  TransactionReceiptNotFoundError,
} from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";

import type {
  PolicyChainExpectation,
  PolicyChainObservation,
  PolicyChainVerifier,
} from "./policies.js";

type ViemPolicyChainVerifierConfig = {
  client: PublicClient;
  confirmationDepth: number;
  entryPoint: Address;
  expectedCodeHashes: Record<string, Hash>;
  implementation: Address;
  mandateExecutor: Address;
};

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertConfiguredCodePins(config: ViemPolicyChainVerifierConfig): void {
  if (
    !Number.isSafeInteger(config.confirmationDepth) ||
    config.confirmationDepth < 1
  ) {
    throw new RangeError("confirmation depth must be a positive integer");
  }
  for (const address of [
    config.entryPoint,
    config.implementation,
    config.mandateExecutor,
  ]) {
    if (!config.expectedCodeHashes[address.toLowerCase()]) {
      throw new Error(`missing expected code hash for ${address}`);
    }
  }
}

async function receiptOrPending(
  client: PublicClient,
  hash: Hash,
): Promise<TransactionReceipt | null> {
  try {
    return await client.getTransactionReceipt({ hash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return null;
    throw error;
  }
}

function assertSuccessfulUserOperation(
  receipt: TransactionReceipt,
  transactionHash: Hash,
  userOperationHash: Hash,
  account: Address,
  entryPoint: Address,
): void {
  if (!sameHex(receipt.transactionHash, transactionHash)) {
    throw new Error(`receipt does not match transaction ${transactionHash}`);
  }
  if (receipt.status !== "success") {
    throw new Error(`transaction ${transactionHash} reverted`);
  }

  const matched = receipt.logs.some((log) => {
    if (
      log.removed ||
      !sameHex(log.address, entryPoint) ||
      !sameHex(log.transactionHash, transactionHash)
    ) {
      return false;
    }
    try {
      const decoded = decodeEventLog({
        abi: entryPoint07Abi,
        data: log.data,
        topics: log.topics,
      });
      return (
        decoded.eventName === "UserOperationEvent" &&
        sameHex(decoded.args.userOpHash, userOperationHash) &&
        sameHex(decoded.args.sender, account) &&
        decoded.args.success
      );
    } catch {
      return false;
    }
  });
  if (!matched) {
    throw new Error(
      `transaction ${transactionHash} lacks the expected successful UserOperation`,
    );
  }
}

async function assertExactUserOperationCall(
  client: PublicClient,
  transactionHash: Hash,
  account: Address,
  expectedCallData: Hex,
  entryPoint: Address,
): Promise<void> {
  const transaction = await client.getTransaction({ hash: transactionHash });
  if (!transaction.to || !sameHex(transaction.to, entryPoint)) {
    throw new Error(
      `transaction ${transactionHash} did not call the pinned EntryPoint`,
    );
  }

  try {
    const decoded = decodeFunctionData({
      abi: entryPoint07Abi,
      data: transaction.input,
    });
    if (decoded.functionName !== "handleOps") {
      throw new Error(`transaction ${transactionHash} did not call handleOps`);
    }
    const [operations] = decoded.args;
    const matched = operations.some(
      (operation) =>
        sameHex(operation.sender, account) &&
        sameHex(operation.callData, expectedCallData),
    );
    if (!matched) {
      throw new Error(
        `transaction ${transactionHash} lacks the expected smart-account call`,
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`transaction ${transactionHash}`)
    ) {
      throw error;
    }
    throw new Error(
      `transaction ${transactionHash} is not valid EntryPoint calldata`,
    );
  }
}

function assertPolicyEvent(
  receipt: TransactionReceipt,
  expectation: PolicyChainExpectation,
  mandateExecutor: Address,
): void {
  const matched = receipt.logs.some((log) => {
    if (
      log.removed ||
      !sameHex(log.address, mandateExecutor) ||
      !sameHex(log.transactionHash, expectation.transactionHash)
    ) {
      return false;
    }
    try {
      const decoded = decodeEventLog({
        abi: mandateExecutorAbi,
        data: log.data,
        topics: log.topics,
      });
      return (
        decoded.eventName === "AccountPolicySet" &&
        sameHex(decoded.args.account, expectation.account) &&
        sameHex(decoded.args.rootOwner, expectation.rootOwner) &&
        decoded.args.ownerEpoch === BigInt(expectation.ownerEpoch) &&
        sameHex(decoded.args.policyHash, expectation.activePolicyHash) &&
        sameHex(decoded.args.permissionHash, expectation.permissionHash)
      );
    } catch {
      return false;
    }
  });
  if (!matched) {
    throw new Error(
      "policy transaction lacks the exact AccountPolicySet event",
    );
  }
}

async function assertPinnedCode(
  client: PublicClient,
  config: ViemPolicyChainVerifierConfig,
  account: Address,
  blockNumber: bigint,
): Promise<void> {
  const accountCode = await client.getCode({ address: account, blockNumber });
  if (!accountCode || accountCode === "0x") {
    throw new Error("smart account has no code at the confirmation block");
  }

  for (const [rawAddress, expectedHash] of Object.entries(
    config.expectedCodeHashes,
  )) {
    const address = getAddress(rawAddress);
    const code = await client.getCode({ address, blockNumber });
    if (!code || code === "0x" || !sameHex(keccak256(code), expectedHash)) {
      throw new Error(`code hash changed for ${address}`);
    }
  }
}

async function assertCanonicalReceipt(
  client: PublicClient,
  receipt: TransactionReceipt,
): Promise<void> {
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  if (!block.hash || !sameHex(block.hash, receipt.blockHash)) {
    throw new Error(
      `receipt block ${receipt.blockNumber} is no longer canonical`,
    );
  }
}

export function createViemPolicyChainVerifier(
  config: ViemPolicyChainVerifierConfig,
): PolicyChainVerifier {
  const normalizedConfig = {
    ...config,
    entryPoint: getAddress(config.entryPoint).toLowerCase() as Address,
    expectedCodeHashes: Object.fromEntries(
      Object.entries(config.expectedCodeHashes).map(([address, hash]) => [
        getAddress(address).toLowerCase(),
        hash,
      ]),
    ),
    implementation: getAddress(config.implementation).toLowerCase() as Address,
    mandateExecutor: getAddress(
      config.mandateExecutor,
    ).toLowerCase() as Address,
  };
  assertConfiguredCodePins(normalizedConfig);

  return {
    async verify(expectation): Promise<PolicyChainObservation> {
      const chainId = await normalizedConfig.client.getChainId();
      if (chainId !== Number(expectation.chainId)) {
        throw new Error("policy evidence is from the wrong chain");
      }

      const receipt = await receiptOrPending(
        normalizedConfig.client,
        expectation.transactionHash,
      );
      if (!receipt) return { status: "PENDING" };

      const currentBlock = await normalizedConfig.client.getBlockNumber();
      const requiredDepth = BigInt(normalizedConfig.confirmationDepth);
      if (currentBlock - receipt.blockNumber + 1n < requiredDepth) {
        return { status: "PENDING" };
      }

      await assertCanonicalReceipt(normalizedConfig.client, receipt);
      assertSuccessfulUserOperation(
        receipt,
        expectation.transactionHash,
        expectation.userOperationHash,
        expectation.account,
        normalizedConfig.entryPoint,
      );
      await assertExactUserOperationCall(
        normalizedConfig.client,
        expectation.transactionHash,
        expectation.account,
        expectation.transitionCallData,
        normalizedConfig.entryPoint,
      );
      assertPolicyEvent(receipt, expectation, normalizedConfig.mandateExecutor);

      const blockNumber = receipt.blockNumber;
      await assertPinnedCode(
        normalizedConfig.client,
        normalizedConfig,
        expectation.account,
        blockNumber,
      );
      const accountConfig = await normalizedConfig.client.readContract({
        abi: mandateExecutorAbi,
        address: normalizedConfig.mandateExecutor,
        args: [expectation.account],
        blockNumber,
        functionName: "accountConfig",
      });
      if (
        !sameHex(accountConfig.rootOwner, expectation.rootOwner) ||
        accountConfig.ownerEpoch !== BigInt(expectation.ownerEpoch) ||
        !sameHex(
          accountConfig.activePolicyHash,
          expectation.activePolicyHash,
        ) ||
        !sameHex(accountConfig.permissionHash, expectation.permissionHash)
      ) {
        throw new Error(
          "confirmed account policy state does not match the transition",
        );
      }

      const block = await normalizedConfig.client.getBlock({ blockNumber });
      return {
        account: expectation.account,
        activePolicyHash: expectation.activePolicyHash,
        blockNumber,
        observedAt: new Date(Number(block.timestamp) * 1_000),
        ownerEpoch: expectation.ownerEpoch,
        permissionHash: expectation.permissionHash,
        rootOwner: expectation.rootOwner,
        status: "CONFIRMED",
      };
    },
  };
}
