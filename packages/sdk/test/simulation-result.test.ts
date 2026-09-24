import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";

import {
  ADAPTER_EXECUTE_SELECTOR,
  CAKE_POOL_ID,
  encodeSimulatedAction,
  encodeStakeAction,
  encodeSwapAction,
  hashStakePostcondition,
  hashSwapPostcondition,
  simulationResultSchema,
  taskMandateFromSimulation,
} from "../src/index.js";

const account = "0x1111111111111111111111111111111111111111";
const wbnb = "0xae13d989dac2f0debff460ac112a837c89baa7cd";
const cake = "0xfa60d973f7642b748046464e165a65b7323b0dee";
const hash = (fill: string) => `0x${fill.repeat(64)}` as const;
const contract = (fill: string) => ({
  address: `0x${fill.repeat(40)}`,
  codeHash: hash(fill),
});
const swap = {
  tokenIn: wbnb,
  tokenOut: cake,
  poolFee: "500",
  amountIn: "1000",
  minAmountOut: "990",
  recipient: account,
  deadline: "2000000600",
};

function passingSwap() {
  return {
    schemaVersion: "1",
    status: "PASSED",
    chainId: "97",
    account,
    rootOwner: "0x2222222222222222222222222222222222222222",
    ownerEpoch: "1",
    policyHash: hash("a"),
    intentHash: hash("b"),
    planHash: hash("c"),
    adapterId: "pancakeswap-v3",
    block: { number: "100", hash: hash("d"), timestamp: "2000000000" },
    quoteExpiresAt: "2000000120",
    contracts: {
      mandateExecutor: contract("3"),
      adapter: contract("4"),
      verifier: contract("5"),
      protocolTarget: contract("6"),
      account: contract("1"),
    },
    accountImplementation: `0x${"7".repeat(40)}`,
    verifierId: hash("8"),
    protocol: "PancakeSwap V3",
    mandate: {
      executor: `0x${"9".repeat(40)}`,
      nonce: "42",
      expiresAt: "2000000600",
      commerceContract: "0x0000000000000000000000000000000000000000",
      commerceJobId: "0",
    },
    action: { kind: "SWAP", ...swap },
    actionHash: keccak256(encodeSwapAction(swap)),
    postconditionHash: hashSwapPostcondition(account, cake, "990"),
    inputToken: wbnb,
    maxInput: "1000",
    outputToken: cake,
    minOutput: "990",
    quotedOutput: "1000",
    maxSlippageBps: "100",
    outcomeUnit: "TOKEN",
    recipient: account,
    position: null,
    balances: {
      input: { before: "5000", expectedAfter: "4000" },
      outcome: { before: "7", expectedAfter: "1007" },
    },
    allowanceAfter: "0",
    gasUsed: "200000",
    failure: null,
    risks: ["Price can move within the signed slippage bound."],
  };
}

const stake = {
  asset: cake,
  amount: "1000",
  minPositionOut: "900",
  recipient: account,
  deadline: "2000000600",
  poolId: CAKE_POOL_ID,
};
const holder = `0x${"9".repeat(40)}`;

function passingStake() {
  return {
    ...passingSwap(),
    adapterId: "cake-pool",
    protocol: "PancakeSwap CAKE Pool",
    action: { kind: "STAKE", ...stake },
    actionHash: keccak256(encodeStakeAction(stake)),
    postconditionHash: hashStakePostcondition(account, CAKE_POOL_ID, "900"),
    inputToken: cake,
    outputToken: cake,
    minOutput: "900",
    quotedOutput: "910",
    outcomeUnit: "POOL_SHARES",
    position: {
      holder,
      holderDeployed: true,
      sharesBefore: "7",
      withdrawFeeBps: "10",
      withdrawFeePeriodSeconds: "259200",
      performanceFeeBps: "200",
    },
    balances: {
      input: { before: "5000", expectedAfter: "4000" },
      outcome: { before: "7", expectedAfter: "917" },
    },
  };
}

