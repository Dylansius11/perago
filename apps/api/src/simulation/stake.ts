import {
  type Address,
  CAKE_POOL_ID,
  cakeStakeAdapterAbi,
  type SimulationResult,
  type StakeAction,
  type StakePlan,
} from "@perago/sdk";
import { type PublicClient, parseAbi } from "viem";

import { ReasonError } from "../errors.js";
import { isTransportError } from "./user-operation.js";

const cakePoolPositionAbi = parseAbi([
  "function userInfo(address) view returns (uint256 shares, uint256 lastDepositedTime, uint256 cakeAtLastUserAction, uint256 lastUserActionTime, uint256 lockStartTime, uint256 lockEndTime, uint256 userBoostedShare, bool locked, uint256 lockedAmount)",
  "function withdrawFee() view returns (uint256)",
  "function withdrawFeePeriod() view returns (uint256)",
  "function performanceFee() view returns (uint256)",
]);

export type StakePosition = NonNullable<SimulationResult["position"]>;

export function stakeAction(
  plan: StakePlan,
  minPositionOut: bigint,
  deadline: bigint,
): StakeAction {
  return {
    asset: plan.inputToken,
    amount: plan.inputAmount,
    minPositionOut: minPositionOut.toString(),
    recipient: plan.recipient,
    deadline: deadline.toString(),
    poolId: CAKE_POOL_ID,
  };
}

/**
 * The recipient's stake position at one block: the holder the adapter names
 * (deployed or not), its CAKE Pool shares, and the pool's fees. A read that
 * reverts or returns nothing usable refuses with `POSITION_UNAVAILABLE`, so
 * nothing is simulated or signed on a position Perago could not read; a
 * transport failure propagates as `CHAIN_UNAVAILABLE`.
 */
export async function readStakePosition(input: {
  adapter: Address;
  blockNumber: bigint;
  client: PublicClient;
  pool: Address;
  recipient: Address;
}): Promise<StakePosition> {
  const { blockNumber, client, pool } = input;
  const guarded = async <T>(read: string, run: () => Promise<T>) => {
    try {
      return await run();
    } catch (error) {
      if (isTransportError(error)) throw error;
      throw new ReasonError(
        "POSITION_UNAVAILABLE",
        `${read} failed at block ${blockNumber}`,
      );
    }
  };
  const holder = (
    await guarded("CakeStakeAdapter.positionOf(recipient)", () =>
      client.readContract({
        abi: cakeStakeAdapterAbi,
        address: input.adapter,
        args: [input.recipient],
        blockNumber,
        functionName: "positionOf",
      }),
    )
  ).toLowerCase() as Address;
  const poolRead = (
    functionName: "withdrawFee" | "withdrawFeePeriod" | "performanceFee",
  ) =>
    guarded(`CAKE Pool ${functionName}()`, () =>
      client.readContract({
        abi: cakePoolPositionAbi,
        address: pool,
        blockNumber,
        functionName,
      }),
    );
  const [code, info, withdrawFee, withdrawFeePeriod, performanceFee] =
    await Promise.all([
      client.getCode({ address: holder, blockNumber }),
      guarded("CAKE Pool userInfo(holder)", () =>
        client.readContract({
          abi: cakePoolPositionAbi,
          address: pool,
          args: [holder],
          blockNumber,
          functionName: "userInfo",
        }),
      ),
      poolRead("withdrawFee"),
      poolRead("withdrawFeePeriod"),
      poolRead("performanceFee"),
    ]);
  if (withdrawFee > 10_000n || performanceFee > 10_000n) {
    throw new ReasonError(
      "POSITION_UNAVAILABLE",
      `CAKE Pool fees ${withdrawFee}/${performanceFee} exceed 10,000 bp at block ${blockNumber}`,
    );
  }
  return {
    holder,
    holderDeployed: code !== undefined && code !== "0x",
    sharesBefore: info[0].toString(),
    withdrawFeeBps: withdrawFee.toString(),
    withdrawFeePeriodSeconds: withdrawFeePeriod.toString(),
    performanceFeeBps: performanceFee.toString(),
  };
}
