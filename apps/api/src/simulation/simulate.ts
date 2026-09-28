import {
  ADAPTER_EXECUTE_SELECTOR,
  type Address,
  type CompiledPlan,
  encodeStakeAction,
  encodeSwapAction,
  type Hash,
  hashSimulationResult,
  hashStakePostcondition,
  hashSwapPostcondition,
  mandateExecutorAbi,
  type SimulationResult,
  type StakeAction,
  type SwapAction,
  simulationResultSchema,
  type TaskMandate,
  taskMandateSchema,
} from "@perago/sdk";
import { erc20Abi, keccak256, type PublicClient } from "viem";

import type { PeragoDeployment } from "../deployment.js";
import { ReasonError } from "../errors.js";
import { readSubmittedCommerceJob } from "./commerce.js";
import {
  type ChainSnapshot,
  type PinnedBlock,
  pinBlock,
  readChainSnapshot,
  type SimulationBlockTag,
  verifyDeploymentWiring,
} from "./context.js";
import { readStakePosition, type StakePosition, stakeAction } from "./stake.js";
import { minimumAfterSlippage, quoteSwap, swapAction } from "./swap.js";
import {
  type ExactPathOutcome,
  runExactPath,
  SIMULATION_HASH_PLACEHOLDER,
} from "./user-operation.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"0".repeat(64)}`;

export type SimulationEnvironment = {
  blockTag: SimulationBlockTag;
  client: PublicClient;
  deployment: PeragoDeployment;
  /** Seconds a quote may back a signature; never beyond the mandate expiry. */
  quoteTtlSeconds: number;
};

export type SimulationSubject = {
  commerceJobId: bigint | null;
  executor: Address;
  nonce: bigint;
  ownerEpoch: string;
  plan: CompiledPlan;
  planHash: Hash;
  rootOwner: Address;
  sessionValidUntil: bigint;
};

export type SimulationRun = {
  request: Record<string, unknown>;
  result: SimulationResult;
  simulationHash: Hash;
  snapshot: ChainSnapshot;
};

function encodeAction(action: SimulationResult["action"]) {
  const { kind, ...fields } = action;
  return kind === "SWAP" ? encodeSwapAction(fields) : encodeStakeAction(fields);
}

/** The mandate a simulation runs: every signed field except its own hash. */
function simulatedMandate(input: {
  action: SimulationResult["action"];
  adapter: Address;
  expiresAt: bigint;
  commerce: { commerceContract: Address; commerceJobId: string } | null;
  subject: SimulationSubject;
}): TaskMandate {
  const { action, adapter, expiresAt, subject } = input;
  const { plan } = subject;
  const minimum =
    action.kind === "SWAP" ? action.minAmountOut : action.minPositionOut;
  return taskMandateSchema.parse({
    account: plan.account,
    rootOwner: subject.rootOwner,
    ownerEpoch: subject.ownerEpoch,
    executor: subject.executor,
    chainId: plan.chainId,
    nonce: subject.nonce.toString(),
    expiresAt: expiresAt.toString(),
    policyHash: plan.policyHash,
    intentHash: plan.intentHash,
    planHash: subject.planHash,
    simulationHash: SIMULATION_HASH_PLACEHOLDER,
    adapter,
    adapterSelector: ADAPTER_EXECUTE_SELECTOR,
    inputToken: plan.action.inputToken,
    maxInput: plan.action.inputAmount,
    outputToken:
      plan.action.kind === "SWAP"
        ? plan.action.outputToken
        : plan.action.inputToken,
    minOutput: minimum,
    recipient: plan.action.recipient,
    actionHash: keccak256(encodeAction(action)),
    postconditionHash:
      action.kind === "SWAP"
        ? hashSwapPostcondition(action.recipient, action.tokenOut, minimum)
        : hashStakePostcondition(action.recipient, action.poolId, minimum),
    commerceContract: input.commerce?.commerceContract ?? ZERO_ADDRESS,
    commerceJobId: input.commerce?.commerceJobId ?? "0",
  });
}

/**
 * Simulates one compiled plan end to end at one pinned block: deployment and
 * account preflight, a protocol estimate, the signed minimum it implies, and
 * the exact account execution path with that minimum. Preflight refusals
 * throw `ReasonError`; an exact path that fails yields a `REVERTED` document.
 */
