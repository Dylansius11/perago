import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WalletAuthConfig } from "../auth/wallet-auth.js";
import type { ReasonError } from "../errors.js";
import { createFaucetRoutes } from "../routes/faucet.js";
import {
  assertFaucetChain,
  claimFaucet,
  type FaucetServiceConfig,
  type FaucetTransport,
  getFaucetStatus,
} from "./faucet.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for database integration tests",
  );
}

const sql = postgres(databaseUrl, { max: 5, onnotice: () => {} });
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
  new URL("../../drizzle/0006_commerce_settlement.sql", import.meta.url),
  new URL("../../drizzle/0007_faucet_claims.sql", import.meta.url),
];

const now = new Date("2026-09-27T12:00:00.000Z");
const faucetAddress = "0xf53bc07b954a4fca81996c4c9bae489082b58781" as const;
const account = (seed: number) =>
  `0x${seed.toString(16).padStart(40, "0")}` as const;
const uuid = (seed: number) =>
  `00000000-0000-4000-8000-${seed.toString().padStart(12, "0")}`;

function identity(seed: number) {
  return {
    account: account(seed),
    chainId: "97",
    expiresAt: "2026-09-27T13:00:00.000Z",
    ownerEpoch: "0",
    rootOwner: account(seed + 10_000),
    walletId: uuid(seed),
  };
}

async function seedWallet(db: Sql, seed: number): Promise<void> {
  const wallet = identity(seed);
  await db`
    insert into wallets (
      id, chain_id, account_address, root_owner_address, account_type,
      account_version, entry_point_address, owner_epoch
    ) values (
      ${wallet.walletId}, 97, ${Buffer.from(wallet.account.slice(2), "hex")},
      ${Buffer.from(wallet.rootOwner.slice(2), "hex")}, 'ALCHEMY_MODULAR_V2',
      '2.0.0', ${Buffer.alloc(20, 1)}, 0
    )
  `;
}

function transport(
  input: {
    balances?: Map<string, bigint>;
    onSend?: () => void | Promise<void>;
  } = {},
): FaucetTransport & { sends: { to: `0x${string}`; value: bigint }[] } {
  const balances = input.balances ?? new Map<string, bigint>();
  const sends: { to: `0x${string}`; value: bigint }[] = [];
  let sequence = 0;
  return {
    async balanceOf(address) {
      return (
        balances.get(address) ??
        (address === faucetAddress ? 1_000_000_000_000_000_000n : 0n)
      );
    },
    async receiptStatus() {
      return null;
    },
    async send(request) {
      await input.onSend?.();
      sends.push(request);
      sequence += 1;
      return `0x${sequence.toString(16).padStart(64, "0")}`;
    },
    sends,
  };
}

function config(
  transportInput: FaucetTransport,
  overrides: Partial<FaucetServiceConfig> = {},
): FaucetServiceConfig {
  return {
    amountWei: 20_000_000_000_000_000n,
    claimWindowMs: 86_400_000,
    faucetAddress,
    fundedThresholdWei: 50_000_000_000_000_000n,
    globalBudgetWei: 1_000_000_000_000_000_000n,
    ipClaimLimit: 3,
    ipSalt: "test-only-salt-with-enough-length",
    now: () => now,
    transport: transportInput,
    ...overrides,
  };
}

async function expectReason(
  action: () => Promise<unknown>,
  code:
    | "FAUCET_ALREADY_CLAIMED"
    | "FAUCET_ACCOUNT_FUNDED"
    | "FAUCET_BUDGET_EXHAUSTED"
    | "FAUCET_RATE_LIMITED"
    | "FAUCET_UNAVAILABLE",
): Promise<void> {
  await expect(action()).rejects.toMatchObject<Partial<ReasonError>>({ code });
}

beforeAll(async () => {
  await sql.unsafe("drop schema public cascade; create schema public");
  for (const migration of migrations) {
    await sql.unsafe(await readFile(migration, "utf8"));
  }
});

beforeEach(async () => {
  await sql.unsafe("truncate faucet_claims, wallets cascade");
});

afterAll(async () => {
  await sql.end();
});

