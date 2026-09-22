import { readFile } from "node:fs/promises";
import {
  deriveSemiModularAccountAddress,
  getAccountPolicyTypedData,
} from "@perago/sdk";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApp } from "./app.js";
import type { WalletAuthConfig } from "./auth/wallet-auth.js";
import type {
  PolicyChainVerifier,
  PolicyServiceConfig,
} from "./services/policies.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests",
  );
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const migrations = [
  new URL("../drizzle/0000_constrained_lifecycle.sql", import.meta.url),
  new URL("../drizzle/0001_wallet_auth_policy_lifecycle.sql", import.meta.url),
];
const owner = privateKeyToAccount(
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
);
const account = deriveSemiModularAccountAddress({ owner: owner.address });
const mandateExecutor = "0x3333333333333333333333333333333333333333";
const now = new Date("2026-09-20T12:00:00.000Z");
const authConfig: WalletAuthConfig = {
  challengeTtlMs: 300_000,
  domain: "api.perago.test",
  now: () => now,
  sessionTtlMs: 3_600_000,
  uri: "https://api.perago.test",
};
const policyConfig: PolicyServiceConfig = {
  mandateExecutor,
  now: () => now,
  performSelector: "0x12345678",
};
const verifier: PolicyChainVerifier = {
  async verify(expectation) {
    return {
      account: expectation.account,
      activePolicyHash: expectation.activePolicyHash,
      blockNumber: 1234n,
      observedAt: new Date("2026-09-20T12:10:00.000Z"),
      ownerEpoch: expectation.ownerEpoch,
      permissionHash: expectation.permissionHash,
      rootOwner: expectation.rootOwner,
      status: "CONFIRMED",
    };
  },
};

beforeAll(async () => {
  await sql.unsafe("drop schema public cascade; create schema public");
  for (const migration of migrations) {
    await sql.unsafe(await readFile(migration, "utf8"));
  }
});

afterAll(async () => {
  await sql.end();
});

describe("P3-002 API route smoke", () => {
  it("authenticates a real signature and activates a validated policy through Hono", async () => {
    const app = createApiApp({
      authConfig,
      policyConfig,
      policyVerifier: verifier,
      sql,
    });
    const challengeResponse = await app.request("/auth/challenges", {
      body: JSON.stringify({
        account,
        chainId: "97",
        rootOwner: owner.address,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(challengeResponse.status).toBe(201);
    const challenge = (await challengeResponse.json()) as {
      challengeId: string;
      message: string;
    };
    const signature = await owner.signMessage({ message: challenge.message });

    const sessionResponse = await app.request("/auth/sessions", {
      body: JSON.stringify({ challengeId: challenge.challengeId, signature }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(sessionResponse.status).toBe(201);
    const session = (await sessionResponse.json()) as { token: string };
    const authorization = `Bearer ${session.token}`;

    const policyResponse = await app.request("/policies", {
      body: JSON.stringify({
        policy: {
          account,
          activeAssets: [
            {
              maxInputPerTask: "1000000000000000000",
              rollingDailyCap: "3000000000000000000",
              token: "0x5555555555555555555555555555555555555555",
            },
          ],
          allowedRecipients: "SELF",
          approvedAdapterIds: ["pancakeswap-v3"],
          chainId: "97",
          maxSlippageBps: "100",
          maxTaskLifetimeSeconds: "3600",
          protectedAssets: ["0x6666666666666666666666666666666666666666"],
          schemaVersion: "1",
          services: ["SWAP"],
          version: "1",
        },
      }),
      headers: { authorization, "content-type": "application/json" },
      method: "POST",
    });
    expect(policyResponse.status).toBe(201);
    const policy = (await policyResponse.json()) as {
      policyHash: `0x${string}`;
      policyId: string;
    };

    const transition = {
      ownerEpoch: "1",
      permission: {
        account,
        entityId: 9,
        nativeSpendLimit: "0",
        selectors: ["0x12345678"],
        sessionSigner: "0x4444444444444444444444444444444444444444",
        target: mandateExecutor,
        validAfter: "1789905600",
        validUntil: "1789909200",
      },
      validUntil: "1789909200",
    };
    const prepareResponse = await app.request(
      `/policies/${policy.policyId}/activation/prepare`,
      {
        body: JSON.stringify(transition),
        headers: { authorization, "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(prepareResponse.status).toBe(200);
    const prepared = (await prepareResponse.json()) as {
      accountPolicy: Parameters<typeof getAccountPolicyTypedData>[0];
    };
    const typedData = getAccountPolicyTypedData(prepared.accountPolicy, {
      chainId: "97",
      verifyingContract: mandateExecutor,
    });
    const rootSignature = await owner.signTypedData(typedData);

    const hash = `0x${"aa".repeat(32)}`;
    const confirmResponse = await app.request(
      `/policies/${policy.policyId}/activation`,
      {
        body: JSON.stringify({
          ...transition,
          permissionTransactionHash: `0x${"bb".repeat(32)}`,
          permissionUserOperationHash: `0x${"cc".repeat(32)}`,
          rootSignature,
          transactionHash: hash,
          userOperationHash: `0x${"dd".repeat(32)}`,
        }),
        headers: { authorization, "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(confirmResponse.status).toBe(200);
    await expect(confirmResponse.json()).resolves.toEqual({ status: "ACTIVE" });

    const unauthorized = await app.request("/policies", {
      body: JSON.stringify({ policy: {} }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
  });
});
