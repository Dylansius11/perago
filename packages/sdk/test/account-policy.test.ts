import { hashTypedData } from "viem";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_EXECUTE_SELECTOR,
  accountPolicyTypeString,
  accountPolicyTypes,
  confirmPolicyActivationRequestSchema,
  getAccountPolicyTypedData,
  hashMandateSessionPermission,
  mandateSessionPermissionSchema,
  walletChallengeRequestSchema,
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
