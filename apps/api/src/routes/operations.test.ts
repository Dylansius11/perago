import { encodeOwnerWithdrawal, type UserOperationRequest } from "@perago/sdk";
import type { Sql } from "postgres";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import type { WalletAuthConfig, WalletIdentity } from "../auth/wallet-auth.js";
import { ReasonError } from "../errors.js";
import { createSponsorship } from "../services/sponsorship.js";
import { createOperationRoutes } from "./operations.js";

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("../auth/wallet-auth.js", () => ({
  authenticateWalletSession: authenticate,
}));

const account = "0x1111111111111111111111111111111111111111" as const;
const owner = "0x2222222222222222222222222222222222222222" as const;
const stranger = "0x3333333333333333333333333333333333333333" as const;
const hash = `0x${"ab".repeat(32)}` as const;
const wallet: WalletIdentity = {
  account,
  rootOwner: owner,
  chainId: "97",
  ownerEpoch: "0",
  expiresAt: "2030-01-01T00:00:00.000Z",
  walletId: "wallet",
};
const authConfig: WalletAuthConfig = {
  challengeTtlMs: 300_000,
  domain: "localhost",
  uri: "http://localhost",
  now: () => new Date(),
  sessionTtlMs: 3_600_000,
};

function setup() {
  authenticate.mockResolvedValue(wallet);
  const sent: { method: string; params: unknown[] }[] = [];
  const sponsorship = createSponsorship(
    {
      mandateExecutor: "0x4444444444444444444444444444444444444444",
      tokens: [],
      wbnb: "0x5555555555555555555555555555555555555555",
    },
    async (call) => {
      sent.push(call);
      return call.method === "eth_sendUserOperation"
        ? hash
        : {
            callGasLimit: "0x186a0",
            preVerificationGas: "0x5208",
            verificationGasLimit: "0x30d40",
          };
    },
  );
  const routes = createOperationRoutes({
    authConfig,
    sponsorship,
    sql: {} as Sql,
  });
  routes.onError((error, context) => {
    if (error instanceof ReasonError)
      return context.json({ code: error.code }, 409);
    if (error instanceof ZodError)
      return context.json({ code: "INVALID_REQUEST" }, 400);
    throw error;
  });
  return { routes, sent };
}

const operation = (
  recipient = owner as `0x${string}`,
): UserOperationRequest => ({
  sender: account,
  nonce: "0x1",
  signature: "0xff0011",
  callData: encodeOwnerWithdrawal({
    owner: recipient,
    legs: [{ kind: "NATIVE", amount: 1n }],
  }),
  callGasLimit: "0x186a0",
  preVerificationGas: "0x5208",
  verificationGasLimit: "0x30d40",
  maxFeePerGas: "0x0",
  maxPriorityFeePerGas: "0x0",
});

function request(body: unknown, estimate: boolean) {
  return new Request(`http://localhost/${estimate ? "estimate" : ""}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${"a".repeat(43)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("session-bound withdrawal sponsorship routes", () => {
  it.each([false, true])(
    "uses the authenticated root owner for estimate=%s",
    async (estimate) => {
      const { routes, sent } = setup();
      const body = estimate
        ? { callData: operation().callData, nonce: "1" }
        : operation();
      const response = await routes.fetch(request(body, estimate));
      expect(response.status).toBe(estimate ? 200 : 202);
      expect(sent).toHaveLength(1);
      expect(sent[0]?.params[0]).toMatchObject({
        sender: account,
        callData: operation().callData,
      });
    },
  );

  it.each([false, true])(
    "refuses a stranger destination for estimate=%s",
    async (estimate) => {
      const { routes, sent } = setup();
      const body = estimate
        ? { callData: operation(stranger).callData, nonce: "1" }
        : operation(stranger);
      const response = await routes.fetch(request(body, estimate));
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ code: "SPONSORSHIP_REFUSED" });
      expect(sent).toHaveLength(0);
    },
  );

  it.each([false, true])(
    "never trusts an owner injected into the request body for estimate=%s",
    async (estimate) => {
      const { routes, sent } = setup();
      const payload = estimate
        ? { callData: operation(stranger).callData, nonce: "1" }
        : operation(stranger);
      const response = await routes.fetch(
        request({ ...payload, owner: stranger }, estimate),
      );
      // Operation schemas are closed: an injected owner is rejected, not used as authority.
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: "INVALID_REQUEST" });
      expect(sent).toHaveLength(0);
    },
  );
});
