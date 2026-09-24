import { type Address, encodeFunctionData, type Hash, type Hex } from "viem";
import {
  entryPoint07Abi,
  getUserOperationHash,
  toPackedUserOperation,
  type UserOperation,
} from "viem/account-abstraction";

import { mandateExecutorAbi } from "../abi/perago-contracts.js";
import {
  type ExecutionProof,
  getTaskMandateTypedData,
  type SignedMandateDocument,
} from "../eip712.js";
import {
  encodeAccountExecute,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  wrapExecuteUserOp,
} from "./modular-account.js";

/**
 * Fixed limits for every Perago UserOperation. Fees are zero: the address that
 * calls `EntryPoint.handleOps` pays the outer transaction, so the account never
 * prefunds gas and a session's native spend limit is never touched by fees.
 * `callGasLimit` covers the heaviest action, a first stake that deploys the
 * recipient's position holder.
 */
export const PERAGO_USER_OPERATION_GAS = {
  callGasLimit: 3_000_000n,
  verificationGasLimit: 1_000_000n,
  preVerificationGas: 100_000n,
} as const;

/** An unsigned EntryPoint v0.7 UserOperation with Perago's fixed limits. */
export function buildUserOperation(input: {
  sender: Address;
  nonce: bigint;
  callData: Hex;
}): UserOperation<"0.7"> {
  if (input.nonce < 0n) throw new RangeError("nonce must be unsigned");
  return {
    callData: input.callData,
    callGasLimit: PERAGO_USER_OPERATION_GAS.callGasLimit,
    maxFeePerGas: 0n,
    maxPriorityFeePerGas: 0n,
    nonce: input.nonce,
    preVerificationGas: PERAGO_USER_OPERATION_GAS.preVerificationGas,
    sender: input.sender,
    signature: "0x",
    verificationGasLimit: PERAGO_USER_OPERATION_GAS.verificationGasLimit,
  };
}

/** The ERC-4337 hash an account validator signs, bound to chain and EntryPoint. */
export function hashUserOperation(
  userOperation: UserOperation<"0.7">,
  chainId: number,
): Hash {
  return getUserOperationHash({
    chainId,
    entryPointAddress: MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint,
    entryPointVersion: "0.7",
    userOperation,
  });
}

/** `EntryPoint.handleOps` call data for UserOperations paid by `beneficiary`. */
export function encodeHandleOps(
  userOperations: readonly UserOperation<"0.7">[],
  beneficiary: Address,
): Hex {
  return encodeFunctionData({
    abi: entryPoint07Abi,
    args: [
      userOperations.map((entry) => toPackedUserOperation(entry)),
      beneficiary,
    ],
    functionName: "handleOps",
  });
}

/**
 * The only call a Perago session UserOperation makes: the account calls
 * `MandateExecutor.perform` with the signed mandate, its action bytes, and the
 * executor's proof. Wrapped in `executeUserOp` because the session validation
 * owns execution hooks.
 */
export function encodeSessionPerformCallData(input: {
  document: SignedMandateDocument;
  action: Hex;
  proof: ExecutionProof;
  proofSignature: Hex;
}): Hex {
  const { message } = getTaskMandateTypedData(
    input.document.message,
    input.document.domain,
  );
  return wrapExecuteUserOp(
    encodeAccountExecute({
      data: encodeFunctionData({
        abi: mandateExecutorAbi,
        args: [
          message,
          input.action,
          {
            ...input.proof,
            validUntil: Number(input.proof.validUntil),
          },
          input.proofSignature,
        ],
        functionName: "perform",
      }),
      target: input.document.domain.verifyingContract,
      value: 0n,
    }),
  );
}
