import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  deriveSemiModularAccountAddress,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  type WalletChallengeRequest,
  walletChallengeRequestSchema,
  walletChallengeVerificationSchema,
} from "@perago/sdk";
import type { Sql, TransactionSql } from "postgres";
import { recoverMessageAddress } from "viem";

const SUPPORTED_CHAIN_ID = "97";
const ACCOUNT_TYPE = "ALCHEMY_MODULAR_V2";
const ACCOUNT_VERSION = "2.0.0";

export type WalletAuthConfig = {
  challengeTtlMs: number;
  domain: string;
  now: () => Date;
  sessionTtlMs: number;
  uri: string;
};

export type WalletIdentity = {
  account: `0x${string}`;
  chainId: string;
  expiresAt: string;
  ownerEpoch: string;
  rootOwner: `0x${string}`;
  walletId: string;
};

type ChallengeRow = {
  account_address: Buffer;
  chain_id: string;
  consumed_at: Date | null;
  domain: string;
  expires_at: Date;
  message: string;
  root_owner_address: Buffer;
  uri: string;
};

type WalletRow = {
  account_address: Buffer;
  account_type: string;
  account_version: string;
  chain_id: string;
  entry_point_address: Buffer;
  factory_address: Buffer | null;
  id: string;
  owner_epoch: string;
  root_owner_address: Buffer;
};

function asBuffer(value: `0x${string}`): Buffer {
  return Buffer.from(value.slice(2), "hex");
}

function asAddress(value: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(value).toString("hex")}`;
}

function equalBytes(left: Uint8Array | null, right: Uint8Array): boolean {
  return left !== null && Buffer.from(left).equals(Buffer.from(right));
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function validateConfig(config: WalletAuthConfig): void {
  if (config.challengeTtlMs <= 0 || config.sessionTtlMs <= 0) {
    throw new RangeError("wallet authentication TTLs must be positive");
  }
  const uri = new URL(config.uri);
  if (uri.host !== config.domain) {
    throw new RangeError("wallet authentication URI must match its domain");
  }
}

function challengeMessage(input: {
  account: `0x${string}`;
  chainId: string;
  domain: string;
  expiresAt: Date;
  issuedAt: Date;
  nonce: string;
  rootOwner: `0x${string}`;
  uri: string;
}): string {
  return [
    `${input.domain} wants you to authenticate with Perago.`,
    "",
    `Root owner: ${input.rootOwner}`,
    `Smart account: ${input.account}`,
    `Chain ID: ${input.chainId}`,
    `URI: ${input.uri}`,
    `Nonce: ${input.nonce}`,
    `Issued at: ${input.issuedAt.toISOString()}`,
    `Expiration: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}

function assertSupportedAccount(request: WalletChallengeRequest): void {
  if (request.chainId !== SUPPORTED_CHAIN_ID) {
    throw new RangeError(`unsupported chain ${request.chainId}`);
  }
  const expected = deriveSemiModularAccountAddress({
    owner: request.rootOwner,
  });
  if (expected.toLowerCase() !== request.account) {
    throw new RangeError("smart account does not match the root owner");
  }
}

async function findOrCreateWallet(
  tx: TransactionSql,
  challenge: ChallengeRow,
  now: Date,
): Promise<WalletRow> {
  const walletId = randomUUID();
  const entryPoint = asBuffer(MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint);
  const factory = asBuffer(MODULAR_ACCOUNT_V2_ADDRESSES.factory);
  await tx`
    insert into wallets (
      id, chain_id, account_address, root_owner_address, account_type,
      account_version, entry_point_address, factory_address, owner_epoch,
      created_at, updated_at
    ) values (
      ${walletId}, ${challenge.chain_id}, ${challenge.account_address},
      ${challenge.root_owner_address}, ${ACCOUNT_TYPE}, ${ACCOUNT_VERSION},
      ${entryPoint}, ${factory}, 0, ${now}, ${now}
    )
    on conflict (chain_id, account_address) do nothing
  `;

  const [wallet] = await tx<WalletRow[]>`
    select id, chain_id::text, account_address, root_owner_address,
      account_type, account_version, entry_point_address, factory_address,
      owner_epoch::text
    from wallets
    where chain_id = ${challenge.chain_id}
      and account_address = ${challenge.account_address}
    for update
  `;
  if (!wallet) throw new Error("wallet persistence failed");
  if (
    !equalBytes(wallet.root_owner_address, challenge.root_owner_address) ||
    wallet.account_type !== ACCOUNT_TYPE ||
    wallet.account_version !== ACCOUNT_VERSION ||
    !equalBytes(wallet.entry_point_address, entryPoint) ||
    !equalBytes(wallet.factory_address, factory)
  ) {
    throw new Error("stored smart account identity is stale");
  }
  return wallet;
}

