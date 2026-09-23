import { keccak256 } from "viem";
import { z } from "zod";

import {
  encodeStakeAction,
  encodeSwapAction,
  hashStakePostcondition,
  hashSwapPostcondition,
  stakeActionSchema,
  swapActionSchema,
} from "../actions.js";
import {
  adapterIdSchema,
  addressSchema,
  bpsStringSchema,
  hashSchema,
  positiveUint256StringSchema,
  uint48StringSchema,
  uint64StringSchema,
  uint256StringSchema,
} from "./primitives.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const deployedContractSchema = z.strictObject({
  address: addressSchema,
  codeHash: hashSchema,
});

const amountPairSchema = z.strictObject({
  before: uint256StringSchema,
  expectedAfter: uint256StringSchema,
});

const actionSchema = z.discriminatedUnion("kind", [
  swapActionSchema.extend({ kind: z.literal("SWAP") }),
  stakeActionSchema.extend({ kind: z.literal("STAKE") }),
]);

/**
 * The mandate fields a simulation decides. Committing them here means the
 * simulation hash a root owner signs covers the exact executor, nonce, expiry,
 * and ERC-8183 binding the simulation ran with.
 */
const mandateTermsSchema = z.strictObject({
  executor: addressSchema,
  nonce: uint256StringSchema,
  expiresAt: uint48StringSchema,
  commerceContract: addressSchema,
  commerceJobId: uint256StringSchema,
});

/**
 * Deterministic preflight evidence for one exact compiled action at one pinned
 * block (PRD-F-006). A `PASSED` result is signable; `REVERTED` records why the
 * exact path failed. Every value is a chain read or a pure derivation from the
 * plan: nothing comes from a model.
 */
export const simulationResultSchema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    status: z.enum(["PASSED", "REVERTED"]),
    chainId: uint256StringSchema,
    account: addressSchema,
    rootOwner: addressSchema,
    ownerEpoch: uint64StringSchema,
    policyHash: hashSchema,
    intentHash: hashSchema,
    planHash: hashSchema,
    adapterId: adapterIdSchema,
    block: z.strictObject({
      number: uint256StringSchema,
      hash: hashSchema,
      timestamp: uint48StringSchema,
    }),
    quoteExpiresAt: uint48StringSchema,
    contracts: z.strictObject({
      mandateExecutor: deployedContractSchema,
      adapter: deployedContractSchema,
      verifier: deployedContractSchema,
      protocolTarget: deployedContractSchema,
      account: deployedContractSchema,
    }),
    accountImplementation: addressSchema,
    verifierId: hashSchema,
    protocol: z.string().trim().min(1).max(100),
    mandate: mandateTermsSchema,
    action: actionSchema,
    actionHash: hashSchema,
    postconditionHash: hashSchema,
    inputToken: addressSchema,
    maxInput: positiveUint256StringSchema,
    outputToken: addressSchema,
    minOutput: positiveUint256StringSchema,
    /** Protocol quote (swap) or share estimate (stake) the minimum derives from. */
    quotedOutput: positiveUint256StringSchema,
    maxSlippageBps: bpsStringSchema,
    /** `TOKEN` output balance, or `POOL_SHARES` of the recipient's position holder. */
    outcomeUnit: z.enum(["TOKEN", "POOL_SHARES"]),
    recipient: addressSchema,
    positionHolder: addressSchema.nullable(),
    balances: z.strictObject({
      input: amountPairSchema,
      outcome: amountPairSchema,
    }),
    allowanceAfter: uint256StringSchema,
    gasUsed: uint256StringSchema,
    failure: z
      .strictObject({
        reason: z.string().trim().min(1).max(200),
        detail: z.string().trim().min(1).max(500).nullable(),
      })
      .nullable(),
    risks: z.array(z.string().trim().min(1).max(500)).min(1),
  })
  .superRefine((result, context) => {
    const issue = (message: string, path: string[]) =>
      context.addIssue({ code: "custom", message, path });
    const { action } = result;

    const actionHash = keccak256(
      action.kind === "SWAP"
        ? encodeSwapAction(withoutKind(action))
        : encodeStakeAction(withoutKind(action)),
    );
    if (actionHash !== result.actionHash) {
      issue("actionHash must commit the canonical action", ["actionHash"]);
    }

    const spend = action.kind === "SWAP" ? action.amountIn : action.amount;
    const minimum =
      action.kind === "SWAP" ? action.minAmountOut : action.minPositionOut;
    if (spend !== result.maxInput) {
      issue("maxInput must equal the action spend", ["maxInput"]);
    }
    if (minimum !== result.minOutput) {
      issue("minOutput must equal the action minimum", ["minOutput"]);
    }
    if (action.recipient !== result.recipient) {
      issue("recipient must equal the action recipient", ["recipient"]);
    }
    if (BigInt(action.deadline) > BigInt(result.mandate.expiresAt)) {
      issue("the action deadline cannot outlive the mandate", ["action"]);
    }
    if (BigInt(result.quoteExpiresAt) > BigInt(result.mandate.expiresAt)) {
      issue("the quote cannot outlive the mandate", ["quoteExpiresAt"]);
    }

    const postconditionHash =
      action.kind === "SWAP"
        ? hashSwapPostcondition(
            result.recipient,
            result.outputToken,
            result.minOutput,
          )
        : hashStakePostcondition(
            result.recipient,
            action.poolId,
            result.minOutput,
          );
    if (postconditionHash !== result.postconditionHash) {
      issue("postconditionHash must commit recipient and minimum", [
        "postconditionHash",
      ]);
    }

    if (action.kind === "SWAP") {
      if (
        action.tokenIn !== result.inputToken ||
        action.tokenOut !== result.outputToken
      ) {
        issue("the swap tokens must match the mandate tokens", ["action"]);
      }
      if (result.outcomeUnit !== "TOKEN" || result.positionHolder !== null) {
        issue("a swap outcome is the recipient token balance", ["outcomeUnit"]);
      }
    } else {
      if (
        action.asset !== result.inputToken ||
        action.asset !== result.outputToken
      ) {
        issue("a stake spends and measures its one asset", ["action"]);
      }
      if (
        result.outcomeUnit !== "POOL_SHARES" ||
        result.positionHolder === null
      ) {
        issue("a stake outcome is the holder's pool shares", ["outcomeUnit"]);
      }
    }

    const unbound = result.mandate.commerceContract === ZERO_ADDRESS;
    if (unbound !== (result.mandate.commerceJobId === "0")) {
      issue("an ERC-8183 binding names both a contract and a job", ["mandate"]);
    }

    const passed = result.status === "PASSED";
    if (passed !== (result.failure === null)) {
      issue("only a reverted simulation carries a failure", ["failure"]);
    }
    if (passed) {
      const outcome = result.balances.outcome;
      const input = result.balances.input;
      if (
        BigInt(outcome.expectedAfter) - BigInt(outcome.before) <
        BigInt(result.minOutput)
      ) {
        issue("a passing simulation meets the signed minimum", ["balances"]);
      }
      if (
        BigInt(input.before) - BigInt(input.expectedAfter) !==
        BigInt(result.maxInput)
      ) {
        issue("a passing simulation spends exactly the signed input", [
          "balances",
        ]);
      }
      if (result.allowanceAfter !== "0") {
        issue("a passing simulation leaves no allowance", ["allowanceAfter"]);
      }
    }
  });

function withoutKind<T extends { kind: string }>(action: T): Omit<T, "kind"> {
  const { kind: _kind, ...rest } = action;
  return rest;
}

export type SimulationResult = z.infer<typeof simulationResultSchema>;
