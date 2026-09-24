import {
  type Address,
  cakeStakeAdapterAbi,
  cakeStakePositionAbi,
  getExecutionProofTypedData,
  getTaskMandateTypedData,
  type Hash,
  mandateExecutorAbi,
  mandateSimulationHarnessAbi,
  mandateSimulationHarnessRuntime,
  pancakeV3SwapAdapterAbi,
  stakeVerifierAbi,
  swapVerifierAbi,
  type TaskMandate,
} from "@perago/sdk";
import {
  BaseError,
  decodeErrorResult,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  HttpRequestError,
  hashTypedData,
  keccak256,
  type PublicClient,
  stringToHex,
  TimeoutError,
  toHex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import type { PinnedBlock } from "./context.js";

/** `_mandates` storage slot of MandateExecutor (`forge inspect ... storageLayout`). */
const MANDATES_SLOT = 2n;
/** `PeragoTypes.MandateStatus.EXECUTING`. */
const EXECUTING = 2n;
const STATUS_NAMES = [
  "NONE",
  "AUTHORIZED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REVOKED",
  "EXPIRED",
] as const;
const RUN_GAS = 30_000_000n;
const PROOF_LIFETIME_SECONDS = 300n;

/**
 * A pre-signature mandate cannot yet commit its own simulation hash, so the
 * simulated mandate carries this fixed placeholder; acceptance re-runs the path
 * with the real, signed hash.
 */
export const SIMULATION_HASH_PLACEHOLDER = keccak256(
  stringToHex("perago.simulation.pending.v1"),
);

const revertAbi = [
  ...mandateSimulationHarnessAbi,
  ...mandateExecutorAbi,
  ...pancakeV3SwapAdapterAbi,
  ...swapVerifierAbi,
  ...cakeStakeAdapterAbi,
  ...cakeStakePositionAbi,
  ...stakeVerifierAbi,
].filter((item) => item.type === "error");

export type ExactPathObservation = {
  allowanceAfter: bigint;
  failureReasonHash: Hash;
  gasUsed: bigint;
  inputBalanceAfter: bigint;
  inputBalanceBefore: bigint;
  outcomeAfter: bigint;
  outcomeBefore: bigint;
  status: (typeof STATUS_NAMES)[number];
  verificationHash: Hash;
};

export type ExactPathOutcome =
  | { kind: "OBSERVED"; observation: ExactPathObservation }
  | { kind: "REVERTED"; detail: string | null; reason: string };

/** The six record words `authorize` and `beginExecution` would have written. */
export function executingRecordOverride(input: {
  account: Address;
  adapter: Address;
  commerceContract: Address;
  commerceJobId: bigint;
  executor: Address;
  expiresAt: bigint;
  mandateHash: Hash;
  startedAt: bigint;
  verifier: Address;
}): { slot: Hex; value: Hex }[] {
  const base = BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "uint256" }],
        [input.mandateHash, MANDATES_SLOT],
      ),
    ),
  );
  const words = [
    BigInt(input.account) | (input.expiresAt << 160n) | (EXECUTING << 208n),
    BigInt(input.executor) | (input.startedAt << 160n),
    BigInt(input.adapter),
    BigInt(input.verifier),
    BigInt(input.commerceContract),
    input.commerceJobId,
  ];
  return words.map((word, offset) => ({
    slot: toHex(base + BigInt(offset), { size: 32 }),
    value: toHex(word, { size: 32 }),
  }));
}

function hasRevertData(value: unknown): value is { data: Hex } {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "string" &&
    value.data.startsWith("0x")
  );
}

/** Transport failures are not simulation results: they must surface, not be recorded. */
export function isTransportError(error: unknown): boolean {
  return (
    error instanceof BaseError &&
    error.walk(
      (cause) =>
        cause instanceof HttpRequestError || cause instanceof TimeoutError,
    ) !== null
  );
}