export async function simulatePlan(
  environment: SimulationEnvironment,
  subject: SimulationSubject,
): Promise<SimulationRun> {
  const { client, deployment } = environment;
  const { plan } = subject;
  const kind = plan.action.kind;
  const adapter = deployment.adapters[kind];
  if (
    adapter.id !== plan.action.adapterId ||
    deployment.chainId !== plan.chainId
  ) {
    throw new ReasonError(
      "DEPLOYMENT_MISMATCH",
      `the plan names ${plan.action.adapterId} on chain ${plan.chainId}; this deployment pins ${adapter.id} on chain ${deployment.chainId}`,
    );
  }

  const block: PinnedBlock = await pinBlock(client, environment.blockTag);
  const blockNumber = block.number;
  const snapshot = await readChainSnapshot({
    account: plan.account,
    adapter,
    block,
    client,
    deployment,
  });
  const wiring = await verifyDeploymentWiring({
    adapter,
    client,
    deployment,
    kind,
    snapshot,
  });
  if (wiring.problems.length > 0) {
    throw new ReasonError("DEPLOYMENT_MISMATCH", wiring.problems.join("; "));
  }

  const config = snapshot.accountConfig;
  if (
    config.rootOwner !== subject.rootOwner ||
    config.ownerEpoch !== subject.ownerEpoch ||
    config.activePolicyHash !== plan.policyHash ||
    config.permissionHash === ZERO_HASH
  ) {
    throw new ReasonError(
      "ACCOUNT_NOT_REGISTERED",
      `onchain owner ${config.rootOwner} epoch ${config.ownerEpoch} policy ${config.activePolicyHash}`,
    );
  }
  if (!snapshot.allowUnboundCommerceJobs && subject.commerceJobId === null) {
    throw new ReasonError("COMMERCE_BINDING_REQUIRED");
  }

  const expiresAt = block.timestamp + BigInt(plan.lifetimeSeconds);
  if (expiresAt > subject.sessionValidUntil) {
    throw new ReasonError(
      "SESSION_EXPIRES_FIRST",
      `mandate expiry ${expiresAt}; session valid until ${subject.sessionValidUntil}`,
    );
  }
  if (subject.commerceJobId !== null && !deployment.settlement) {
    throw new ReasonError(
      "DEPLOYMENT_MISMATCH",
      "no pinned evaluator is configured",
    );
  }
  const commerce =
    subject.commerceJobId === null || !deployment.settlement
      ? null
      : await readSubmittedCommerceJob({
          client,
          settlement: deployment.settlement,
          executor: deployment.mandateExecutor.address,
          account: plan.account,
          jobId: subject.commerceJobId,
          blockNumber,
          mandateExpiresAt: expiresAt,
          executionWindowSeconds: deployment.executionWindowSeconds,
          now: block.timestamp,
        });
  const quoteExpiresAt =
    block.timestamp + BigInt(environment.quoteTtlSeconds) < expiresAt
      ? block.timestamp + BigInt(environment.quoteTtlSeconds)
      : expiresAt;

  const [nonceUsed, inputBalance] = await Promise.all([
    client.readContract({
      abi: mandateExecutorAbi,
      address: deployment.mandateExecutor.address,
      args: [plan.account, subject.nonce],
      blockNumber,
      functionName: "isNonceUsed",
    }),
    client.readContract({
      abi: erc20Abi,
      address: plan.action.inputToken,
      args: [plan.account],
      blockNumber,
      functionName: "balanceOf",
    }),
  ]);
  if (nonceUsed) throw new Error("the drawn mandate nonce is already used");
  const spend = BigInt(plan.action.inputAmount);
  if (inputBalance < spend) {
    throw new ReasonError(
      "INSUFFICIENT_BALANCE",
      `holds ${inputBalance}; the plan spends ${spend}`,
    );
  }
  // A stake refuses before any estimate if its position cannot be read.
  const position =
    plan.action.kind === "STAKE"
      ? await readStakePosition({
          adapter: adapter.adapter.address,
          blockNumber,
          client,
          pool: adapter.protocolTarget.address,
          recipient: plan.action.recipient,
        })
      : null;

  const run = (action: SimulationResult["action"]) => {
    const mandate = simulatedMandate({
      action,
      adapter: adapter.adapter.address,
      expiresAt,
      commerce,
      subject,
    });
    return runExactPath({
      action: encodeAction(action),
      block,
      client,
      executor: deployment.mandateExecutor.address,
      mandate,
      verifier: adapter.verifier.address,
    }).then((outcome) => ({ mandate, outcome }));
  };

  // The estimate the signed minimum derives from: QuoterV2 for a swap, the
  // exact path itself (with the weakest admissible minimum) for a stake.
  let estimate: bigint;
  let estimateSource: string;
  if (plan.action.kind === "SWAP") {
    const quote = await quoteSwap({
      blockNumber,
      client,
      plan: plan.action,
      quoter: deployment.quoter,
    });
    if ("failure" in quote) {
      throw new ReasonError("QUOTE_UNAVAILABLE", quote.failure);
    }
    estimate = quote.amountOut;
    estimateSource = "PancakeSwap V3 QuoterV2 quoteExactInputSingle";
  } else {
    const probe = await run({
      kind: "STAKE",
      ...stakeAction(plan.action, 1n, expiresAt),
    });
    const observed = succeeded(probe.outcome);
    if (!observed) {
      throw new ReasonError(
        "QUOTE_UNAVAILABLE",
        failureOf(probe.outcome, 1n).reason,
      );
    }
    estimate = observed.outcomeAfter - observed.outcomeBefore;
    estimateSource = "exact path share delta with minPositionOut = 1";
  }
  const minimum = minimumAfterSlippage(estimate, plan.action.maxSlippageBps);
  if (minimum === 0n) {
    throw new ReasonError(
      "MINIMUM_OUTPUT_ZERO",
      `estimate ${estimate}; slippage ${plan.action.maxSlippageBps} bp`,
    );
  }

  const action: SimulationResult["action"] =
    plan.action.kind === "SWAP"
      ? {
          kind: "SWAP",
          ...(swapAction(plan.action, minimum, expiresAt) satisfies SwapAction),
        }
      : {
          kind: "STAKE",
          ...(stakeAction(
            plan.action,
            minimum,
            expiresAt,
          ) satisfies StakeAction),
        };
  const { mandate, outcome } = await run(action);
  const observed = succeeded(outcome);
  const passed =
    observed !== null &&
    observed.outcomeAfter - observed.outcomeBefore >= minimum &&
    observed.inputBalanceBefore - observed.inputBalanceAfter === spend &&
    observed.allowanceAfter === 0n;

  const risks = riskStatements({
    block,
    environment,
    expiresAt,
    minimum,
    plan,
    position,
  });

  const measured = outcome.kind === "OBSERVED" ? outcome.observation : null;
  const result = simulationResultSchema.parse({
    schemaVersion: "1",
    status: passed ? "PASSED" : "REVERTED",
    chainId: plan.chainId,
    account: plan.account,
    rootOwner: subject.rootOwner,
    ownerEpoch: subject.ownerEpoch,
    policyHash: plan.policyHash,
    intentHash: plan.intentHash,
    planHash: subject.planHash,
    adapterId: adapter.id,
    block: {
      number: block.number.toString(),
      hash: block.hash,
      timestamp: block.timestamp.toString(),
    },
    quoteExpiresAt: quoteExpiresAt.toString(),
    contracts: {
      mandateExecutor: {
        address: deployment.mandateExecutor.address,
        codeHash: snapshot.codeHashes.mandateExecutor,
      },
      adapter: {
        address: adapter.adapter.address,
        codeHash: snapshot.codeHashes.adapter,
      },
      verifier: {
        address: adapter.verifier.address,
        codeHash: snapshot.codeHashes.verifier,
      },
      protocolTarget: {
        address: adapter.protocolTarget.address,
        codeHash: snapshot.codeHashes.protocolTarget,
      },
      account: { address: plan.account, codeHash: snapshot.codeHashes.account },
    },
    accountImplementation: snapshot.accountImplementation,
    verifierId: wiring.verifierId,
    protocol: adapter.protocol,
    mandate: {
      executor: mandate.executor,
      nonce: mandate.nonce,
      expiresAt: mandate.expiresAt,
      commerceContract: mandate.commerceContract,
      commerceJobId: mandate.commerceJobId,
    },
    action,
    actionHash: mandate.actionHash,
    postconditionHash: mandate.postconditionHash,
    inputToken: mandate.inputToken,
    maxInput: mandate.maxInput,
    outputToken: mandate.outputToken,
    minOutput: mandate.minOutput,
    quotedOutput: estimate.toString(),
    maxSlippageBps: plan.action.maxSlippageBps,
    outcomeUnit: plan.action.kind === "SWAP" ? "TOKEN" : "POOL_SHARES",
    recipient: plan.action.recipient,
    position,
    balances: {
      input: {
        before: (measured?.inputBalanceBefore ?? inputBalance).toString(),
        expectedAfter: (measured?.inputBalanceAfter ?? inputBalance).toString(),
      },
      outcome: {
        before: (measured?.outcomeBefore ?? 0n).toString(),
        expectedAfter: (measured?.outcomeAfter ?? 0n).toString(),
      },
    },
    allowanceAfter: (measured?.allowanceAfter ?? 0n).toString(),
    gasUsed: (measured?.gasUsed ?? 0n).toString(),
    failure: passed ? null : failureOf(outcome, minimum),
    risks,
  });

  return {
    request: {
      blockTag: environment.blockTag,
      estimate: { source: estimateSource, value: estimate.toString() },
      exactPath: {
        call: "MandateSimulationHarness.simulate at the account address",
        injectedState: [
          "account code: MandateSimulationHarness runtime",
          "MandateExecutor _mandates[hash]: EXECUTING, started at the pinned block, one-off simulation executor",
        ],
        simulationHashPlaceholder: SIMULATION_HASH_PLACEHOLDER,
      },
      nonceSource: "random 128-bit",
    },
    result,
    simulationHash: hashSimulationResult(result),
    snapshot,
  };
}