describe("P7-003 faucet claims", () => {
  it("requires a wallet session before accepting a claim", async () => {
    const authConfig: WalletAuthConfig = {
      challengeTtlMs: 300_000,
      domain: "api.perago.test",
      now: () => now,
      sessionTtlMs: 3_600_000,
      uri: "https://api.perago.test",
    };
    const routes = createFaucetRoutes({
      authConfig,
      config: config(transport()),
      sql,
      trustProxy: false,
    });

    const response = await routes.request("/claims", {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "AUTH_REQUIRED", message: "wallet session required" },
    });
  });
  it("returns 429 with the stable rate-limit reason", async () => {
    const authConfig: WalletAuthConfig = {
      challengeTtlMs: 300_000,
      domain: "api.perago.test",
      now: () => now,
      sessionTtlMs: 3_600_000,
      uri: "https://api.perago.test",
    };
    const chain = transport();
    const routes = createFaucetRoutes({
      authConfig,
      config: config(chain),
      sql,
      trustProxy: true,
    });
    for (const seed of [20, 21, 22, 23]) {
      await seedWallet(sql, seed);
      const token = `${seed}`.padEnd(43, "a");
      await sql`
        insert into wallet_sessions (token_hash, wallet_id, expires_at)
        values (
          ${createHash("sha256").update(token, "utf8").digest()},
          ${identity(seed).walletId}, ${new Date(Date.now() + 3_600_000)}
        )
      `;
    }
    for (const seed of [20, 21, 22]) {
      const token = `${seed}`.padEnd(43, "a");
      const response = await routes.request("/claims", {
        body: "{}",
        headers: {
          authorization: `Bearer ${token}`,
          "x-forwarded-for": "203.0.113.20",
          "content-type": "application/json",
        },
        method: "POST",
      });
      expect(response.status).toBe(201);
    }
    const token = "23".padEnd(43, "a");

    const response = await routes.request("/claims", {
      body: "{}",
      headers: {
        authorization: `Bearer ${token}`,
        "x-forwarded-for": "203.0.113.20",
        "content-type": "application/json",
      },
      method: "POST",
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FAUCET_RATE_LIMITED" },
    });
  });

  it("writes the ledger before broadcasting and returns the recorded transfer", async () => {
    await seedWallet(sql, 1);
    const chain = transport();

    const claim = await claimFaucet(
      sql,
      identity(1),
      "203.0.113.1",
      config(chain),
    );

    expect(claim).toMatchObject({
      amountWei: "20000000000000000",
      recipient: account(1),
      status: "BROADCAST",
      transactionHash: `0x${"1".padStart(64, "0")}`,
    });
    expect(chain.sends).toEqual([
      { to: account(1), value: 20_000_000_000_000_000n },
    ]);
    expect(Object.keys(claim).sort()).toEqual([
      "amountWei",
      "claimId",
      "recipient",
      "status",
      "transactionHash",
    ]);
  });

  it("refuses a second claim from the same wallet in the rolling window", async () => {
    await seedWallet(sql, 2);
    const chain = transport();
    const faucet = config(chain);
    await claimFaucet(sql, identity(2), "203.0.113.2", faucet);

    await expectReason(
      () => claimFaucet(sql, identity(2), "203.0.113.2", faucet),
      "FAUCET_ALREADY_CLAIMED",
    );
    expect(chain.sends).toHaveLength(1);
  });

  it("refuses an already funded smart account", async () => {
    await seedWallet(sql, 3);
    const chain = transport({
      balances: new Map([[account(3), 50_000_000_000_000_000n]]),
    });

    await expectReason(
      () => claimFaucet(sql, identity(3), "203.0.113.3", config(chain)),
      "FAUCET_ACCOUNT_FUNDED",
    );
  });

  it("reserves the global rolling budget in the ledger", async () => {
    await seedWallet(sql, 4);
    await seedWallet(sql, 5);
    const chain = transport();
    const faucet = config(chain, { globalBudgetWei: 20_000_000_000_000_000n });
    await claimFaucet(sql, identity(4), "203.0.113.4", faucet);

    await expectReason(
      () => claimFaucet(sql, identity(5), "203.0.113.5", faucet),
      "FAUCET_BUDGET_EXHAUSTED",
    );
  });

  it("limits a client IP after three wallet claims", async () => {
    const chain = transport();
    const faucet = config(chain);
    for (const seed of [6, 7, 8]) {
      await seedWallet(sql, seed);
      await claimFaucet(sql, identity(seed), "203.0.113.6", faucet);
    }
    await seedWallet(sql, 9);

    await expectReason(
      () => claimFaucet(sql, identity(9), "203.0.113.6", faucet),
      "FAUCET_RATE_LIMITED",
    );
  });

  it("serializes concurrent wallet claims with one durable claim and one transfer", async () => {
    await seedWallet(sql, 10);
    const chain = transport();
    const faucet = config(chain);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        claimFaucet(sql, identity(10), "203.0.113.10", faucet),
      ),
    );

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(chain.sends).toHaveLength(1);
    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count from faucet_claims where wallet_id = ${identity(10).walletId}
    `;
    expect(rows[0]?.count).toBe("1");
  });

  it("keeps an unknown post-ledger transfer pending and blocks another payment", async () => {
    await seedWallet(sql, 11);
    const chain = transport({
      onSend: () => Promise.reject(new Error("connection lost")),
    });
    const faucet = config(chain);

    await expectReason(
      () => claimFaucet(sql, identity(11), "203.0.113.11", faucet),
      "FAUCET_UNAVAILABLE",
    );
    const status = await getFaucetStatus(
      sql,
      identity(11),
      "203.0.113.11",
      faucet,
    );
    expect(status.lastClaim).toMatchObject({
      status: "PENDING",
      transactionHash: null,
    });
    await expectReason(
      () => claimFaucet(sql, identity(11), "203.0.113.11", faucet),
      "FAUCET_ALREADY_CLAIMED",
    );
  });

  it("rejects every non-testnet chain before serving the faucet", async () => {
    await expect(assertFaucetChain(async () => 31337)).rejects.toThrow(
      "chain 97",
    );
    await expect(assertFaucetChain(async () => 97)).resolves.toBeUndefined();
  });
});