function revertOf(error: unknown): { detail: string | null; reason: string } {
  const carrier = error instanceof BaseError ? error.walk(hasRevertData) : null;
  const data = hasRevertData(carrier) ? carrier.data : undefined;
  if (!data || data === "0x") {
    return { detail: null, reason: "reverted without data" };
  }
  try {
    const decoded = decodeErrorResult({ abi: revertAbi, data });
    const args = decoded.args?.map(String).join(", ") ?? "";
    return {
      detail: args.length > 0 ? args.slice(0, 500) : null,
      reason: decoded.errorName,
    };
  } catch {
    return { detail: data.slice(0, 500), reason: "unrecognized revert" };
  }
}

/**
 * Runs the account's exact execution calls - approve the signed input to
 * MandateExecutor, then `perform` - at one pinned block, from the account
 * address, against the real executor, adapter, verifier, and protocol. The only
 * injected state is the `EXECUTING` record for a one-off simulation executor
 * key; the harness fails closed if that record is not where the executor reads.
 */
export async function runExactPath(input: {
  action: Hex;
  block: PinnedBlock;
  client: PublicClient;
  executor: Address;
  mandate: TaskMandate;
  verifier: Address;
}): Promise<ExactPathOutcome> {
  const { action, block, client, executor, mandate, verifier } = input;
  const domain = { chainId: mandate.chainId, verifyingContract: executor };
  const typedMandate = getTaskMandateTypedData(mandate, domain);
  const mandateHash = hashTypedData(typedMandate);
  const simulationExecutor = privateKeyToAccount(generatePrivateKey());
  const proof = {
    mandateHash,
    account: mandate.account,
    executor: simulationExecutor.address,
    validUntil: String(block.timestamp + PROOF_LIFETIME_SECONDS),
  };
  const typedProof = getExecutionProofTypedData(proof, domain);
  const proofSignature = await simulationExecutor.signTypedData(typedProof);

  const data = encodeFunctionData({
    abi: mandateSimulationHarnessAbi,
    args: [
      executor,
      typedMandate.message,
      action,
      typedProof.message,
      proofSignature,
    ],
    functionName: "simulate",
  });
  const stateOverride = [
    { address: mandate.account, code: mandateSimulationHarnessRuntime },
    {
      address: executor,
      stateDiff: executingRecordOverride({
        account: mandate.account,
        adapter: mandate.adapter,
        commerceContract: mandate.commerceContract,
        commerceJobId: BigInt(mandate.commerceJobId),
        executor: simulationExecutor.address,
        expiresAt: BigInt(mandate.expiresAt),
        mandateHash,
        startedAt: block.timestamp,
        verifier,
      }),
    },
  ];

  let returned: Hex | undefined;
  try {
    ({ data: returned } = await client.call({
      blockNumber: block.number,
      data,
      gas: RUN_GAS,
      stateOverride,
      to: mandate.account,
    }));
  } catch (error) {
    if (isTransportError(error)) throw error;
    return { kind: "REVERTED", ...revertOf(error) };
  }
  if (!returned) throw new Error("the simulation call returned no data");

  const observed = decodeFunctionResult({
    abi: mandateSimulationHarnessAbi,
    data: returned,
    functionName: "simulate",
  });
  const status = STATUS_NAMES[observed.status];
  if (!status) throw new Error("the simulation returned an unknown status");
  return {
    kind: "OBSERVED",
    observation: {
      allowanceAfter: observed.allowanceAfter,
      failureReasonHash: observed.failureReasonHash.toLowerCase() as Hash,
      gasUsed: observed.gasUsed,
      inputBalanceAfter: observed.inputBalanceAfter,
      inputBalanceBefore: observed.inputBalanceBefore,
      outcomeAfter: observed.outcomeAfter,
      outcomeBefore: observed.outcomeBefore,
      status,
      verificationHash: observed.verificationHash.toLowerCase() as Hash,
    },
  };
}
