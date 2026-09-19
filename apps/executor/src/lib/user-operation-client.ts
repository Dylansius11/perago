import {
  buildUserOperationNonceKey,
  encodeSemiModularAccountFactoryData,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  packUserOperationSignature,
} from "@perago/sdk";
import type { Address, Hex, PublicClient } from "viem";
import { numberToHex } from "viem";
import {
  entryPoint07Abi,
  getUserOperationHash,
  type UserOperation,
} from "viem/account-abstraction";
import type { PrivateKeyAccount } from "viem/accounts";

import { short } from "./environment.ts";

const MAX_FEE_PER_GAS = 1_500_000_000n;
const MAX_PRIORITY_FEE_PER_GAS = 1_000_000_000n;
const RECEIPT_POLL_ATTEMPTS = 60;
const RECEIPT_POLL_INTERVAL_MS = 3_000;
const EFFICIENCY_RETRIES = 5;

/** Placeholder limits used only for the bundler estimation request. */
const ESTIMATION_GAS = {
  callGasLimit: 500_000n,
  preVerificationGas: 150_000n,
  verificationGasLimit: 900_000n,
} as const;

/** A structurally valid signature used only for bundler gas estimation. */
const DUMMY_SIGNATURE = packUserOperationSignature(
  `0x${"11".repeat(32)}${"22".repeat(32)}1c`,
);

/** The bundler enforces a minimum limit efficiency, so the buffer stays small. */
function withBuffer(estimate: Hex): bigint {
  return (BigInt(estimate) * 115n) / 100n;
}

type RpcUserOperation = Record<string, Hex>;

type GasOverrides = {
  callGasLimit?: bigint;
  preVerificationGas?: bigint;
  verificationGasLimit?: bigint;
};

type EfficiencyComplaint = {
  actual: number;
  key: "callGasLimit" | "verificationGasLimit";
  required: number;
};

export type SubmittedUserOperation = {
  actualGasCost: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  userOpHash: Hex;
};

export type SubmitParams = {
  /** Account call data, already encoded for the smart account. */
  callData: Hex;
  /** Validation entity: `0` is the root owner, any other id is a session. */
  entityId: number;
  /** Global validation is the account-wide root path; sessions are selector-scoped. */
  isGlobalValidation: boolean;
  signer: PrivateKeyAccount;
  /** Requests Alchemy Bundler Sponsored Operations for this submission. */
  sponsored?: boolean;
  /** Deploys the account in the same operation. */
  withFactory?: boolean;
};

export type UserOperationClient = {
  /** Raw bundler JSON-RPC call, used for capability checks. */
  rpc: (
    method: string,
    params: unknown[],
    sponsored?: boolean,
  ) => Promise<unknown>;
  /** Builds, signs, submits, and waits for a mined UserOperation receipt. */
  submit: (params: SubmitParams) => Promise<SubmittedUserOperation>;
};

export type UserOperationClientConfig = {
  account: Address;
  bundlerRpc: string;
  chainId: number;
  client: PublicClient;
  /** Root owner of the semi-modular account, used for factory data and root signing. */
  owner: Address;
  /** Alchemy Gas Manager policy used only when a submission requests sponsorship. */
  policyId?: string;
};

/**
 * The bundler rejects a UserOperation whose gas limits exceed its measured use
 * by too much. Its error names the offending limit and both ratios.
 */
function parseEfficiencyComplaint(
  error: unknown,
): EfficiencyComplaint | undefined {
  const match =
    /(Verification|Call) gas limit efficiency too low\. Required: ([\d.]+), Actual: ([\d.]+)/.exec(
      error instanceof Error ? error.message : String(error),
    );
  if (!match) {
    return undefined;
  }
  return {
    actual: Number(match[3]),
    key: match[1] === "Verification" ? "verificationGasLimit" : "callGasLimit",
    required: Number(match[2]),
  };
}

