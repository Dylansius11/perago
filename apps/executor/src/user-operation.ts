import {
  buildUserOperation,
  buildUserOperationNonceKey,
  type ExecutionJob,
  encodeHandleOps,
  encodeSessionPerformCallData,
  executionProofSchema,
  getExecutionProofTypedData,
  type Hash,
  hashUserOperation,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  packUserOperationSignature,
} from "@perago/sdk";
import type { Hex, LocalAccount, PublicClient } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";

/**
 * The executor's one session UserOperation for a mandate: the account calls
 * `MandateExecutor.perform` and nothing else. It is deterministic for a given
 * chain state - the EntryPoint nonce, the proof lifetime derived from the
 * onchain start time, fixed gas limits, zero fees, and RFC 6979 signatures -
 * so rebuilding after a dropped transaction yields the same UserOperation hash.
 */
export async function buildPerformUserOperation(input: {
  client: PublicClient;
  executor: LocalAccount;
  job: ExecutionJob;
  executionStartedAt: bigint;
  executionWindowSeconds: bigint;
}): Promise<{ userOperationHash: Hash; handleOpsData: Hex }> {
  const { client, executor, job } = input;
  const { domain, message } = job.document;

  const expiresAt = BigInt(message.expiresAt);
  const windowEnd = input.executionStartedAt + input.executionWindowSeconds;
  const proof = executionProofSchema.parse({
    account: message.account,
    executor: executor.address,
    mandateHash: job.mandateHash,
    validUntil: String(windowEnd < expiresAt ? windowEnd : expiresAt),
  });
  const proofSignature = await executor.signTypedData(
    getExecutionProofTypedData(proof, domain),
  );

  const nonce = await client.readContract({
    abi: entryPoint07Abi,
    address: MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint,
    args: [
      message.account,
      buildUserOperationNonceKey({
        entityId: job.session.entityId,
        isGlobalValidation: false,
      }),
    ],
    functionName: "getNonce",
  });

  const unsigned = buildUserOperation({
    callData: encodeSessionPerformCallData({
      action: job.action,
      document: job.document,
      proof,
      proofSignature,
    }),
    nonce,
    sender: message.account,
  });
  const userOperationHash = hashUserOperation(unsigned, Number(domain.chainId));
  const signed = {
    ...unsigned,
    signature: packUserOperationSignature(
      await executor.signMessage({ message: { raw: userOperationHash } }),
    ),
  };

  return {
    handleOpsData: encodeHandleOps([signed], executor.address),
    userOperationHash,
  };
}
