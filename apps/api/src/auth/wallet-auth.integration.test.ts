import { readFile } from "node:fs/promises";
import {
  deriveSemiModularAccountAddress,
  type WalletChallengeRequest,
} from "@perago/sdk";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  authenticateWalletSession,
  createWalletChallenge,
  verifyWalletChallenge,
  type WalletAuthConfig,
} from "./wallet-auth.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests",
  );
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
const migrations = [
  new URL("../../drizzle/0000_constrained_lifecycle.sql", import.meta.url),
  new URL(
    "../../drizzle/0001_wallet_auth_policy_lifecycle.sql",
    import.meta.url,
  ),
  new URL("../../drizzle/0002_task_compilation.sql", import.meta.url),
  new URL("../../drizzle/0003_mandate_signing.sql", import.meta.url),
  new URL("../../drizzle/0004_execution_worker.sql", import.meta.url),
  new URL("../../drizzle/0005_chain_event_reorg_versions.sql", import.meta.url),
];
const owner = privateKeyToAccount(
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
);
const account = deriveSemiModularAccountAddress({ owner: owner.address });
const baseTime = new Date("2026-09-20T12:00:00.000Z");

function config(now = baseTime): WalletAuthConfig {
  return {
    challengeTtlMs: 5 * 60_000,
    domain: "api.perago.test",
    now: () => now,
    sessionTtlMs: 60 * 60_000,
    uri: "https://api.perago.test",
  };
}

function request(
  overrides: Partial<WalletChallengeRequest> = {},
): WalletChallengeRequest {
  return {
    account,
    chainId: "97",
    rootOwner: owner.address,
    ...overrides,
  };
}

beforeAll(async () => {
  await sql.unsafe("drop schema public cascade; create schema public");
  for (const migration of migrations) {
    await sql.unsafe(await readFile(migration, "utf8"));
  }
});

afterAll(async () => {
  await sql.end();
});

describe("P3-002 wallet authentication", () => {
  it("binds a signed challenge to domain, chain, owner, account, and expiry then consumes it once", async () => {
    const challenge = await createWalletChallenge(sql, request(), config());

    expect(challenge.message).toContain("api.perago.test");
    expect(challenge.message).toContain("Chain ID: 97");
    expect(challenge.message.toLowerCase()).toContain(
      `root owner: ${owner.address.toLowerCase()}`,
    );
    expect(challenge.message.toLowerCase()).toContain(
      `smart account: ${account.toLowerCase()}`,
    );
    expect(challenge.expiresAt).toBe("2026-09-20T12:05:00.000Z");

    const signature = await owner.signMessage({ message: challenge.message });
    const session = await verifyWalletChallenge(
      sql,
      { challengeId: challenge.challengeId, signature },
      config(),
    );

    expect(session).toMatchObject({
      account: account.toLowerCase(),
      chainId: "97",
      rootOwner: owner.address.toLowerCase(),
    });
    await expect(
      verifyWalletChallenge(
        sql,
        { challengeId: challenge.challengeId, signature },
        config(),
      ),
    ).rejects.toThrow("challenge has already been consumed");

    await expect(
      authenticateWalletSession(sql, session.token, baseTime),
    ).resolves.toMatchObject({
      account: account.toLowerCase(),
      chainId: "97",
      rootOwner: owner.address.toLowerCase(),
    });
    await expect(
      authenticateWalletSession(sql, `${session.token}x`, baseTime),
    ).rejects.toThrow("wallet session is invalid");
  });

  it("rejects mismatched and expired account ownership claims", async () => {
    await expect(
      createWalletChallenge(
        sql,
        request({
          account: "0x1111111111111111111111111111111111111111",
        }),
        config(),
      ),
    ).rejects.toThrow("smart account does not match the root owner");

    const challenge = await createWalletChallenge(sql, request(), config());
    const signature = await owner.signMessage({ message: challenge.message });
    await expect(
      verifyWalletChallenge(
        sql,
        { challengeId: challenge.challengeId, signature },
        config(new Date("2026-09-20T12:05:00.001Z")),
      ),
    ).rejects.toThrow("challenge has expired");
  });
});