export async function createWalletChallenge(
  sql: Sql,
  requestInput: unknown,
  config: WalletAuthConfig,
) {
  validateConfig(config);
  const request = walletChallengeRequestSchema.parse(requestInput);
  assertSupportedAccount(request);

  const issuedAt = config.now();
  const expiresAt = new Date(issuedAt.getTime() + config.challengeTtlMs);
  const challengeId = randomUUID();
  const nonce = randomBytes(24).toString("base64url");
  const message = challengeMessage({
    ...request,
    domain: config.domain,
    expiresAt,
    issuedAt,
    nonce,
    uri: config.uri,
  });

  await sql`
    insert into wallet_auth_challenges (
      id, domain, uri, chain_id, account_address, root_owner_address,
      nonce, message, expires_at, created_at
    ) values (
      ${challengeId}, ${config.domain}, ${config.uri}, ${request.chainId},
      ${asBuffer(request.account)}, ${asBuffer(request.rootOwner)}, ${nonce},
      ${message}, ${expiresAt}, ${issuedAt}
    )
  `;

  return {
    challengeId,
    expiresAt: expiresAt.toISOString(),
    message,
  };
}

export async function verifyWalletChallenge(
  sql: Sql,
  verificationInput: unknown,
  config: WalletAuthConfig,
) {
  validateConfig(config);
  const verification =
    walletChallengeVerificationSchema.parse(verificationInput);
  const now = config.now();

  return sql.begin(async (tx) => {
    const [challenge] = await tx<ChallengeRow[]>`
      select domain, uri, chain_id::text, account_address, root_owner_address,
        message, expires_at, consumed_at
      from wallet_auth_challenges
      where id = ${verification.challengeId}
      for update
    `;
    if (!challenge) throw new Error("wallet challenge was not found");
    if (challenge.consumed_at !== null) {
      throw new Error("challenge has already been consumed");
    }
    if (challenge.expires_at.getTime() <= now.getTime()) {
      throw new Error("challenge has expired");
    }
    if (challenge.domain !== config.domain || challenge.uri !== config.uri) {
      throw new Error("challenge domain configuration has changed");
    }

    let recovered: `0x${string}`;
    try {
      recovered = await recoverMessageAddress({
        message: challenge.message,
        signature: verification.signature,
      });
    } catch {
      throw new Error("wallet challenge signature is invalid");
    }
    if (
      recovered.toLowerCase() !==
      asAddress(challenge.root_owner_address).toLowerCase()
    ) {
      throw new Error("wallet challenge signer does not match the root owner");
    }

    const consumed = await tx`
      update wallet_auth_challenges
      set consumed_at = ${now}
      where id = ${verification.challengeId} and consumed_at is null
      returning id
    `;
    if (consumed.count !== 1) {
      throw new Error("challenge has already been consumed");
    }

    const wallet = await findOrCreateWallet(tx, challenge, now);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + config.sessionTtlMs);
    await tx`
      insert into wallet_sessions (
        token_hash, wallet_id, expires_at, created_at
      ) values (${hashToken(token)}, ${wallet.id}, ${expiresAt}, ${now})
    `;

    return {
      account: asAddress(wallet.account_address),
      chainId: wallet.chain_id,
      expiresAt: expiresAt.toISOString(),
      rootOwner: asAddress(wallet.root_owner_address),
      token,
      walletId: wallet.id,
    };
  });
}

type AuthenticatedWalletRow = WalletRow & { expires_at: Date };

export async function authenticateWalletSession(
  sql: Sql,
  token: string,
  now = new Date(),
): Promise<WalletIdentity> {
  const [wallet] = await sql<AuthenticatedWalletRow[]>`
    select w.id, w.chain_id::text, w.account_address, w.root_owner_address,
      w.account_type, w.account_version, w.entry_point_address,
      w.factory_address, w.owner_epoch::text, s.expires_at
    from wallet_sessions s
    join wallets w on w.id = s.wallet_id
    where s.token_hash = ${hashToken(token)}
      and s.revoked_at is null
      and s.expires_at > ${now}
  `;
  if (!wallet) throw new Error("wallet session is invalid");

  return {
    account: asAddress(wallet.account_address),
    chainId: wallet.chain_id,
    expiresAt: wallet.expires_at.toISOString(),
    ownerEpoch: wallet.owner_epoch,
    rootOwner: asAddress(wallet.root_owner_address),
    walletId: wallet.id,
  };
}