describe("SimulationResult", () => {
  it("accepts a self-consistent passing swap and derives its mandate", () => {
    const result = simulationResultSchema.parse(passingSwap());
    const mandate = taskMandateFromSimulation(result, hash("f"));

    expect(encodeSimulatedAction(result)).toBe(encodeSwapAction(swap));
    expect(mandate).toMatchObject({
      account,
      adapter: result.contracts.adapter.address,
      adapterSelector: ADAPTER_EXECUTE_SELECTOR,
      maxInput: "1000",
      minOutput: "990",
      nonce: "42",
      expiresAt: "2000000600",
      simulationHash: hash("f"),
      actionHash: result.actionHash,
      postconditionHash: result.postconditionHash,
    });
  });

  it.each([
    [
      "an action hash that does not commit the action",
      { actionHash: hash("0") },
    ],
    [
      "a maximum input other than the action spend",
      {
        maxInput: "999",
        balances: {
          input: { before: "5000", expectedAfter: "4001" },
          outcome: { before: "7", expectedAfter: "1007" },
        },
      },
    ],
    [
      "a minimum other than the action minimum",
      {
        minOutput: "1",
        postconditionHash: hashSwapPostcondition(account, cake, "1"),
      },
    ],
    [
      "a recipient other than the action recipient",
      {
        recipient: `0x${"2".repeat(40)}`,
        postconditionHash: hashSwapPostcondition(
          `0x${"2".repeat(40)}`,
          cake,
          "990",
        ),
      },
    ],
    [
      "a postcondition that commits a different minimum",
      { postconditionHash: hashSwapPostcondition(account, cake, "1") },
    ],
    [
      "an expected outcome below the signed minimum",
      {
        balances: {
          input: { before: "5000", expectedAfter: "4000" },
          outcome: { before: "7", expectedAfter: "996" },
        },
      },
    ],
    [
      "a spend other than exactly the signed input",
      {
        balances: {
          input: { before: "5000", expectedAfter: "4001" },
          outcome: { before: "7", expectedAfter: "1007" },
        },
      },
    ],
    ["a standing allowance after success", { allowanceAfter: "1000" }],
    ["a quote that outlives the mandate", { quoteExpiresAt: "2000000601" }],
    [
      "a half-bound ERC-8183 job",
      {
        mandate: {
          ...passingSwap().mandate,
          commerceJobId: "7",
        },
      },
    ],
    [
      "a pass that records a failure",
      { failure: { reason: "X", detail: null } },
    ],
  ])("rejects %s", (_name, override) => {
    expect(
      simulationResultSchema.safeParse({ ...passingSwap(), ...override })
        .success,
    ).toBe(false);
  });

  it("never derives a mandate from a reverted simulation", () => {
    const reverted = {
      ...passingSwap(),
      status: "REVERTED",
      failure: { reason: "Too little received", detail: null },
    };
    expect(simulationResultSchema.safeParse(reverted).success).toBe(true);
    expect(() => taskMandateFromSimulation(reverted, hash("f"))).toThrow(
      "only a passing simulation can be signed",
    );
  });
});

describe("SimulationResult stake position terms", () => {
  it("accepts a stake that commits its holder, share baseline, and pool fees", () => {
    const result = simulationResultSchema.parse(passingStake());
    expect(result.position).toEqual(passingStake().position);
    expect(encodeSimulatedAction(result)).toBe(encodeStakeAction(stake));
  });

  it.each([
    ["a stake without position terms", { position: null }],
    [
      "a share baseline other than the measured outcome before",
      { position: { ...passingStake().position, sharesBefore: "8" } },
    ],
    [
      "a withdrawal fee above 100%",
      { position: { ...passingStake().position, withdrawFeeBps: "10001" } },
    ],
    [
      "position terms with an unknown field",
      { position: { ...passingStake().position, lockDuration: "0" } },
    ],
  ])("rejects %s", (_name, override) => {
    expect(
      simulationResultSchema.safeParse({ ...passingStake(), ...override })
        .success,
    ).toBe(false);
  });

  it("rejects a swap that carries position terms", () => {
    expect(
      simulationResultSchema.safeParse({
        ...passingSwap(),
        position: passingStake().position,
      }).success,
    ).toBe(false);
  });
});
