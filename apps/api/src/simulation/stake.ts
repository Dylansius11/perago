import {
  type Address,
  CAKE_POOL_ID,
  cakeStakeAdapterAbi,
  type StakeAction,
  type StakePlan,
} from "@perago/sdk";
import { type PublicClient, parseAbi } from "viem";

const cakePoolTermsAbi = parseAbi([
  "function withdrawFee() view returns (uint256)",
  "function withdrawFeePeriod() view returns (uint256)",
  "function performanceFee() view returns (uint256)",
]);

export type PoolTerms = {
  performanceFeeBps: bigint;
  withdrawFeeBps: bigint;
  withdrawFeePeriodSeconds: bigint;
};

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

/** The recipient's position holder; the adapter deploys it on first stake. */
export async function positionHolderOf(input: {
  adapter: Address;
  blockNumber: bigint;
  client: PublicClient;
  recipient: Address;
}): Promise<Address> {
  const holder = await input.client.readContract({
    abi: cakeStakeAdapterAbi,
    address: input.adapter,
    args: [input.recipient],
    blockNumber: input.blockNumber,
    functionName: "positionOf",
  });
  return holder.toLowerCase() as Address;
}

/** Fees the pool charges, read at the simulation block for the risk statement. */
export async function readPoolTerms(input: {
  blockNumber: bigint;
  client: PublicClient;
  pool: Address;
}): Promise<PoolTerms> {
  const read = (functionName: (typeof cakePoolTermsAbi)[number]["name"]) =>
    input.client.readContract({
      abi: cakePoolTermsAbi,
      address: input.pool,
      blockNumber: input.blockNumber,
      functionName,
    });
  const [withdrawFeeBps, withdrawFeePeriodSeconds, performanceFeeBps] =
    await Promise.all([
      read("withdrawFee"),
      read("withdrawFeePeriod"),
      read("performanceFee"),
    ]);
  return { performanceFeeBps, withdrawFeeBps, withdrawFeePeriodSeconds };
}
