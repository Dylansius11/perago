import { type Hex, toFunctionSelector } from "viem";

import { peragoAdapterAbi } from "./abi/perago-contracts.js";
import { encodeStakeAction, encodeSwapAction } from "./actions.js";
import type { Hash, Selector } from "./domain/primitives.js";
import { hashSchema } from "./domain/primitives.js";
import {
  type SimulationResult,
  simulationResultSchema,
} from "./domain/simulation-result.js";
import { type TaskMandate, taskMandateSchema } from "./domain/task-mandate.js";

const executeItem = peragoAdapterAbi.find(
  (item) => item.type === "function" && item.name === "execute",
);
if (!executeItem) throw new Error("IPeragoAdapter ABI has no execute entry");

/** `IPeragoAdapter.execute`: the only selector a mandate may name. */
export const ADAPTER_EXECUTE_SELECTOR = toFunctionSelector(
  executeItem,
) as Selector;

/** The canonical action bytes a simulation committed to with `actionHash`. */
export function encodeSimulatedAction(resultInput: unknown): Hex {
  const { action } = simulationResultSchema.parse(resultInput);
  const { kind, ...fields } = action;
  return kind === "SWAP" ? encodeSwapAction(fields) : encodeStakeAction(fields);
}

/**
 * Derives the one Task Mandate a passing simulation authorizes. Every field
 * comes from the simulation document plus its own hash, so anyone holding the
 * document reproduces the exact typed data and digest the root owner signs.
 */
export function taskMandateFromSimulation(
  resultInput: unknown,
  simulationHashInput: unknown,
): TaskMandate {
  const result: SimulationResult = simulationResultSchema.parse(resultInput);
  const simulationHash: Hash = hashSchema.parse(simulationHashInput);
  if (result.status !== "PASSED") {
    throw new RangeError("only a passing simulation can be signed");
  }
  return taskMandateSchema.parse({
    account: result.account,
    rootOwner: result.rootOwner,
    ownerEpoch: result.ownerEpoch,
    executor: result.mandate.executor,
    chainId: result.chainId,
    nonce: result.mandate.nonce,
    expiresAt: result.mandate.expiresAt,
    policyHash: result.policyHash,
    intentHash: result.intentHash,
    planHash: result.planHash,
    simulationHash,
    adapter: result.contracts.adapter.address,
    adapterSelector: ADAPTER_EXECUTE_SELECTOR,
    inputToken: result.inputToken,
    maxInput: result.maxInput,
    outputToken: result.outputToken,
    minOutput: result.minOutput,
    recipient: result.recipient,
    actionHash: result.actionHash,
    postconditionHash: result.postconditionHash,
    commerceContract: result.mandate.commerceContract,
    commerceJobId: result.mandate.commerceJobId,
  });
}
