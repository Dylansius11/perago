import {
  apexCommerceAbi,
  assertSubmittedCommerceJob,
  CommerceJobMismatchError,
  outcomeEvaluatorAbi,
  type SettlementDeployment,
} from "@perago/sdk";
import {
  type Address,
  keccak256,
  type PublicClient,
  stringToHex,
  toHex,
} from "viem";

import { ReasonError } from "../errors.js";

const IMPLEMENTATION_SLOT = toHex(
  BigInt(keccak256(stringToHex("eip1967.proxy.implementation"))) - 1n,
  { size: 32 },
);

export type SubmittedCommerceBinding = {
  commerceContract: Address;
  commerceJobId: string;
};

/** The reviewed deployment and job are read at the same pinned chain block. */
export async function readSubmittedCommerceJob(input: {
  client: PublicClient;
  settlement: SettlementDeployment;
  executor: Address;
  account: Address;
  jobId: bigint;
  blockNumber: bigint;
  mandateExpiresAt: bigint;
  executionWindowSeconds: bigint;
  now: bigint;
}): Promise<SubmittedCommerceBinding> {
  const { client, settlement, blockNumber } = input;
  for (const target of [
    settlement.evaluator,
    settlement.commerce,
    settlement.paymentToken,
    settlement.hook,
  ]) {
    const bytecode = await client.getCode({
      address: target.address,
      blockNumber,
    });
    if (!bytecode || keccak256(bytecode) !== target.codeHash)
      throw new ReasonError(
        "DEPLOYMENT_MISMATCH",
        "commerce deployment code hash changed",
      );
  }
  for (const proxy of [settlement.commerce, settlement.paymentToken]) {
    const slot = await client.getStorageAt({
      address: proxy.address,
      slot: IMPLEMENTATION_SLOT,
      blockNumber,
    });
    if (!slot || BigInt(slot) !== BigInt(proxy.implementation))
      throw new ReasonError(
        "DEPLOYMENT_MISMATCH",
        "commerce proxy implementation changed",
      );
    const bytecode = await client.getCode({
      address: proxy.implementation,
      blockNumber,
    });
    if (!bytecode || keccak256(bytecode) !== proxy.implementationCodeHash)
      throw new ReasonError(
        "DEPLOYMENT_MISMATCH",
        "commerce implementation code hash changed",
      );
  }

  for (const [functionName, expected] of [
    ["executor", input.executor],
    ["commerce", settlement.commerce.address],
    ["provider", settlement.provider],
    ["hook", settlement.hook.address],
    ["paymentToken", settlement.paymentToken.address],
  ] as const) {
    const actual = await client.readContract({
      abi: outcomeEvaluatorAbi,
      address: settlement.evaluator.address,
      blockNumber,
      functionName,
    });
    if (actual.toLowerCase() !== expected.toLowerCase())
      throw new ReasonError(
        "DEPLOYMENT_MISMATCH",
        `commerce evaluator ${functionName} changed`,
      );
  }

  const job = await client.readContract({
    abi: apexCommerceAbi,
    address: settlement.commerce.address,
    args: [input.jobId],
    blockNumber,
    functionName: "getJob",
  });
  const actualPaymentToken = await client.readContract({
    abi: apexCommerceAbi,
    address: settlement.commerce.address,
    args: [input.jobId],
    blockNumber,
    functionName: "jobPaymentToken",
  });
  const platformFeeBP = await client.readContract({
    abi: apexCommerceAbi,
    address: settlement.commerce.address,
    blockNumber,
    functionName: "platformFeeBP",
  });
  try {
    assertSubmittedCommerceJob({
      job,
      jobId: input.jobId,
      account: input.account,
      provider: settlement.provider,
      evaluator: settlement.evaluator.address,
      hook: settlement.hook.address,
      paymentToken: settlement.paymentToken.address,
      actualPaymentToken,
      platformFeeBP,
      mandateExpiresAt: input.mandateExpiresAt,
      executionWindowSeconds: input.executionWindowSeconds,
      now: input.now,
    });
  } catch (error) {
    if (error instanceof CommerceJobMismatchError)
      throw new ReasonError("COMMERCE_JOB_INVALID", error.message);
    throw error;
  }
  return {
    commerceContract: settlement.commerce.address,
    commerceJobId: input.jobId.toString(),
  };
}
