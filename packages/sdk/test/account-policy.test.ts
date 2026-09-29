import { decodeFunctionData, erc20Abi, hashTypedData } from "viem";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_EXECUTE_SELECTOR,
  accountPolicyTypeString,
  accountPolicyTypes,
  confirmPolicyActivationRequestSchema,
  deriveExecutorAllowances,
  encodeAccountPolicyTransition,
  getAccountPolicyTypedData,
  hashMandateSessionPermission,
  mandateExecutorAbi,
  mandateSessionPermissionSchema,
  walletChallengeRequestSchema,
  walletPolicySchema,
} from "../src/index.js";

const account = "0x1111111111111111111111111111111111111111";
const owner = "0x2222222222222222222222222222222222222222";
const executor = "0x3333333333333333333333333333333333333333";
const sessionSigner = "0x4444444444444444444444444444444444444444";
const policyHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const permission = {
  account,
  entityId: 7,
  nativeSpendLimit: "0",
  selectors: ["0x12345678"],
  sessionSigner,
  target: executor,
  validAfter: "1700000000",
  validUntil: "1700003600",
};

describe("P3-002 SDK policy API", () => {
  it("binds authentication requests to one owner, smart account, and chain", () => {
    expect(
      walletChallengeRequestSchema.parse({
        account,
        chainId: "97",
        rootOwner: owner,
      }),
    ).toEqual({
      account,
      chainId: "97",
      rootOwner: owner,
    });
    expect(() =>
      walletChallengeRequestSchema.parse({
        account,
        chainId: "97",
        rootOwner: owner,
        redirect: "https://attacker.test",
      }),
    ).toThrow();
  });

  it("accepts one atomic transition identity and rejects split evidence", () => {
    const request = {
      ownerEpoch: "1",
      permission,
      rootSignature: `0x${"11".repeat(65)}`,
      transactionHash: `0x${"22".repeat(32)}`,
      userOperationHash: `0x${"33".repeat(32)}`,
      validUntil: permission.validUntil,
    };
    expect(confirmPolicyActivationRequestSchema.parse(request)).toEqual(
      request,
    );
    expect(() =>
      confirmPolicyActivationRequestSchema.parse({
        ...request,
        permissionTransactionHash: `0x${"44".repeat(32)}`,
      }),
    ).toThrow();
  });

  it("rejects root, privileged, duplicate, and unbounded session permissions", () => {
    expect(mandateSessionPermissionSchema.parse(permission)).toEqual(
      permission,
    );
    expect(() =>
      mandateSessionPermissionSchema.parse({ ...permission, entityId: 0 }),
    ).toThrow();
    expect(() =>
      mandateSessionPermissionSchema.parse({
        ...permission,
        selectors: [ACCOUNT_EXECUTE_SELECTOR],
      }),
    ).toThrow();
    expect(() =>
      mandateSessionPermissionSchema.parse({
        ...permission,
        selectors: ["0x12345678", "0x12345678"],
      }),
    ).toThrow();
    expect(() =>
      mandateSessionPermissionSchema.parse({ ...permission, validUntil: "0" }),
    ).toThrow();
  });

  it("matches the AccountPolicy EIP-712 field order and hashes exact permission bytes", () => {
    const permissionHash = hashMandateSessionPermission(permission);
    const typedData = getAccountPolicyTypedData(
      {
        account,
        chainId: "97",
        ownerEpoch: "1",
        permissionHash,
        policyHash,
        rootOwner: owner,
        validUntil: "1700003600",
      },
      { chainId: "97", verifyingContract: executor },
    );

    expect(accountPolicyTypeString).toBe(
      "AccountPolicy(address account,address rootOwner,uint64 ownerEpoch,uint256 chainId,bytes32 policyHash,bytes32 permissionHash,uint48 validUntil)",
    );
    expect(
      accountPolicyTypes.AccountPolicy.map(
        (field) => `${field.type} ${field.name}`,
      ),
    ).toEqual([
      "address account",
      "address rootOwner",
      "uint64 ownerEpoch",
      "uint256 chainId",
      "bytes32 policyHash",
      "bytes32 permissionHash",
      "uint48 validUntil",
    ]);
    expect(typedData.types.EIP712Domain).toEqual([
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ]);
    expect(permissionHash).toMatch(/^0x[0-9a-f]{64}$/u);
    const walletPayloadDigest = hashTypedData(typedData);
    expect(walletPayloadDigest).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(walletPayloadDigest).toBe(
      hashTypedData({
        ...typedData,
        types: { AccountPolicy: typedData.types.AccountPolicy },
      }),
    );
    expect(() =>
      getAccountPolicyTypedData(typedData.message, {
        chainId: "56",
        verifyingContract: executor,
      }),
    ).toThrow();
  });
});

