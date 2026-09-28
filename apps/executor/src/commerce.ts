import {
  type Address,
  apexCommerceAbi,
  assertCommerceJobIdentity,
  assertSubmittedCommerceJob,
  type CommerceJob,
  CommerceJobMismatchError,
  outcomeEvaluatorAbi,
  type SettlementDeployment,
} from "@perago/sdk";
import { getAddress, type Hex, keccak256, type PublicClient } from "viem";

const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const COMMERCE_STATUSES = [
  "Open",
  "Funded",
  "Submitted",
  "Completed",
  "Rejected",
  "Expired",
] as const;

type CommerceStatus = (typeof COMMERCE_STATUSES)[number];
export type CommerceView = {
  status: CommerceStatus;
  refundable: boolean;
  valid: boolean;
  expiredAt: bigint;
};

type Pin = { address: Address; codeHash: Hex };
type ProxyPin = Pin & { implementation: Address; implementationCodeHash: Hex };

const sameAddress = (left: Address, right: Address) =>
  left.toLowerCase() === right.toLowerCase();

async function assertPinnedCode(
  client: PublicClient,
  pin: Pin,
  blockNumber: bigint,
): Promise<void> {
  const code = await client.getCode({ address: pin.address, blockNumber });
  if (!code || code === "0x" || keccak256(code) !== pin.codeHash) {
    throw new Error(`pinned code drifted at ${pin.address}`);
  }
}

async function assertPinnedProxy(
  client: PublicClient,
  pin: ProxyPin,
  blockNumber: bigint,
): Promise<void> {
  await assertPinnedCode(client, pin, blockNumber);
  const implementation = await client.getStorageAt({
    address: pin.address,
    slot: EIP1967_IMPLEMENTATION_SLOT,
    blockNumber,
  });
  if (!implementation || implementation.length !== 66) {
    throw new Error(`pinned proxy implementation missing at ${pin.address}`);
  }
  if (
    !sameAddress(
      getAddress(`0x${implementation.slice(-40)}`),
      pin.implementation,
    )
  ) {
    throw new Error(`pinned proxy implementation drifted at ${pin.address}`);
  }
  await assertPinnedCode(
    client,
    {
      address: pin.implementation,
      codeHash: pin.implementationCodeHash,
    },
    blockNumber,
  );
}

/**
 * Reads the evaluator and APEX job at one block. Deployment drift is fatal;
 * mutable job mismatches only make the job ineligible for authority consumption.
 */
export async function readCommerceView(input: {
  client: PublicClient;
  settlement: SettlementDeployment;
  executor: Address;
  account: Address;
  jobId: bigint;
  blockNumber: bigint;
  mandateExpiresAt: bigint;
  executionWindowSeconds: bigint;
  now: bigint;
}): Promise<CommerceView> {
  const {
    client,
    settlement,
    executor,
    account,
    jobId,
    blockNumber,
    mandateExpiresAt,
    executionWindowSeconds,
    now,
  } = input;
  const at = { blockNumber };
  const [
    evaluatorExecutor,
    evaluatorCommerce,
    evaluatorProvider,
    evaluatorHook,
    evaluatorPaymentToken,
    commercePaymentToken,
    rawJob,
    actualPaymentToken,
    platformFeeBP,
  ] = await Promise.all([
    assertPinnedCode(client, settlement.evaluator, blockNumber).then(() =>
      client.readContract({
        ...at,
        abi: outcomeEvaluatorAbi,
        address: settlement.evaluator.address,
        functionName: "executor",
      }),
    ),
    client.readContract({
      ...at,
      abi: outcomeEvaluatorAbi,
      address: settlement.evaluator.address,
      functionName: "commerce",
    }),
    client.readContract({
      ...at,
      abi: outcomeEvaluatorAbi,
      address: settlement.evaluator.address,
      functionName: "provider",
    }),
    client.readContract({
      ...at,
      abi: outcomeEvaluatorAbi,
      address: settlement.evaluator.address,
      functionName: "hook",
    }),
    client.readContract({
      ...at,
      abi: outcomeEvaluatorAbi,
      address: settlement.evaluator.address,
      functionName: "paymentToken",
    }),
    assertPinnedProxy(client, settlement.commerce, blockNumber).then(() =>
      client.readContract({
        ...at,
        abi: apexCommerceAbi,
        address: settlement.commerce.address,
        functionName: "paymentToken",
      }),
    ),
    client.readContract({
      ...at,
      abi: apexCommerceAbi,
      address: settlement.commerce.address,
      args: [jobId],
      functionName: "getJob",
    }),
    client.readContract({
      ...at,
      abi: apexCommerceAbi,
      address: settlement.commerce.address,
      args: [jobId],
      functionName: "jobPaymentToken",
    }),
    client.readContract({
      ...at,
      abi: apexCommerceAbi,
      address: settlement.commerce.address,
      functionName: "platformFeeBP",
    }),
    assertPinnedProxy(client, settlement.paymentToken, blockNumber),
    assertPinnedCode(client, settlement.hook, blockNumber),
  ]);

  if (
    !sameAddress(evaluatorExecutor, executor) ||
    !sameAddress(evaluatorCommerce, settlement.commerce.address) ||
    !sameAddress(evaluatorProvider, settlement.provider) ||
    !sameAddress(evaluatorHook, settlement.hook.address) ||
    !sameAddress(evaluatorPaymentToken, settlement.paymentToken.address) ||
    !sameAddress(commercePaymentToken, settlement.paymentToken.address)
  ) {
    throw new Error("pinned evaluator wiring drifted");
  }

  const status = COMMERCE_STATUSES[Number(rawJob.status)];
  if (!status) throw new Error(`unknown commerce job status ${rawJob.status}`);
  const job: CommerceJob = {
    id: rawJob.id,
    client: rawJob.client,
    provider: rawJob.provider,
    evaluator: rawJob.evaluator,
    hook: rawJob.hook,
    budget: rawJob.budget,
    status: Number(rawJob.status),
    expiredAt: rawJob.expiredAt,
  };

  const preflight = {
    job,
    jobId,
    account,
    provider: settlement.provider,
    evaluator: settlement.evaluator.address,
    hook: settlement.hook.address,
    paymentToken: settlement.paymentToken.address,
    actualPaymentToken,
    platformFeeBP,
    mandateExpiresAt,
    executionWindowSeconds,
    now,
  };
  let refundable = true;
  try {
    assertCommerceJobIdentity(preflight);
  } catch (error) {
    if (!(error instanceof CommerceJobMismatchError)) throw error;
    refundable = false;
  }
  let valid = refundable;
  if (refundable) {
    try {
      if (status === "Submitted") assertSubmittedCommerceJob(preflight);
      else if (status === "Funded" && job.expiredAt <= now) valid = false;
    } catch (error) {
      if (!(error instanceof CommerceJobMismatchError)) throw error;
      valid = false;
    }
  }
  return { status, valid, refundable, expiredAt: job.expiredAt };
}
