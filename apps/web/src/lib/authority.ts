import {
  type Address,
  type CompiledPlan,
  deriveExecutorAllowances,
  type ExecutorAllowance,
  encodeInstallMandateSession,
  encodeSimulatedAction,
  getTaskMandateTypedData,
  type Hash,
  hashCompiledPlan,
  hashMandateSessionPermission,
  hashSimulationResult,
  hashWalletPolicy,
  type MandatePrepared,
  type MandateSessionPermissionDocument,
  type PolicyTransitionPrepared,
  taskMandateFromSimulation,
  toMandateSessionPermission,
  type WalletPolicy,
} from "@perago/sdk";
import { hashTypedData, keccak256 } from "viem";

/**
 * Refuse an API-prepared root operation that differs from the owner's reviewed
 * policy or session, and return the standing allowances the operation may set:
 * exactly the reviewed policy's rolling caps over the public token catalog.
 */
export function assertPreparedPolicy(input: {
  account: Address;
  owner: Address;
  chainId: string;
  policy: WalletPolicy;
  transition: {
    ownerEpoch: string;
    validUntil: string;
    permission: MandateSessionPermissionDocument;
  };
  prepared: PolicyTransitionPrepared;
  tokens: readonly Address[];
}): ExecutorAllowance[] {
  const { accountPolicy, permissionCallData, permissionHash } = input.prepared;
  const expectedPermissionHash = hashMandateSessionPermission(
    input.transition.permission,
  );
  const expectedCallData = encodeInstallMandateSession(
    toMandateSessionPermission(input.transition.permission),
  );
  if (
    accountPolicy.account !== input.account.toLowerCase() ||
    accountPolicy.rootOwner !== input.owner.toLowerCase() ||
    accountPolicy.chainId !== input.chainId ||
    accountPolicy.ownerEpoch !== input.transition.ownerEpoch ||
    accountPolicy.validUntil !== input.transition.validUntil ||
    accountPolicy.policyHash !== hashWalletPolicy(input.policy) ||
    accountPolicy.permissionHash !== expectedPermissionHash ||
    permissionHash !== expectedPermissionHash ||
    permissionCallData.toLowerCase() !== expectedCallData.toLowerCase()
  ) {
    throw new Error(
      "Prepared policy differs from the reviewed owner limits or scoped session.",
    );
  }
  const allowances = deriveExecutorAllowances(input.policy, input.tokens);
  const prepared = input.prepared.allowances;
  if (
    prepared.length !== allowances.length ||
    allowances.some(
      (allowance, index) =>
        prepared[index]?.token.toLowerCase() !==
          allowance.token.toLowerCase() ||
        prepared[index]?.amount !== allowance.amount.toString(),
    )
  ) {
    throw new Error(
      "Prepared allowances differ from the reviewed policy's rolling caps.",
    );
  }
  return allowances;
}

/** Bind the API's EIP-712 payload to the exact plan and passing simulation shown to the owner. */
export function assertPreparedMandate(input: {
  prepared: MandatePrepared;
  plan: CompiledPlan;
  planHash: Hash;
  intentHash: Hash;
  simulationHash: Hash;
  owner: Address;
  account: Address;
  executor: Address;
  chainId: string;
  mandateExecutor: Address;
}): void {
  const { prepared, plan } = input;
  const { simulation, domain, mandate } = prepared;
  const action = simulation.action;
  const planned = plan.action;
  const expectedMandate = taskMandateFromSimulation(
    simulation,
    prepared.simulationHash,
  );
  const expectedDigest = hashTypedData(
    getTaskMandateTypedData(expectedMandate, domain),
  );
  const actualDigest = hashTypedData(getTaskMandateTypedData(mandate, domain));
  const actionDiffers =
    action.kind !== planned.kind ||
    (action.kind === "SWAP"
      ? planned.kind !== "SWAP" ||
        action.tokenIn !== planned.inputToken ||
        action.tokenOut !== planned.outputToken ||
        action.amountIn !== planned.inputAmount ||
        action.poolFee !== planned.poolFee
      : planned.kind !== "STAKE" ||
        action.asset !== planned.inputToken ||
        action.amount !== planned.inputAmount);
  if (
    domain.chainId !== input.chainId ||
    domain.verifyingContract.toLowerCase() !==
      input.mandateExecutor.toLowerCase() ||
    simulation.contracts.mandateExecutor.address.toLowerCase() !==
      input.mandateExecutor.toLowerCase() ||
    simulation.account !== input.account.toLowerCase() ||
    simulation.rootOwner !== input.owner.toLowerCase() ||
    simulation.mandate.executor !== input.executor.toLowerCase() ||
    simulation.chainId !== input.chainId ||
    simulation.intentHash !== input.intentHash ||
    plan.intentHash !== input.intentHash ||
    plan.account !== input.account.toLowerCase() ||
    plan.chainId !== input.chainId ||
    simulation.policyHash !== plan.policyHash ||
    simulation.planHash !== input.planHash ||
    input.planHash !== hashCompiledPlan(plan) ||
    prepared.simulationHash !== input.simulationHash ||
    prepared.simulationHash !== hashSimulationResult(simulation) ||
    simulation.actionHash !== keccak256(encodeSimulatedAction(simulation)) ||
    simulation.adapterId !== planned.adapterId ||
    simulation.maxInput !== planned.inputAmount ||
    simulation.inputToken !== planned.inputToken ||
    simulation.recipient !== planned.recipient ||
    simulation.maxSlippageBps !== planned.maxSlippageBps ||
    actionDiffers ||
    expectedDigest !== prepared.mandateHash ||
    actualDigest !== expectedDigest
  ) {
    throw new Error(
      "Prepared mandate differs from the reviewed plan or simulated authority.",
    );
  }
}
