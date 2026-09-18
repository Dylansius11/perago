import { keccak256, stringToHex } from "viem";

import { canonicalJson } from "./canonical-json.js";
import {
  type CompiledPlan,
  compiledPlanSchema,
} from "./domain/compiled-plan.js";
import type { Hash } from "./domain/primitives.js";
import {
  type SimulationResult,
  simulationResultSchema,
} from "./domain/simulation-result.js";
import { type TaskIntent, taskIntentSchema } from "./domain/task-intent.js";
import {
  type WalletPolicy,
  walletPolicySchema,
} from "./domain/wallet-policy.js";

function hashDocument(document: unknown): Hash {
  return keccak256(stringToHex(canonicalJson(document))) as Hash;
}

export function hashWalletPolicy(input: unknown): Hash {
  return hashDocument(walletPolicySchema.parse(input));
}

export function hashTaskIntent(input: unknown): Hash {
  return hashDocument(taskIntentSchema.parse(input));
}

export function hashCompiledPlan(input: unknown): Hash {
  return hashDocument(compiledPlanSchema.parse(input));
}

export function hashSimulationResult(input: unknown): Hash {
  return hashDocument(simulationResultSchema.parse(input));
}

export type { CompiledPlan, SimulationResult, TaskIntent, WalletPolicy };