function toRpc(userOperation: UserOperation<"0.7">): RpcUserOperation {
  const rpc: RpcUserOperation = {
    callData: userOperation.callData,
    callGasLimit: numberToHex(userOperation.callGasLimit),
    maxFeePerGas: numberToHex(userOperation.maxFeePerGas),
    maxPriorityFeePerGas: numberToHex(userOperation.maxPriorityFeePerGas),
    nonce: numberToHex(userOperation.nonce),
    preVerificationGas: numberToHex(userOperation.preVerificationGas),
    sender: userOperation.sender,
    signature: userOperation.signature,
    verificationGasLimit: numberToHex(userOperation.verificationGasLimit),
  };
  if (userOperation.factory && userOperation.factoryData) {
    rpc.factory = userOperation.factory;
    rpc.factoryData = userOperation.factoryData;
  }
  return rpc;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Submits Perago UserOperations through one bundler for a single smart account.
 * It owns nonce keys, gas estimation, efficiency retries, and receipt polling so
 * probes and the executor never re-implement ERC-4337 plumbing.
 */
export function createUserOperationClient(
  config: UserOperationClientConfig,
): UserOperationClient {
  const entryPoint = MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint;

  async function rpc(
    method: string,
    params: unknown[],
    sponsored = false,
  ): Promise<unknown> {
    const response = await fetch(config.bundlerRpc, {
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
      headers: {
        "content-type": "application/json",
        ...(sponsored && config.policyId
          ? { "x-alchemy-policy-id": config.policyId }
          : {}),
      },
      method: "POST",
    });
    const payload = (await response.json()) as {
      error?: unknown;
      result?: unknown;
    };
    if (payload.error) {
      throw new Error(short(payload.error));
    }
    return payload.result;
  }

  async function build(
    params: SubmitParams & { overrides: GasOverrides },
  ): Promise<UserOperation<"0.7">> {
    const nonce = await config.client.readContract({
      abi: entryPoint07Abi,
      address: entryPoint,
      args: [
        config.account,
        buildUserOperationNonceKey({
          entityId: params.entityId,
          isGlobalValidation: params.isGlobalValidation,
        }),
      ],
      functionName: "getNonce",
    });

    const draft: UserOperation<"0.7"> = {
      callData: params.callData,
      nonce,
      sender: config.account,
      signature: DUMMY_SIGNATURE,
      ...ESTIMATION_GAS,
      // A sponsored operation carries zero fees; the paymaster funds execution.
      ...(params.sponsored
        ? { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }
        : {
            maxFeePerGas: MAX_FEE_PER_GAS,
            maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS,
          }),
      ...(params.withFactory
        ? {
            factory: MODULAR_ACCOUNT_V2_ADDRESSES.factory,
            factoryData: encodeSemiModularAccountFactoryData({
              owner: config.owner,
            }),
          }
        : {}),
    };

    // The bundler rejects over-provisioned limits, so the estimate is authoritative.
    const estimate = (await rpc(
      "eth_estimateUserOperationGas",
      [toRpc(draft), entryPoint],
      params.sponsored,
    )) as {
      callGasLimit: Hex;
      preVerificationGas: Hex;
      verificationGasLimit: Hex;
    };

    const unsigned: UserOperation<"0.7"> = {
      ...draft,
      callGasLimit:
        params.overrides.callGasLimit ?? withBuffer(estimate.callGasLimit),
      preVerificationGas:
        params.overrides.preVerificationGas ??
        withBuffer(estimate.preVerificationGas),
      signature: "0x",
      verificationGasLimit:
        params.overrides.verificationGasLimit ??
        withBuffer(estimate.verificationGasLimit),
    };

    const hash = getUserOperationHash({
      chainId: config.chainId,
      entryPointAddress: entryPoint,
      entryPointVersion: "0.7",
      userOperation: unsigned,
    });

    return {
      ...unsigned,
      signature: packUserOperationSignature(
        await params.signer.signMessage({ message: { raw: hash } }),
      ),
    };
  }

  async function send(
    userOperation: UserOperation<"0.7">,
    sponsored: boolean,
  ): Promise<SubmittedUserOperation> {
    const userOpHash = (await rpc(
      "eth_sendUserOperation",
      [toRpc(userOperation), entryPoint],
      sponsored,
    )) as Hex;

    for (let attempt = 0; attempt < RECEIPT_POLL_ATTEMPTS; attempt += 1) {
      const receipt = (await rpc("eth_getUserOperationReceipt", [
        userOpHash,
      ])) as {
        actualGasCost: Hex;
        receipt: { blockNumber: Hex; transactionHash: Hex };
        success: boolean;
      } | null;
      if (receipt) {
        if (!receipt.success) {
          throw new Error(
            `UserOperation ${userOpHash} executed but reverted in ${receipt.receipt.transactionHash}`,
          );
        }
        return {
          actualGasCost: BigInt(receipt.actualGasCost),
          blockNumber: BigInt(receipt.receipt.blockNumber),
          transactionHash: receipt.receipt.transactionHash,
          userOpHash,
        };
      }
      await delay(RECEIPT_POLL_INTERVAL_MS);
    }
    throw new Error(`UserOperation ${userOpHash} was never mined`);
  }

  async function submit(params: SubmitParams): Promise<SubmittedUserOperation> {
    const overrides: GasOverrides = {};
    for (let attempt = 0; attempt < EFFICIENCY_RETRIES; attempt += 1) {
      const userOperation = await build({ ...params, overrides });
      try {
        return await send(userOperation, params.sponsored ?? false);
      } catch (error) {
        const complaint = parseEfficiencyComplaint(error);
        if (!complaint) {
          throw error;
        }
        // Target the middle of the accepted band so one retry usually suffices.
        const current = userOperation[complaint.key];
        overrides[complaint.key] =
          BigInt(
            Math.ceil(
              (Number(current) * complaint.actual) / (complaint.required * 1.3),
            ),
          ) + 1n;
      }
    }
    throw new Error(
      "the bundler kept rejecting the estimated gas limits as inefficient",
    );
  }

  return { rpc, submit };
}
