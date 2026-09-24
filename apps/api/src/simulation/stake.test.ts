import { cakeStakeAdapterAbi } from "@perago/sdk";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  type Hex,
  parseAbi,
} from "viem";
import { bscTestnet } from "viem/chains";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ReasonError } from "../errors.js";
import { readStakePosition } from "./stake.js";

const ADAPTER = "0x00000000000000000000000000000000000000ad";
const POOL = "0x00000000000000000000000000000000000000c0";
const HOLDER = "0x00000000000000000000000000000000000000b0";
const RECIPIENT = "0x00000000000000000000000000000000000000a1";

const poolAbi = parseAbi([
  "function userInfo(address) view returns (uint256 shares, uint256 lastDepositedTime, uint256 cakeAtLastUserAction, uint256 lastUserActionTime, uint256 lockStartTime, uint256 lockEndTime, uint256 userBoostedShare, bool locked, uint256 lockedAmount)",
  "function withdrawFee() view returns (uint256)",
  "function withdrawFeePeriod() view returns (uint256)",
  "function performanceFee() view returns (uint256)",
]);

/** The first `eth_call` parameter: the call object viem sends. */
const callParams = z
  .tuple([
    z.looseObject({
      data: z.custom<Hex>(
        (value) => typeof value === "string" && value.startsWith("0x"),
      ),
      to: z.string(),
    }),
  ])
  .rest(z.unknown());

/** A chain that answers the position reads; `revert` names the pool read that reverts. */
function chain(options: { holderCode: Hex; revert?: string }) {
  return createPublicClient({
    chain: bscTestnet,
    transport: custom({
      async request({ method, params }) {
        if (method === "eth_getCode") return options.holderCode;
        if (method !== "eth_call") throw new Error(`unexpected ${method}`);
        const [{ data, to }] = callParams.parse(params);
        if (to.toLowerCase() === ADAPTER) {
          return encodeFunctionResult({
            abi: cakeStakeAdapterAbi,
            functionName: "positionOf",
            result: HOLDER,
          });
        }
        const { functionName } = decodeFunctionData({ abi: poolAbi, data });
        if (functionName === options.revert) {
          throw Object.assign(new Error("execution reverted"), {
            code: 3,
            data: "0x",
          });
        }
        switch (functionName) {
          case "userInfo":
            return encodeFunctionResult({
              abi: poolAbi,
              functionName,
              result: [700n, 1n, 2n, 3n, 0n, 0n, 0n, false, 0n],
            });
          case "withdrawFee":
            return encodeFunctionResult({
              abi: poolAbi,
              functionName,
              result: 10n,
            });
          case "withdrawFeePeriod":
            return encodeFunctionResult({
              abi: poolAbi,
              functionName,
              result: 259_200n,
            });
          case "performanceFee":
            return encodeFunctionResult({
              abi: poolAbi,
              functionName,
              result: 200n,
            });
        }
      },
    }),
  });
}

const read = (client: ReturnType<typeof chain>) =>
  readStakePosition({
    adapter: ADAPTER,
    blockNumber: 100n,
    client,
    pool: POOL,
    recipient: RECIPIENT,
  });

describe("stake position read", () => {
  it("reads the holder's own shares, its deployment, and the pool fees", async () => {
    await expect(read(chain({ holderCode: "0x6080" }))).resolves.toEqual({
      holder: HOLDER,
      holderDeployed: true,
      sharesBefore: "700",
      withdrawFeeBps: "10",
      withdrawFeePeriodSeconds: "259200",
      performanceFeeBps: "200",
    });
  });

  it("reports a holder the adapter has not deployed yet", async () => {
    const position = await read(chain({ holderCode: "0x" }));
    expect(position.holderDeployed).toBe(false);
  });

  it.each(["userInfo", "withdrawFee", "withdrawFeePeriod", "performanceFee"])(
    "refuses with POSITION_UNAVAILABLE when %s reverts",
    async (revert) => {
      const refusal = await read(chain({ holderCode: "0x6080", revert })).catch(
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(ReasonError);
      expect(refusal).toMatchObject({ code: "POSITION_UNAVAILABLE" });
    },
  );
});