function succeeded(outcome: ExactPathOutcome) {
  return outcome.kind === "OBSERVED" &&
    outcome.observation.status === "SUCCEEDED"
    ? outcome.observation
    : null;
}

function failureOf(
  outcome: ExactPathOutcome,
  minimum: bigint,
): { detail: string | null; reason: string } {
  if (outcome.kind === "REVERTED") {
    return { detail: outcome.detail, reason: outcome.reason };
  }
  const observed = outcome.observation;
  if (observed.status !== "SUCCEEDED") {
    return {
      detail: `failureReasonHash ${observed.failureReasonHash}`,
      reason: `perform recorded ${observed.status}`,
    };
  }
  const delta = observed.outcomeAfter - observed.outcomeBefore;
  if (delta < minimum) {
    return {
      detail: `delta ${delta}; minimum ${minimum}`,
      reason: "outcome below the signed minimum",
    };
  }
  return {
    detail: `allowance after ${observed.allowanceAfter}`,
    reason: "spend or allowance was not exact",
  };
}

function riskStatements(input: {
  block: PinnedBlock;
  environment: SimulationEnvironment;
  expiresAt: bigint;
  minimum: bigint;
  plan: CompiledPlan;
  position: StakePosition | null;
}): string[] {
  const { block, environment, expiresAt, minimum, plan, position } = input;
  const risks = [
    `Authority is one-use and ends at chain time ${expiresAt}; an unexecuted mandate expires without effect.`,
  ];
  if (position) {
    risks.push(
      `The position is held for the recipient by ${position.holder}; only the recipient can withdraw it.`,
      `The CAKE Pool charges a ${position.withdrawFeeBps} bp withdrawal fee within ${position.withdrawFeePeriodSeconds} seconds of a deposit and a ${position.performanceFeeBps} bp performance fee on yield.`,
      `Pool shares are estimated from the exact path at block ${block.number}; the stake reverts below ${minimum} shares.`,
    );
  } else {
    risks.push(
      `Output is estimated by QuoterV2 at block ${block.number}; the price may move within the ${plan.action.maxSlippageBps} bp bound, and the swap reverts below ${minimum}.`,
    );
  }
  if (environment.deployment.allowUnboundCommerceJobs) {
    risks.push(
      `MandateExecutor ${environment.deployment.mandateExecutor.address} accepts mandates without an ERC-8183 job (${environment.deployment.label}); no agent payment is bound to this outcome.`,
    );
  }
  return risks;
}
