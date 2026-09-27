import { createHmac, randomUUID } from "node:crypto";
import type {
  Address,
  FaucetClaim,
  FaucetClaimResponse,
  FaucetClaimStatus,
  FaucetRefusal,
  FaucetStatus,
  Hash,
} from "@perago/sdk";
import type { Sql, TransactionSql } from "postgres";
import {
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  TransactionReceiptNotFoundError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import type { WalletIdentity } from "../auth/wallet-auth.js";
import { ReasonError } from "../errors.js";

type ClaimStatus = FaucetClaimStatus;

type ClaimRow = {
  amount_wei: string;
  broadcast_at: Date | null;
  client_ip_hash: Buffer;
  confirmed_at: Date | null;
  created_at: Date;
  id: string;
  recipient_address: Buffer;
  status: ClaimStatus;
  transaction_hash: Buffer | null;
  wallet_id: string;
};

export type FaucetTransport = {
  balanceOf(address: Address): Promise<bigint>;
  receiptStatus(hash: Hash): Promise<"CONFIRMED" | "FAILED" | null>;
  send(input: { to: Address; value: bigint }): Promise<Hash>;
};

export type FaucetServiceConfig = {
  amountWei: bigint;
  claimWindowMs: number;
  faucetAddress: Address;
  fundedThresholdWei: bigint;
  globalBudgetWei: bigint;
  ipClaimLimit: number;
  ipSalt: string;
  now: () => Date;
  transport: FaucetTransport;
};

export type FaucetRuntimeConfig = {
  amountWei: bigint;
  claimWindowMs: number;
  faucetAddress: Address;
  fundedThresholdWei: bigint;
  globalBudgetWei: bigint;
  ipClaimLimit: number;
  ipSalt: string;
  key: Hex;
  rpcUrl: string;
  trustProxy: boolean;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveBigint(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: bigint,
): bigint {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/u.test(raw))
    throw new Error(`${name} must be a positive integer`);
  const value = BigInt(raw);
  if (value <= 0n) throw new Error(`${name} must be a positive integer`);
  return value;
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/** Validates only local environment shape; `assertFaucetChain` verifies the RPC. */
export function loadFaucetConfig(
  env: NodeJS.ProcessEnv = process.env,
): FaucetRuntimeConfig {
  const key = required(env, "PERAGO_FAUCET_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/u.test(key)) {
    throw new Error("PERAGO_FAUCET_KEY must be a 0x-prefixed 32-byte hex key");
  }
  const ipSalt = required(env, "PERAGO_FAUCET_IP_SALT");
  if (ipSalt.length < 32) {
    throw new Error("PERAGO_FAUCET_IP_SALT must be at least 32 characters");
  }
  const amountWei = positiveBigint(
    env,
    "PERAGO_FAUCET_CLAIM_WEI",
    20_000_000_000_000_000n,
  );
  const fundedThresholdWei = positiveBigint(
    env,
    "PERAGO_FAUCET_FUNDED_THRESHOLD_WEI",
    50_000_000_000_000_000n,
  );
  if (fundedThresholdWei < amountWei) {
    throw new Error(
      "PERAGO_FAUCET_FUNDED_THRESHOLD_WEI must be at least the claim amount",
    );
  }
  const account = privateKeyToAccount(key as Hex);
  return {
    amountWei,
    claimWindowMs:
      positiveInteger(env, "PERAGO_FAUCET_CLAIM_WINDOW_SECONDS", 86_400) *
      1_000,
    faucetAddress: account.address.toLowerCase() as Address,
    fundedThresholdWei,
    globalBudgetWei: positiveBigint(
      env,
      "PERAGO_FAUCET_GLOBAL_BUDGET_WEI",
      1_000_000_000_000_000_000n,
    ),
    ipClaimLimit: positiveInteger(env, "PERAGO_FAUCET_IP_CLAIM_LIMIT", 3),
    ipSalt,
    key: key.toLowerCase() as Hex,
    rpcUrl: required(env, "PERAGO_BSC_TESTNET_RPC"),
    trustProxy: env.PERAGO_TRUST_PROXY === "true",
  };
}

/** The startup gate: a faucet process may only use BSC Testnet. */
export async function assertFaucetChain(
  getChainId: () => Promise<number>,
): Promise<void> {
  if ((await getChainId()) !== 97) {
    throw new Error("faucet RPC must report chain 97");
  }
}

export function createViemFaucetTransport(input: {
  key: Hex;
  rpcUrl: string;
}): FaucetTransport {
  const account = privateKeyToAccount(input.key);
  const publicClient = createPublicClient({
    chain: bscTestnet,
    transport: http(input.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: bscTestnet,
    transport: http(input.rpcUrl),
  });
  return {
    balanceOf: (address) => publicClient.getBalance({ address }),
    async receiptStatus(hash) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        return receipt.status === "success" ? "CONFIRMED" : "FAILED";
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return null;
        throw error;
      }
    },
    send: ({ to, value }) => walletClient.sendTransaction({ to, value }),
  };
}

export function faucetServiceConfig(
  runtime: FaucetRuntimeConfig,
  transport: FaucetTransport,
  now: () => Date = () => new Date(),
): FaucetServiceConfig {
  return { ...runtime, now, transport };
}

function addressBuffer(address: Address): Buffer {
  return Buffer.from(address.slice(2), "hex");
}

function asAddress(bytes: Uint8Array): Address {
  return `0x${Buffer.from(bytes).toString("hex")}` as Address;
}

function asHash(bytes: Uint8Array): Hash {
  return `0x${Buffer.from(bytes).toString("hex")}` as Hash;
}

function ipHash(ip: string, salt: string): Buffer {
  return createHmac("sha256", salt).update(ip, "utf8").digest();
}

function windowStart(now: Date, config: FaucetServiceConfig): Date {
  return new Date(now.getTime() - config.claimWindowMs);
}

function claimView(row: ClaimRow): FaucetClaim {
  return {
    amountWei: row.amount_wei,
    claimId: row.id,
    createdAt: row.created_at.toISOString(),
    status: row.status,
    transactionHash: row.transaction_hash ? asHash(row.transaction_hash) : null,
  };
}

async function latestClaim(
  sql: Sql | TransactionSql,
  walletId: string,
): Promise<ClaimRow | null> {
  const [row] = await sql<ClaimRow[]>`
    select id, wallet_id, recipient_address, client_ip_hash, amount_wei::text,
      status, transaction_hash, created_at, broadcast_at, confirmed_at
    from faucet_claims where wallet_id = ${walletId}
    order by created_at desc limit 1
  `;
  return row ?? null;
}

async function refreshBroadcast(
  sql: Sql,
  row: ClaimRow | null,
  config: FaucetServiceConfig,
): Promise<ClaimRow | null> {
  if (row?.status !== "BROADCAST" || !row.transaction_hash) return row;
  let status: "CONFIRMED" | "FAILED" | null;
  try {
    status = await config.transport.receiptStatus(asHash(row.transaction_hash));
  } catch {
    return row;
  }
  if (!status) return row;
  const [refreshed] = await sql<ClaimRow[]>`
    update faucet_claims set status = ${status}, confirmed_at = ${config.now()}
    where id = ${row.id} and status = 'BROADCAST'
    returning id, wallet_id, recipient_address, client_ip_hash, amount_wei::text,
      status, transaction_hash, created_at, broadcast_at, confirmed_at
  `;
  return refreshed ?? row;
}

async function activeBudget(
  sql: Sql | TransactionSql,
  start: Date,
): Promise<bigint> {
  const [row] = await sql<{ amount: string }[]>`
    select coalesce(sum(amount_wei), 0)::text as amount from faucet_claims
    where created_at > ${start} and status in ('PENDING', 'BROADCAST', 'CONFIRMED')
  `;
  return BigInt(row?.amount ?? "0");
}

async function activeIpCount(
  sql: Sql | TransactionSql,
  hash: Buffer,
  start: Date,
): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    select count(*)::text as count from faucet_claims
    where client_ip_hash = ${hash} and created_at > ${start}
      and status in ('PENDING', 'BROADCAST', 'CONFIRMED')
  `;
  return Number(row?.count ?? "0");
}

async function activeWalletClaim(
  sql: Sql | TransactionSql,
  walletId: string,
  start: Date,
): Promise<ClaimRow | null> {
  const [row] = await sql<ClaimRow[]>`
    select id, wallet_id, recipient_address, client_ip_hash, amount_wei::text,
      status, transaction_hash, created_at, broadcast_at, confirmed_at
    from faucet_claims
    where wallet_id = ${walletId} and created_at > ${start}
      and status in ('PENDING', 'BROADCAST', 'CONFIRMED')
    order by created_at desc limit 1
  `;
  return row ?? null;
}

function remainingBudget(used: bigint, config: FaucetServiceConfig): bigint {
  return used >= config.globalBudgetWei ? 0n : config.globalBudgetWei - used;
}

async function accountBalance(
  recipient: Address,
  config: FaucetServiceConfig,
): Promise<bigint> {
  try {
    return await config.transport.balanceOf(recipient);
  } catch {
    throw new ReasonError("FAUCET_UNAVAILABLE");
  }
}

async function faucetHasFunds(config: FaucetServiceConfig): Promise<void> {
  const balance = await accountBalance(config.faucetAddress, config);
  if (balance < config.amountWei) throw new ReasonError("FAUCET_UNAVAILABLE");
}

function assertConfig(config: FaucetServiceConfig): void {
  if (
    config.amountWei <= 0n ||
    config.fundedThresholdWei < config.amountWei ||
    config.globalBudgetWei < config.amountWei ||
    config.claimWindowMs <= 0 ||
    config.ipClaimLimit <= 0 ||
    config.ipSalt.length < 32
  ) {
    throw new RangeError("invalid faucet configuration");
  }
}

export async function getFaucetStatus(
  sql: Sql,
  identity: WalletIdentity,
  clientIp: string,
  config: FaucetServiceConfig,
): Promise<FaucetStatus> {
  assertConfig(config);
  const now = config.now();
  const start = windowStart(now, config);
  const hash = ipHash(clientIp, config.ipSalt);
  const lastClaim = await refreshBroadcast(
    sql,
    await latestClaim(sql, identity.walletId),
    config,
  );
  const balance = await accountBalance(identity.account as Address, config);
  const currentClaim = await activeWalletClaim(sql, identity.walletId, start);
  const used = await activeBudget(sql, start);
  const ipClaims = await activeIpCount(sql, hash, start);
  const reasonCode: FaucetRefusal | null = currentClaim
    ? "FAUCET_ALREADY_CLAIMED"
    : balance >= config.fundedThresholdWei
      ? "FAUCET_ACCOUNT_FUNDED"
      : remainingBudget(used, config) < config.amountWei
        ? "FAUCET_BUDGET_EXHAUSTED"
        : ipClaims >= config.ipClaimLimit
          ? "FAUCET_RATE_LIMITED"
          : null;
  return {
    accountBalanceWei: balance.toString(),
    amountWei: config.amountWei.toString(),
    budgetRemainingWei: remainingBudget(used, config).toString(),
    chainId: "97",
    eligible: reasonCode === null,
    enabled: true,
    fundedThresholdWei: config.fundedThresholdWei.toString(),
    lastClaim: lastClaim ? claimView(lastClaim) : null,
    nextClaimAt: currentClaim
      ? new Date(
          currentClaim.created_at.getTime() + config.claimWindowMs,
        ).toISOString()
      : null,
    reasonCode,
    recipient: identity.account as Address,
  };
}

/**
 * Commits PENDING before broadcasting. A PENDING row has no transaction hash,
 * so a crash after broadcast cannot be disproven; it remains budgeted and blocks
 * another transfer instead of attempting unsafe automatic recovery.
 */
export async function claimFaucet(
  sql: Sql,
  identity: WalletIdentity,
  clientIp: string,
  config: FaucetServiceConfig,
): Promise<FaucetClaimResponse> {
  assertConfig(config);
  const now = config.now();
  const start = windowStart(now, config);
  const recipient = identity.account as Address;
  const hash = ipHash(clientIp, config.ipSalt);
  const pending = await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended('perago:faucet:global', 0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${identity.walletId}, 0))`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${hash.toString("hex")}, 0))`;
    if (await activeWalletClaim(tx, identity.walletId, start)) {
      throw new ReasonError("FAUCET_ALREADY_CLAIMED");
    }
    if (
      (await accountBalance(recipient, config)) >= config.fundedThresholdWei
    ) {
      throw new ReasonError("FAUCET_ACCOUNT_FUNDED");
    }
    if (
      (await activeBudget(tx, start)) + config.amountWei >
      config.globalBudgetWei
    ) {
      throw new ReasonError("FAUCET_BUDGET_EXHAUSTED");
    }
    if ((await activeIpCount(tx, hash, start)) >= config.ipClaimLimit) {
      throw new ReasonError("FAUCET_RATE_LIMITED");
    }
    await faucetHasFunds(config);
    const [row] = await tx<ClaimRow[]>`
      insert into faucet_claims (
        id, wallet_id, recipient_address, client_ip_hash, amount_wei, status, created_at
      ) values (
        ${randomUUID()}, ${identity.walletId}, ${addressBuffer(recipient)}, ${hash},
        ${config.amountWei.toString()}, 'PENDING', ${now}
      )
      returning id, wallet_id, recipient_address, client_ip_hash, amount_wei::text,
        status, transaction_hash, created_at, broadcast_at, confirmed_at
    `;
    if (!row) throw new Error("faucet claim insert returned no row");
    return row;
  });

  let transactionHash: Hash;
  try {
    transactionHash = await config.transport.send({
      to: recipient,
      value: config.amountWei,
    });
  } catch {
    throw new ReasonError("FAUCET_UNAVAILABLE");
  }
  const [broadcast] = await sql<ClaimRow[]>`
    update faucet_claims set
      status = 'BROADCAST', transaction_hash = ${Buffer.from(transactionHash.slice(2), "hex")},
      broadcast_at = ${config.now()}
    where id = ${pending.id} and status = 'PENDING'
    returning id, wallet_id, recipient_address, client_ip_hash, amount_wei::text,
      status, transaction_hash, created_at, broadcast_at, confirmed_at
  `;
  if (!broadcast?.transaction_hash) {
    throw new Error("faucet claim could not record broadcast transaction");
  }
  return {
    amountWei: broadcast.amount_wei,
    claimId: broadcast.id,
    recipient: asAddress(broadcast.recipient_address),
    status: broadcast.status,
    transactionHash: asHash(broadcast.transaction_hash),
  };
}