const batchAbi = [
  {
    type: "function",
    name: "executeBatch",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    outputs: [{ name: "results", type: "bytes[]" }],
    stateMutability: "payable",
  },
] as const;

const activeToken = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const protectedToken = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const unlistedToken = "0xcccccccccccccccccccccccccccccccccccccccc";
/** Catalog order is unrelated to policy order, and callers may hand back any casing. */
const catalogTokens = [unlistedToken, protectedToken, activeToken];
const upperCasedTokens = catalogTokens.map(
  (token) => token.toUpperCase().replace("0X", "0x") as `0x${string}`,
);
const executorPolicy = walletPolicySchema.parse({
  account,
  activeAssets: [
    { maxInputPerTask: "7", rollingDailyCap: "500", token: activeToken },
  ],
  allowedRecipients: "SELF",
  approvedAdapterIds: ["pancakeswap-v3"],
  chainId: "97",
  maxSlippageBps: "100",
  maxTaskLifetimeSeconds: "1800",
  protectedAssets: [protectedToken],
  schemaVersion: "1",
  services: ["SWAP"],
  version: "3",
});

describe("standing MandateExecutor allowance", () => {
  it("derives one allowance per catalog token: active cap, everything else zero", () => {
    expect(deriveExecutorAllowances(executorPolicy, catalogTokens)).toEqual([
      { token: unlistedToken, amount: 0n },
      { token: protectedToken, amount: 0n },
      { token: activeToken, amount: 500n },
    ]);
    // Policy and catalog are compared case-insensitively, and the catalog entry is what gets approved.
    expect(deriveExecutorAllowances(executorPolicy, upperCasedTokens)).toEqual(
      upperCasedTokens.map((token, index) => ({
        token,
        amount: index === 2 ? 500n : 0n,
      })),
    );
    expect(
      deriveExecutorAllowances(
        {
          ...executorPolicy,
          activeAssets: [
            {
              maxInputPerTask: "7",
              rollingDailyCap: "500",
              token: upperCasedTokens[2],
            },
          ],
        },
        [activeToken],
      ),
    ).toEqual([{ token: activeToken, amount: 500n }]);
  });

  it("batches the install, the policy registration, and one bounded approve per token", () => {
    const permissionCallData = `0x${"ab".repeat(4)}` as `0x${string}`;
    const callData = encodeAccountPolicyTransition({
      account,
      allowances: deriveExecutorAllowances(executorPolicy, catalogTokens),
      mandateExecutor: executor,
      permissionCallData,
      policy: {
        account,
        chainId: "97",
        ownerEpoch: "1",
        permissionHash: hashMandateSessionPermission(permission),
        policyHash,
        rootOwner: owner,
        validUntil: "1700003600",
      },
      rootSignature: `0x${"11".repeat(65)}`,
    });

    const batch = decodeFunctionData({ abi: batchAbi, data: callData });
    expect(batch.functionName).toBe("executeBatch");
    const calls = batch.args[0];
    expect(calls.map((call) => call.target.toLowerCase())).toEqual([
      account,
      executor,
      ...catalogTokens,
    ]);
    expect(calls.map((call) => call.value)).toEqual([0n, 0n, 0n, 0n, 0n]);
    expect(calls[0].data).toBe(permissionCallData);
    expect(
      decodeFunctionData({ abi: mandateExecutorAbi, data: calls[1].data })
        .functionName,
    ).toBe("setAccountPolicy");
    expect(
      calls
        .slice(2)
        .map(
          (call) => decodeFunctionData({ abi: erc20Abi, data: call.data }).args,
        ),
    ).toEqual([
      [executor, 0n],
      [executor, 0n],
      [executor, 500n],
    ]);
  });

  it("keeps a zero approve for every catalog token when a policy is revoked", () => {
    const callData = encodeAccountPolicyTransition({
      account,
      allowances: catalogTokens.map((entry) => ({ amount: 0n, token: entry })),
      mandateExecutor: executor,
      permissionCallData: `0x${"cd".repeat(4)}`,
      policy: {
        account,
        chainId: "97",
        ownerEpoch: "1",
        permissionHash: hashMandateSessionPermission(permission),
        policyHash,
        rootOwner: owner,
        validUntil: "1700003600",
      },
      rootSignature: `0x${"11".repeat(65)}`,
    });

    const calls = decodeFunctionData({ abi: batchAbi, data: callData }).args[0];
    expect(calls).toHaveLength(2 + catalogTokens.length);
    expect(
      calls
        .slice(2)
        .map(
          (call) => decodeFunctionData({ abi: erc20Abi, data: call.data }).args,
        ),
    ).toEqual(catalogTokens.map(() => [executor, 0n]));
  });
});
