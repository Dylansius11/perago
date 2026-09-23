import { encodeAbiParameters, type Hex, keccak256, stringToHex } from "viem";
import { z } from "zod";

import {
  type Address,
  addressSchema,
  type Hash,
  positiveUint256StringSchema,
  uint24StringSchema,
  uint48StringSchema,
} from "./domain/primitives.js";

/**
 * The closed exact-input swap action `PancakeV3SwapAdapter` decodes. Its canonical
 * ABI encoding is seven static words; `keccak256` of those bytes is the signed
 * `actionHash`. Field order and widths mirror `PeragoTypes.SwapAction` and are
 * pinned by the shared fixture in `packages/contracts/test/ActionFixtures.t.sol`.
 */
export const swapActionSchema = z.strictObject({
  tokenIn: addressSchema,
  tokenOut: addressSchema,
  poolFee: uint24StringSchema,
  amountIn: positiveUint256StringSchema,
  minAmountOut: positiveUint256StringSchema,
  recipient: addressSchema,
  deadline: uint48StringSchema,
});

export type SwapAction = z.infer<typeof swapActionSchema>;

const swapActionParameters = [
  {
    type: "tuple",
    components: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "poolFee", type: "uint24" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint48" },
    ],
  },
] as const;

export function encodeSwapAction(input: unknown): Hex {
  const action = swapActionSchema.parse(input);
  return encodeAbiParameters(swapActionParameters, [
    {
      tokenIn: action.tokenIn,
      tokenOut: action.tokenOut,
      poolFee: Number(action.poolFee),
      amountIn: BigInt(action.amountIn),
      minAmountOut: BigInt(action.minAmountOut),
      recipient: action.recipient,
      deadline: Number(action.deadline),
    },
  ]);
}

const SWAP_POSTCONDITION_KIND = keccak256(
  stringToHex("perago.postcondition.swap.v1"),
);

/** The commitment a swap mandate signs as `postconditionHash` (`SwapVerifier`). */
export function hashSwapPostcondition(
  recipient: Address,
  outputToken: Address,
  minOutput: string,
): Hash {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [
        SWAP_POSTCONDITION_KIND,
        addressSchema.parse(recipient),
        addressSchema.parse(outputToken),
        BigInt(positiveUint256StringSchema.parse(minOutput)),
      ],
    ),
  ) as Hash;
}
