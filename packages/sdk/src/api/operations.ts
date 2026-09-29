import { z } from "zod";

import {
  addressSchema,
  hashSchema,
  uint256StringSchema,
} from "../domain/primitives.js";

/*
 * The sponsored root-operation routes: the owner signs one EntryPoint hash and
 * the API submits it to a bundler whose gas manager pays for it. Every gas
 * field is a JSON-RPC hex quantity and every byte string is `0x` hex, because
 * these bodies go to `eth_estimateUserOperationGas` and
 * `eth_sendUserOperation` unchanged. The API, never the client, decides the
 * sender and the call data shape it is willing to sponsor.
 */

const hexDataSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/u, "expected even-length 0x hex")
  .transform((value) => value as `0x${string}`);

/** A JSON-RPC quantity: no leading zeros, and `0x0` is zero. */
const hexQuantitySchema = z
  .string()
  .regex(/^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/u, "expected a 0x hex quantity")
  .transform((value) => value as `0x${string}`);

/** `POST /operations/estimate` */
export const estimateUserOperationRequestSchema = z.strictObject({
  nonce: uint256StringSchema,
  callData: hexDataSchema,
});

export const estimateUserOperationResponseSchema = z.strictObject({
  callGasLimit: hexQuantitySchema,
  preVerificationGas: hexQuantitySchema,
  verificationGasLimit: hexQuantitySchema,
});

/**
 * An EntryPoint v0.7 UserOperation with zero fees, signed by the root owner.
 * Factory and paymaster fields are absent: the account is already deployed and
 * the bundler's gas manager pays, so a request carrying either is refused.
 */
export const userOperationRequestSchema = z.strictObject({
  callData: hexDataSchema,
  callGasLimit: hexQuantitySchema,
  maxFeePerGas: hexQuantitySchema,
  maxPriorityFeePerGas: hexQuantitySchema,
  nonce: hexQuantitySchema,
  preVerificationGas: hexQuantitySchema,
  sender: addressSchema,
  signature: hexDataSchema,
  verificationGasLimit: hexQuantitySchema,
});

/** `POST /operations` */
export const submitUserOperationRequestSchema = userOperationRequestSchema;

export const submitUserOperationResponseSchema = z.strictObject({
  userOperationHash: hashSchema,
});

/** `GET /operations/:userOperationHash` */
export const userOperationStatusSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("PENDING") }),
  z.strictObject({
    status: z.literal("INCLUDED"),
    success: z.boolean(),
    transactionHash: hashSchema,
  }),
]);

export type EstimateUserOperationRequest = z.infer<
  typeof estimateUserOperationRequestSchema
>;
export type EstimateUserOperationResponse = z.infer<
  typeof estimateUserOperationResponseSchema
>;
export type UserOperationRequest = z.infer<typeof userOperationRequestSchema>;
export type SubmitUserOperationResponse = z.infer<
  typeof submitUserOperationResponseSchema
>;
export type UserOperationStatus = z.infer<typeof userOperationStatusSchema>;
