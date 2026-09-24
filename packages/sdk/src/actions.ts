import { encodeAbiParameters, type Hex, keccak256, stringToHex } from "viem";
import { z } from "zod";

import {
  type Address,
  addressSchema,
  type Hash,
  hashSchema,
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

/** The only pool `CakeStakeAdapter` stakes into; a key, never an address. */
export const CAKE_POOL_ID = keccak256(
  stringToHex("perago.stake.pancakeswap.cake-pool.flexible.v1"),
) as Hash;

/**
 * The closed stake action `CakeStakeAdapter` decodes: six static words mirroring
 * `PeragoTypes.StakeAction`. `minPositionOut` is measured in pool shares.
 */
export const stakeActionSchema = z.strictObject({
  asset: addressSchema,
  amount: positiveUint256StringSchema,
  minPositionOut: positiveUint256StringSchema,
  recipient: addressSchema,
  deadline: uint48StringSchema,
  poolId: hashSchema,
});

export type StakeAction = z.infer<typeof stakeActionSchema>;

const stakeActionParameters = [
  {
    type: "tuple",
    components: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "minPositionOut", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "deadline", type: "uint48" },
      { name: "poolId", type: "bytes32" },
    ],
  },
] as const;

export function encodeStakeAction(input: unknown): Hex {
  const action = stakeActionSchema.parse(input);
  return encodeAbiParameters(stakeActionParameters, [
    {
      asset: action.asset,
      amount: BigInt(action.amount),
      minPositionOut: BigInt(action.minPositionOut),
      recipient: action.recipient,
      deadline: Number(action.deadline),
      poolId: action.poolId,
    },
  ]);
}

const STAKE_POSTCONDITION_KIND = keccak256(
  stringToHex("perago.postcondition.stake.v1"),
);

/** The commitment a stake mandate signs as `postconditionHash` (`StakeVerifier`). */
export function hashStakePostcondition(
  recipient: Address,
  poolId: Hash,
  minPositionOut: string,
): Hash {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
      ],
      [
        STAKE_POSTCONDITION_KIND,
        addressSchema.parse(recipient),
        hashSchema.parse(poolId),
        BigInt(positiveUint256StringSchema.parse(minPositionOut)),
      ],
    ),
  ) as Hash;
}
