import {
  type Address,
  type CompiledPlan,
  encodeInstallMandateSession,
  encodeSwapAction,
  getTaskMandateTypedData,
  type Hash,
  hashCompiledPlan,
  hashMandateSessionPermission,
  hashSimulationResult,
  hashSwapPostcondition,
  hashWalletPolicy,
  type MandateSessionPermissionDocument,
  type PolicyTransitionPrepared,
  simulationResultSchema,
  taskMandateFromSimulation,
  toMandateSessionPermission,
  type WalletPolicy,
} from "@perago/sdk";
import { hashTypedData, keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { assertPreparedMandate, assertPreparedPolicy } from "./authority";

const account: Address = "0x1111111111111111111111111111111111111111";
const owner: Address = "0x2222222222222222222222222222222222222222";
const executor: Address = "0x3333333333333333333333333333333333333333";
const signer: Address = "0x4444444444444444444444444444444444444444";
const token: Address = "0x5555555555555555555555555555555555555555";
const permission: MandateSessionPermissionDocument = {
  account,
  entityId: 7,
  nativeSpendLimit: "0",
  selectors: ["0x7653979f"],
  sessionSigner: signer,
  target: executor,
  validAfter: "1999999000",
  validUntil: "2000000000",
};
const policy = {
  schemaVersion: "1",
  account,
  chainId: "97",
  version: "1",
  protectedAssets: [],
  activeAssets: [{ token, maxInputPerTask: "100", rollingDailyCap: "200" }],
  services: ["SWAP"],
  approvedAdapterIds: ["pancakeswap-v3"],
  maxSlippageBps: "100",
  allowedRecipients: "SELF",
  maxTaskLifetimeSeconds: "1800",
} as const satisfies WalletPolicy;
const permissionHash = hashMandateSessionPermission(permission);
const prepared: PolicyTransitionPrepared = {
  accountPolicy: {
    account,
    chainId: "97",
    ownerEpoch: "1",
    permissionHash,
    policyHash: hashWalletPolicy(policy),
    rootOwner: owner,
    validUntil: permission.validUntil,
  },
  permissionCallData: encodeInstallMandateSession(
    toMandateSessionPermission(permission),
  ),
  permissionHash,
};
const review: Parameters<typeof assertPreparedPolicy>[0] = {
  account,
  owner,
  chainId: "97",
  policy,
  transition: {
    ownerEpoch: "1",
    validUntil: permission.validUntil,
    permission,
  },
  prepared,
};

describe("owner policy preparation", () => {
  it("accepts only calldata and EIP-712 commitments derived from the user's permission", () => {
    expect(() => assertPreparedPolicy(review)).not.toThrow();
    expect(() =>
      assertPreparedPolicy({
        ...review,
        prepared: { ...prepared, permissionCallData: "0xdeadbeef" },
      }),
    ).toThrow(/prepared policy/i);
    expect(() =>
      assertPreparedPolicy({
        ...review,
        prepared: {
          ...prepared,
          accountPolicy: {
            ...prepared.accountPolicy,
            permissionHash: `0x${"a".repeat(64)}` as `0x${string}`,
          },
        },
      }),
    ).toThrow(/prepared policy/i);
    expect(() =>
      assertPreparedPolicy({
        ...review,
        prepared: {
          ...prepared,
          accountPolicy: {
            ...prepared.accountPolicy,
            policyHash: `0x${"b".repeat(64)}` as `0x${string}`,
          },
        },
      }),
    ).toThrow(/prepared policy/i);
  });
});

const h = (digit: string) => `0x${digit.repeat(64)}` as Hash;
const contract = (digit: string) => ({
  address: `0x${digit.repeat(40)}` as Address,
  codeHash: h(digit),
});
const outputToken: Address = "0x6666666666666666666666666666666666666666";
const plan: CompiledPlan = {
  schemaVersion: "1",
  chainId: "97",
  account,
  policyHash: h("a"),
  intentHash: h("b"),
  lifetimeSeconds: "600",
  action: {
    kind: "SWAP",
    adapterId: "pancakeswap-v3",
    inputToken: token,
    inputAmount: "100",
    outputToken,
    poolFee: "500",
    maxSlippageBps: "100",
    recipient: account,
  },
};
const swap = {
  tokenIn: token,
  tokenOut: outputToken,
  poolFee: "500",
  amountIn: "100",
  minAmountOut: "90",
  recipient: account,
  deadline: "2000000600",
};
const simulation = simulationResultSchema.parse({
  schemaVersion: "1",
  status: "PASSED",
  chainId: "97",
  account,
  rootOwner: owner,
  ownerEpoch: "1",
  policyHash: plan.policyHash,
  intentHash: plan.intentHash,
  planHash: hashCompiledPlan(plan),
  adapterId: "pancakeswap-v3",
  block: { number: "100", hash: h("d"), timestamp: "2000000000" },
  quoteExpiresAt: "2000000120",
  contracts: {
    mandateExecutor: contract("3"),
    adapter: contract("4"),
    verifier: contract("5"),
    protocolTarget: contract("6"),
    account: contract("1"),
  },
  accountImplementation: contract("7").address,
  verifierId: h("8"),
  protocol: "PancakeSwap V3",
  mandate: {
    executor: signer,
    nonce: "42",
    expiresAt: "2000000600",
    commerceContract: "0x0000000000000000000000000000000000000000",
    commerceJobId: "0",
  },
  action: { kind: "SWAP", ...swap },
  actionHash: keccak256(encodeSwapAction(swap)),
  postconditionHash: hashSwapPostcondition(account, outputToken, "90"),
  inputToken: token,
  maxInput: "100",
  outputToken,
  minOutput: "90",
  quotedOutput: "100",
  maxSlippageBps: "100",
  outcomeUnit: "TOKEN",
  recipient: account,
  position: null,
  balances: {
    input: { before: "500", expectedAfter: "400" },
    outcome: { before: "0", expectedAfter: "100" },
  },
  allowanceAfter: "0",
  gasUsed: "200000",
  failure: null,
  risks: ["Execution remains subject to current pool state."],
});
const simulationHash = hashSimulationResult(simulation);
const mandate = taskMandateFromSimulation(simulation, simulationHash);
const domain = { chainId: "97", verifyingContract: contract("3").address };
const signed = {
  domain,
  mandate,
  mandateHash: hashTypedData(getTaskMandateTypedData(mandate, domain)),
  simulation,
  simulationHash,
  simulationId: "11111111-1111-4111-8111-111111111111",
  taskStatus: "READY_TO_SIGN" as const,
};
const mandateReview = {
  prepared: signed,
  plan,
  planHash: hashCompiledPlan(plan),
  intentHash: plan.intentHash,
  simulationHash,
  owner,
  account,
  executor: signer,
  chainId: "97",
  mandateExecutor: domain.verifyingContract,
};

describe("owner mandate preparation", () => {
  it("refuses a domain or amount that differs from the simulated reviewed plan", () => {
    expect(() => assertPreparedMandate(mandateReview)).not.toThrow();
    expect(() =>
      assertPreparedMandate({
        ...mandateReview,
        prepared: {
          ...signed,
          domain: { ...domain, verifyingContract: contract("9").address },
        },
      }),
    ).toThrow(/prepared mandate/i);
    expect(() =>
      assertPreparedMandate({
        ...mandateReview,
        prepared: { ...signed, mandate: { ...mandate, maxInput: "101" } },
      }),
    ).toThrow(/prepared mandate/i);
  });
});
