import type { Abi, AbiFunction } from "viem";
import { toFunctionSelector } from "viem";
import { describe, expect, it } from "vitest";

import {
  peragoAcpHookAbi,
  peragoAdapterAbi,
  peragoVerifierAbi,
} from "../src/abi/perago-contracts.js";
import { taskMandateTypes } from "../src/eip712.js";

/**
 * The mandate tuple the compiled Solidity must expose, derived from the frozen
 * EIP-712 type definition rather than restated, so the two can never disagree
 * silently: a signed mandate and the call that consumes it share this shape.
 */
const MANDATE_TUPLE = `(${taskMandateTypes.TaskMandate.map((field) => field.type).join(",")})`;

function functionNames(abi: readonly unknown[]): string[] {
  const names: string[] = [];
  for (const entry of abi) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      "type" in entry &&
      entry.type === "function" &&
      "name" in entry &&
      typeof entry.name === "string"
    ) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

function abiFunction(abi: Abi, name: string): AbiFunction {
  const entry = abi.find(
    (item): item is AbiFunction =>
      item.type === "function" && item.name === name,
  );
  if (entry === undefined) {
    throw new Error(`the generated ABI lost ${name}`);
  }
  return entry;
}
describe("generated Perago contract ABIs", () => {
  it("exposes exactly the adapter surface Perago encodes", () => {
    expect(functionNames(peragoAdapterAbi)).toEqual([
      "execute",
      "kind",
      "validate",
      "verifier",
    ]);
  });

  it("keeps the verifier surface Perago proves outcomes with", () => {
    expect(functionNames(peragoVerifierAbi)).toEqual([
      "measure",
      "verifierId",
      "verify",
    ]);
  });

  // A mandate-tuple change rewrites every adapter and verifier selector, which
  // would silently invalidate already-signed mandates.
  it("binds adapter and verifier calls to the frozen mandate tuple", () => {
    expect(toFunctionSelector(abiFunction(peragoAdapterAbi, "validate"))).toBe(
      toFunctionSelector(`validate(${MANDATE_TUPLE},bytes)`),
    );
    expect(toFunctionSelector(abiFunction(peragoAdapterAbi, "execute"))).toBe(
      toFunctionSelector(`execute(${MANDATE_TUPLE},bytes)`),
    );
    expect(toFunctionSelector(abiFunction(peragoVerifierAbi, "measure"))).toBe(
      toFunctionSelector(`measure(${MANDATE_TUPLE},bytes)`),
    );
  });

  it("answers the ERC-8183 hook interface id the APEX kernel checks", () => {
    expect(functionNames(peragoAcpHookAbi)).toEqual([
      "afterAction",
      "beforeAction",
      "commerce",
      "supportsInterface",
    ]);

    const interfaceId =
      BigInt(
        toFunctionSelector(abiFunction(peragoAcpHookAbi, "beforeAction")),
      ) ^
      BigInt(toFunctionSelector(abiFunction(peragoAcpHookAbi, "afterAction")));
    // The deployed kernel rejects a hook that answers anything else.
    expect(`0x${interfaceId.toString(16).padStart(8, "0")}`).toBe("0x7ff6bc9e");
  });
});
