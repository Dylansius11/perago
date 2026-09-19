import { z } from "zod";

export type Address = `0x${string}`;
export type Hash = `0x${string}`;
export type Selector = `0x${string}`;

const UINT_24_MAX = (1n << 24n) - 1n;
const UINT_48_MAX = (1n << 48n) - 1n;
const UINT_64_MAX = (1n << 64n) - 1n;
const UINT_256_MAX = (1n << 256n) - 1n;

export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/u, "expected a 20-byte hex address")
  .transform((value): Address => value.toLowerCase() as Address);

export const hashSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/u, "expected a 32-byte hex value")
  .transform((value): Hash => value.toLowerCase() as Hash);

export const selectorSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{8}$/u, "expected a 4-byte hex selector")
  .transform((value): Selector => value.toLowerCase() as Selector);

export const uintStringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/u, "expected an unsigned decimal string");

function uintSchema(maximum: bigint) {
  return uintStringSchema.refine(
    (value) => BigInt(value) <= maximum,
    "integer exceeds Solidity width",
  );
}

export const uint24StringSchema = uintSchema(UINT_24_MAX);
export const uint48StringSchema = uintSchema(UINT_48_MAX);
export const uint64StringSchema = uintSchema(UINT_64_MAX);
export const uint256StringSchema = uintSchema(UINT_256_MAX);
export const adapterIdSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u,
    "expected a lowercase adapter identifier",
  );
export const serviceSchema = z.enum(["SWAP", "STAKE"]);

export function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
