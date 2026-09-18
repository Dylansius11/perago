import { decodeFunctionData, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  buildUserOperationNonceKey,
  deriveSemiModularAccountAddress,
  EXECUTE_USER_OP_SELECTOR,
  encodeAccountExecute,
  encodeInstallMandateSession,
  encodeUninstallMandateSession,
  MAX_SESSION_ENTITY_ID,
  packUserOperationSignature,
  ROOT_OWNER_ENTITY_ID,
  wrapExecuteUserOp,
} from "../src/index.js";

const account = "0x17fcCe2B0C0cc44c4F88C6C09b6364a766Ee7944" as const;
const sessionSigner = "0x1111111111111111111111111111111111111111" as const;
const target = "0x2222222222222222222222222222222222222222" as const;
const selector = "0x12345678" as const;

const permission = {
  account,
  entityId: 7,
  nativeSpendLimit: 1_000_000_000_000_000_000n,
  selectors: [selector],
  sessionSigner,
  target,
  validAfter: 1_789_747_000,
  validUntil: 1_789_750_000,
} as const;

const accountAbi = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "result", type: "bytes" }],
    stateMutability: "payable",
  },
] as const;

describe("Modular Account V2 public API", () => {
  it("derives the funded BSC Testnet cross-stack account vector", () => {
    expect(
      deriveSemiModularAccountAddress({
        owner: "0x712683F374Cd524F6336E87D577Fc39d1102930A",
      }),
    ).toBe(account);
    expect(
      deriveSemiModularAccountAddress({
        owner: "0x712683F374Cd524F6336E87D577Fc39d1102930A",
        salt: 1n,
      }),
    ).not.toBe(account);
    expect(() =>
      deriveSemiModularAccountAddress({
        owner: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(RangeError);
  });

  it("packs nonce keys into the documented entity and validation bit positions", () => {
    expect(
      buildUserOperationNonceKey({ entityId: 7, isGlobalValidation: false }),
    ).toBe(7n << 8n);
    expect(
      buildUserOperationNonceKey({ entityId: 7, isGlobalValidation: true }),
    ).toBe((7n << 8n) + 1n);
    expect(
      buildUserOperationNonceKey({
        entityId: 7,
        isGlobalValidation: true,
        nonceKey: 3n,
      }),
    ).toBe((3n << 40n) + (7n << 8n) + 1n);
    expect(() =>
      buildUserOperationNonceKey({
        entityId: 4_294_967_296,
        isGlobalValidation: false,
      }),
    ).toThrow(RangeError);
  });

  it("rejects an ERC-20 approval selector in a session allowlist", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        selectors: ["0x095ea7b3"],
      }),
    ).toThrow(RangeError);
  });

  it("rejects an upgrade selector in a session allowlist", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        selectors: ["0x4f1ef286"],
      }),
    ).toThrow(RangeError);
  });

  it("rejects an empty session allowlist", () => {
    expect(() =>
      encodeInstallMandateSession({ ...permission, selectors: [] }),
    ).toThrow(RangeError);
  });

  it("rejects duplicate session selectors", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        selectors: [selector, selector],
      }),
    ).toThrow(RangeError);
  });

  it("rejects malformed session selectors", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        selectors: ["0x1234" as Hex],
      }),
    ).toThrow(RangeError);
  });

  it("rejects the root owner as a session entity", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        entityId: ROOT_OWNER_ENTITY_ID,
      }),
    ).toThrow(RangeError);
  });

  it("rejects entity ids above the session range", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        entityId: MAX_SESSION_ENTITY_ID + 1,
      }),
    ).toThrow(RangeError);
  });

  it("rejects a session target equal to the account", () => {
    expect(() =>
      encodeInstallMandateSession({ ...permission, target: account }),
    ).toThrow(RangeError);
  });

  it("rejects a zero session target", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        target: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(RangeError);
  });

  it("rejects a zero session signer", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        sessionSigner: "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow(RangeError);
  });

  it("rejects sessions without an expiry", () => {
    expect(() =>
      encodeInstallMandateSession({ ...permission, validUntil: 0 }),
    ).toThrow(RangeError);
  });

  it("rejects sessions whose expiry is not after their start", () => {
    expect(() =>
      encodeInstallMandateSession({
        ...permission,
        validUntil: permission.validAfter,
      }),
    ).toThrow(RangeError);
  });

  it("encodes a narrow session installation with its signer, target, and selector", () => {
    const installData = encodeInstallMandateSession(permission);
    const increasedLimitData = encodeInstallMandateSession({
      ...permission,
      nativeSpendLimit: permission.nativeSpendLimit + 1n,
    });

    expect(installData.startsWith("0x1bbf564c")).toBe(true);
    expect(installData.toLowerCase()).toContain(sessionSigner.slice(2));
    expect(installData.toLowerCase()).toContain(target.slice(2));
    expect(installData.toLowerCase()).toContain(selector.slice(2));
    expect(increasedLimitData).not.toBe(installData);
  });

  it("encodes a session uninstall and preserves its installation guards", () => {
    expect(
      encodeUninstallMandateSession(permission).startsWith("0xb6b1ccfe"),
    ).toBe(true);
    expect(() =>
      encodeUninstallMandateSession({ ...permission, selectors: [] }),
    ).toThrow(RangeError);
  });

  it("encodes and wraps bounded account execution with its signature envelope", () => {
    const data = "0x12345678" as const;
    const executeData = encodeAccountExecute({
      data,
      target,
      value: 42n,
    });
    const decoded = decodeFunctionData({ abi: accountAbi, data: executeData });

    expect(executeData.startsWith("0xb61d27f6")).toBe(true);
    expect(decoded.functionName).toBe("execute");
    expect(decoded.args).toEqual([target, 42n, data]);
    expect(wrapExecuteUserOp(executeData)).toBe(
      `${EXECUTE_USER_OP_SELECTOR}${executeData.slice(2)}`,
    );
    expect(packUserOperationSignature("0x1234")).toBe("0xff001234");
  });
});
