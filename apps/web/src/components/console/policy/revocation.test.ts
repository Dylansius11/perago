import {
  type Address,
  encodeUninstallMandateSession,
  hashMandateSessionRevocation,
  hashPolicyRevocation,
  hashWalletPolicy,
  type MandateSessionPermissionDocument,
  type PolicyTransitionPrepared,
  type PolicyView,
  toMandateSessionPermission,
  type WalletPolicy,
} from "@perago/sdk";
import { describe, expect, it } from "vitest";
import { assertPreparedRevocation } from "./revocation";

const account: Address = "0x1111111111111111111111111111111111111111";
const owner: Address = "0x2222222222222222222222222222222222222222";
const executor: Address = "0x3333333333333333333333333333333333333333";
const signer: Address = "0x4444444444444444444444444444444444444444";
const wbnb: Address = "0x5555555555555555555555555555555555555555";
const cake: Address = "0x7777777777777777777777777777777777777777";
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
const walletPolicy: WalletPolicy = {
  schemaVersion: "1",
  account,
  chainId: "97",
  version: "3",
  protectedAssets: [cake],
  activeAssets: [
    { token: wbnb, maxInputPerTask: "100", rollingDailyCap: "200" },
  ],
  services: ["SWAP"],
  approvedAdapterIds: ["pancakeswap-v3"],
  maxSlippageBps: "100",
  allowedRecipients: "SELF",
  maxTaskLifetimeSeconds: "1800",
};
const active: PolicyView = {
  policyId: "a68ff009-034d-4906-8779-837f7c965b6e",
  version: "3",
  status: "ACTIVE",
  policyHash: hashWalletPolicy(walletPolicy),
  policy: walletPolicy,
  permission,
  validUntil: permission.validUntil,
  createdAt: "2026-10-28T07:01:22.049Z",
  updatedAt: "2026-10-28T07:02:01.000Z",
};
const permissionHash = hashMandateSessionRevocation(permission);
const prepared: PolicyTransitionPrepared = {
  accountPolicy: {
    account,
    chainId: "97",
    ownerEpoch: "1",
    permissionHash,
    policyHash: hashPolicyRevocation(active.policyHash),
    rootOwner: owner,
    validUntil: "2000086400",
  },
  allowances: [
    { amount: "0", token: wbnb },
    { amount: "0", token: cake },
  ],
  permissionCallData: encodeUninstallMandateSession(
    toMandateSessionPermission(permission),
  ),
  permissionHash,
};
const input = {
  account,
  owner,
  chainId: "97",
  ownerEpoch: "1",
  validUntil: "2000086400",
  policy: active,
  prepared,
  tokens: [wbnb, cake],
};

describe("prepared policy revocation", () => {
  it("accepts exactly the revocation of the active policy and returns zero allowances", () => {
    expect(assertPreparedRevocation(input)).toEqual([
      { amount: 0n, token: wbnb },
      { amount: 0n, token: cake },
    ]);
  });

  it("refuses a revocation hash for some other policy", () => {
    expect(() =>
      assertPreparedRevocation({
        ...input,
        prepared: {
          ...prepared,
          accountPolicy: {
            ...prepared.accountPolicy,
            policyHash: hashPolicyRevocation(`0x${"ab".repeat(32)}`),
          },
        },
      }),
    ).toThrow(/differs from the active policy/u);
  });

  it("refuses a call that is not the uninstall of the installed session", () => {
    expect(() =>
      assertPreparedRevocation({
        ...input,
        prepared: { ...prepared, permissionCallData: "0x1234" },
      }),
    ).toThrow(/differs from the active policy/u);
  });

  it("refuses a different owner epoch, signer, or expiry than the one requested", () => {
    for (const accountPolicy of [
      { ...prepared.accountPolicy, ownerEpoch: "2" },
      { ...prepared.accountPolicy, rootOwner: signer },
      { ...prepared.accountPolicy, validUntil: "2000086401" },
    ]) {
      expect(() =>
        assertPreparedRevocation({
          ...input,
          prepared: { ...prepared, accountPolicy },
        }),
      ).toThrow(/differs from the active policy/u);
    }
  });

  it("refuses an allowance that is not zero or a token set that is not the catalog", () => {
    expect(() =>
      assertPreparedRevocation({
        ...input,
        prepared: {
          ...prepared,
          allowances: [
            { amount: "1", token: wbnb },
            { amount: "0", token: cake },
          ],
        },
      }),
    ).toThrow(/every catalog allowance to zero/u);
    expect(() =>
      assertPreparedRevocation({
        ...input,
        prepared: { ...prepared, allowances: [{ amount: "0", token: wbnb }] },
      }),
    ).toThrow(/every catalog allowance to zero/u);
  });

  it("refuses a policy that is not active or has no installed session", () => {
    expect(() =>
      assertPreparedRevocation({
        ...input,
        policy: { ...active, status: "SUPERSEDED" },
      }),
    ).toThrow(/Only an active policy/u);
    expect(() =>
      assertPreparedRevocation({
        ...input,
        policy: { ...active, permission: null },
      }),
    ).toThrow(/Only an active policy/u);
  });
});
