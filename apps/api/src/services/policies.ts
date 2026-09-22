import { randomUUID } from "node:crypto";
import {
  type AccountPolicy,
  type Address,
  confirmPolicyActivationRequestSchema,
  confirmPolicyRevocationRequestSchema,
  createWalletPolicyRequestSchema,
  encodeAccountPolicyTransition,
  encodeInstallMandateSession,
  encodeUninstallMandateSession,
  getAccountPolicyTypedData,
  type Hash,
  hashMandateSessionPermission,
  hashMandateSessionRevocation,
  hashPolicyRevocation,
  hashWalletPolicy,
  type MandateSessionPermissionDocument,
  mandateSessionPermissionSchema,
  preparePolicyRevocationRequestSchema,
  preparePolicyTransitionRequestSchema,
  type Selector,
  toMandateSessionPermission,
} from "@perago/sdk";
import type { JSONValue, Sql } from "postgres";
import { verifyTypedData } from "viem";

import type { WalletIdentity } from "../auth/wallet-auth.js";

const MAX_POSTGRES_INTEGER = 2_147_483_647n;

export type PolicyServiceConfig = {
  mandateExecutor: Address;
  now: () => Date;
  performSelector: Selector;
};

export type PolicyChainExpectation = {
  account: Address;
  activePolicyHash: Hash;
  chainId: string;
  ownerEpoch: string;
  permissionHash: Hash;
  rootOwner: Address;
  transactionHash: Hash;
  transition: "ACTIVATE" | "REVOKE";
  transitionCallData: `0x${string}`;
  userOperationHash: Hash;
};

export type PolicyChainObservation =
  | { status: "PENDING" }
  | {
      account: Address;
      activePolicyHash: Hash;
      blockNumber: bigint;
      observedAt: Date;
      ownerEpoch: string;
      permissionHash: Hash;
      rootOwner: Address;
      status: "CONFIRMED";
    };

export interface PolicyChainVerifier {
  verify(expectation: PolicyChainExpectation): Promise<PolicyChainObservation>;
}

type PolicyRow = {
  account_address: Buffer;
  chain_id: string;
  id: string;
  owner_epoch: string;
  permission_document: unknown | null;
  policy_document: unknown;
  policy_hash: Buffer;
  root_owner_address: Buffer;
  status: "DRAFT" | "ACTIVATING" | "ACTIVE" | "SUPERSEDED" | "REVOKED";
  version: number;
  wallet_id: string;
};

function asBuffer(value: `0x${string}`): Buffer {
  return Buffer.from(value.slice(2), "hex");
}

function asHex(value: Uint8Array): `0x${string}` {
  return `0x${Buffer.from(value).toString("hex")}`;
}

function assertIdentity(row: PolicyRow, identity: WalletIdentity): void {
  if (row.wallet_id !== identity.walletId) {
    throw new Error("wallet policy does not belong to this session");
  }
  if (row.chain_id !== identity.chainId) {
    throw new Error("wallet policy chain is stale");
  }
  if (asHex(row.account_address) !== identity.account) {
    throw new Error("wallet policy account is stale");
  }
  if (asHex(row.root_owner_address) !== identity.rootOwner) {
    throw new Error("wallet policy root owner is stale");
  }
}

async function loadPolicy(
  sql: Sql,
  policyId: string,
  identity: WalletIdentity,
): Promise<PolicyRow> {
  const [row] = await sql<PolicyRow[]>`
    select p.id, p.wallet_id, p.version, p.status, p.policy_document,
      p.policy_hash, p.permission_document, w.chain_id::text,
      w.account_address, w.root_owner_address, w.owner_epoch::text
    from wallet_policies p
    join wallets w on w.id = p.wallet_id
    where p.id = ${policyId}
  `;
  if (!row) throw new Error("wallet policy was not found");
  assertIdentity(row, identity);
  return row;
}

function assertActivationPermission(
  permissionInput: unknown,
  identity: WalletIdentity,
  validUntil: string,
  config: PolicyServiceConfig,
): MandateSessionPermissionDocument {
  const permission = mandateSessionPermissionSchema.parse(permissionInput);
  if (permission.account !== identity.account) {
    throw new Error("session permission account is stale");
  }
  if (permission.target !== config.mandateExecutor.toLowerCase()) {
    throw new Error("session permission target is not the MandateExecutor");
  }
  if (
    permission.selectors.length !== 1 ||
    permission.selectors[0] !== config.performSelector.toLowerCase()
  ) {
    throw new Error("session permission is broader than the perform selector");
  }
  if (permission.nativeSpendLimit !== "0") {
    throw new Error(
      "MandateExecutor session permission cannot spend native value",
    );
  }
  if (permission.sessionSigner === identity.rootOwner) {
    throw new Error("root owner cannot be installed as an executor session");
  }
  if (permission.validUntil !== validUntil) {
    throw new Error("session and account policy expiry must match");
  }
  if (BigInt(validUntil) <= BigInt(Math.floor(config.now().getTime() / 1000))) {
    throw new Error("policy transition has expired");
  }
  return permission;
}

function expectedOwnerEpoch(row: PolicyRow): string {
  return row.owner_epoch === "0" ? "1" : row.owner_epoch;
}

export async function createWalletPolicy(
  sql: Sql,
  identity: WalletIdentity,
  requestInput: unknown,
) {
  const { policy } = createWalletPolicyRequestSchema.parse(requestInput);
  if (policy.account !== identity.account) {
    throw new Error("policy account does not match the authenticated wallet");
  }
  if (policy.chainId !== identity.chainId) {
    throw new Error("policy chain does not match the authenticated wallet");
  }
  const version = BigInt(policy.version);
  if (version > MAX_POSTGRES_INTEGER) {
    throw new RangeError("policy version exceeds the persistence limit");
  }
  const policyHash = hashWalletPolicy(policy);
  const policyId = randomUUID();

  await sql.begin(async (tx) => {
    const [wallet] = await tx<
      {
        account_address: Buffer;
        chain_id: string;
        root_owner_address: Buffer;
      }[]
    >`
      select chain_id::text, account_address, root_owner_address
      from wallets where id = ${identity.walletId} for update
    `;
    if (!wallet) throw new Error("authenticated wallet was not found");
    if (
      wallet.chain_id !== identity.chainId ||
      asHex(wallet.account_address) !== identity.account ||
      asHex(wallet.root_owner_address) !== identity.rootOwner
    ) {
      throw new Error("authenticated wallet identity is stale");
    }

    const [latest] = await tx<{ version: number | null }[]>`
      select max(version)::integer as version
      from wallet_policies where wallet_id = ${identity.walletId}
    `;
    const expectedVersion = BigInt((latest?.version ?? 0) + 1);
    if (version !== expectedVersion) {
      throw new Error(`policy version must be ${expectedVersion}`);
    }

    await tx`
      insert into wallet_policies (
        id, wallet_id, version, schema_version, status, policy_document,
        policy_hash
      ) values (
        ${policyId}, ${identity.walletId}, ${Number(version)},
        ${policy.schemaVersion}, 'DRAFT',
        ${tx.json(policy as unknown as JSONValue)}, ${asBuffer(policyHash)}
      )
    `;
  });

  return { policyId, policyHash, status: "DRAFT" as const };
}

export async function preparePolicyActivation(
  sql: Sql,
  identity: WalletIdentity,
  policyId: string,
  requestInput: unknown,
  config: PolicyServiceConfig,
) {
  const request = preparePolicyTransitionRequestSchema.parse(requestInput);
  const row = await loadPolicy(sql, policyId, identity);
  if (row.status !== "DRAFT") {
    throw new Error("only a draft policy can be activated");
  }
  const ownerEpoch = expectedOwnerEpoch(row);
  if (request.ownerEpoch !== ownerEpoch) {
    throw new Error(`policy owner epoch must be ${ownerEpoch}`);
  }
  const permission = assertActivationPermission(
    request.permission,
    identity,
    request.validUntil,
    config,
  );
  const policyHash = asHex(row.policy_hash);
  const permissionHash = hashMandateSessionPermission(permission);
  const accountPolicy = {
    account: identity.account,
    chainId: identity.chainId,
    ownerEpoch,
    permissionHash,
    policyHash,
    rootOwner: identity.rootOwner,
    validUntil: request.validUntil,
  } satisfies AccountPolicy;

  return {
    accountPolicy,
    permissionCallData: encodeInstallMandateSession(
      toMandateSessionPermission(permission),
    ),
    permissionHash,
    policyHash,
    typedData: getAccountPolicyTypedData(accountPolicy, {
      chainId: identity.chainId,
      verifyingContract: config.mandateExecutor,
    }),
  };
}

function assertConfirmedObservation(
  observation: Extract<PolicyChainObservation, { status: "CONFIRMED" }>,
  expectation: PolicyChainExpectation,
): void {
  if (observation.account !== expectation.account) {
    throw new Error("confirmed smart account is stale");
  }
  if (observation.rootOwner !== expectation.rootOwner) {
    throw new Error("confirmed root owner is stale");
  }
  if (observation.ownerEpoch !== expectation.ownerEpoch) {
    throw new Error("confirmed owner epoch is stale");
  }
  if (observation.activePolicyHash !== expectation.activePolicyHash) {
    throw new Error("confirmed policy hash is stale");
  }
  if (observation.permissionHash !== expectation.permissionHash) {
    throw new Error("confirmed permission hash is stale");
  }
}

export async function confirmPolicyActivation(
  sql: Sql,
  identity: WalletIdentity,
  policyId: string,
  requestInput: unknown,
  config: PolicyServiceConfig,
  verifier: PolicyChainVerifier,
) {
  const request = confirmPolicyActivationRequestSchema.parse(requestInput);
  const prepared = await preparePolicyActivation(
    sql,
    identity,
    policyId,
    {
      ownerEpoch: request.ownerEpoch,
      permission: request.permission,
      validUntil: request.validUntil,
    },
    config,
  );
  const validSignature = await verifyTypedData({
    ...prepared.typedData,
    address: identity.rootOwner,
    signature: request.rootSignature,
  });
  if (!validSignature) throw new Error("account policy signature is invalid");

  const transitionCallData = encodeAccountPolicyTransition({
    account: identity.account,
    mandateExecutor: config.mandateExecutor,
    permissionCallData: prepared.permissionCallData,
    policy: prepared.accountPolicy,
    rootSignature: request.rootSignature,
  });
  const expectation: PolicyChainExpectation = {
    account: identity.account,
    activePolicyHash: prepared.policyHash,
    chainId: identity.chainId,
    ownerEpoch: prepared.accountPolicy.ownerEpoch,
    permissionHash: prepared.permissionHash,
    rootOwner: identity.rootOwner,
    transactionHash: request.transactionHash,
    transition: "ACTIVATE",
    transitionCallData,
    userOperationHash: request.userOperationHash,
  };
  const observation = await verifier.verify(expectation);
  if (observation.status === "PENDING") return observation;
  assertConfirmedObservation(observation, expectation);

  await sql.begin(async (tx) => {
    const [locked] = await tx<PolicyRow[]>`
      select p.id, p.wallet_id, p.version, p.status, p.policy_document,
        p.policy_hash, p.permission_document, w.chain_id::text,
        w.account_address, w.root_owner_address, w.owner_epoch::text
      from wallet_policies p
      join wallets w on w.id = p.wallet_id
      where p.id = ${policyId}
      for update of p, w
    `;
    if (!locked) throw new Error("wallet policy was not found");
    assertIdentity(locked, identity);
    if (locked.status !== "DRAFT") {
      throw new Error("policy activation state changed while confirming");
    }
    if (expectedOwnerEpoch(locked) !== observation.ownerEpoch) {
      throw new Error("wallet owner epoch changed while confirming");
    }

    await tx`
      update wallets set owner_epoch = ${observation.ownerEpoch},
        updated_at = ${observation.observedAt}
      where id = ${identity.walletId}
    `;
    await tx`
      update wallet_policies set
        status = 'ACTIVATING',
        permission_document = ${tx.json(request.permission as unknown as JSONValue)},
        permission_hash = ${asBuffer(prepared.permissionHash)},
        permission_call_data = ${asBuffer(prepared.permissionCallData)},
        permission_user_operation_hash = ${asBuffer(request.userOperationHash)},
        permission_tx_hash = ${asBuffer(request.transactionHash)},
        activation_call_data = ${asBuffer(transitionCallData)},
        activation_user_operation_hash = ${asBuffer(request.userOperationHash)},
        activation_tx_hash = ${asBuffer(request.transactionHash)},
        activation_block_number = ${observation.blockNumber.toString()},
        activated_at = ${observation.observedAt}
      where id = ${policyId}
    `;
    await tx`
      update wallet_policies set status = 'SUPERSEDED',
        terminal_at = ${observation.observedAt}
      where wallet_id = ${identity.walletId} and status = 'ACTIVE'
    `;
    await tx`
      update wallet_policies set status = 'ACTIVE'
      where id = ${policyId} and status = 'ACTIVATING'
    `;
  });

  return { status: "ACTIVE" as const };
}

export async function preparePolicyRevocation(
  sql: Sql,
  identity: WalletIdentity,
  policyId: string,
  requestInput: unknown,
  config: PolicyServiceConfig,
) {
  const request = preparePolicyRevocationRequestSchema.parse(requestInput);
  const row = await loadPolicy(sql, policyId, identity);
  if (row.status !== "ACTIVE") {
    throw new Error("only the active policy can be revoked");
  }
  const permission = mandateSessionPermissionSchema.parse(
    row.permission_document,
  );
  const revocationHash = hashPolicyRevocation(asHex(row.policy_hash));
  const permissionHash = hashMandateSessionRevocation(permission);
  const accountPolicy = {
    account: identity.account,
    chainId: identity.chainId,
    ownerEpoch: row.owner_epoch,
    permissionHash,
    policyHash: revocationHash,
    rootOwner: identity.rootOwner,
    validUntil: request.validUntil,
  } satisfies AccountPolicy;
  if (
    BigInt(request.validUntil) <=
    BigInt(Math.floor(config.now().getTime() / 1000))
  ) {
    throw new Error("policy revocation has expired");
  }

  return {
    accountPolicy,
    permissionCallData: encodeUninstallMandateSession(
      toMandateSessionPermission(permission),
    ),
    permissionHash,
    revocationHash,
    typedData: getAccountPolicyTypedData(accountPolicy, {
      chainId: identity.chainId,
      verifyingContract: config.mandateExecutor,
    }),
  };
}

export async function confirmPolicyRevocation(
  sql: Sql,
  identity: WalletIdentity,
  policyId: string,
  requestInput: unknown,
  config: PolicyServiceConfig,
  verifier: PolicyChainVerifier,
) {
  const request = confirmPolicyRevocationRequestSchema.parse(requestInput);
  const prepared = await preparePolicyRevocation(
    sql,
    identity,
    policyId,
    { validUntil: request.validUntil },
    config,
  );
  const validSignature = await verifyTypedData({
    ...prepared.typedData,
    address: identity.rootOwner,
    signature: request.rootSignature,
  });
  if (!validSignature)
    throw new Error("policy revocation signature is invalid");

  const transitionCallData = encodeAccountPolicyTransition({
    account: identity.account,
    mandateExecutor: config.mandateExecutor,
    permissionCallData: prepared.permissionCallData,
    policy: prepared.accountPolicy,
    rootSignature: request.rootSignature,
  });
  const expectation: PolicyChainExpectation = {
    account: identity.account,
    activePolicyHash: prepared.revocationHash,
    chainId: identity.chainId,
    ownerEpoch: prepared.accountPolicy.ownerEpoch,
    permissionHash: prepared.permissionHash,
    rootOwner: identity.rootOwner,
    transactionHash: request.transactionHash,
    transition: "REVOKE",
    transitionCallData,
    userOperationHash: request.userOperationHash,
  };
  const observation = await verifier.verify(expectation);
  if (observation.status === "PENDING") return observation;
  assertConfirmedObservation(observation, expectation);

  await sql.begin(async (tx) => {
    const [locked] = await tx<{ status: string }[]>`
      select status from wallet_policies
      where id = ${policyId} and wallet_id = ${identity.walletId}
      for update
    `;
    if (!locked) throw new Error("wallet policy was not found");
    if (locked.status !== "ACTIVE") {
      throw new Error("policy revocation state changed while confirming");
    }
    await tx`
      update wallet_policies set status = 'REVOKED',
        revocation_call_data = ${asBuffer(transitionCallData)},
        revocation_user_operation_hash = ${asBuffer(request.userOperationHash)},
        revocation_tx_hash = ${asBuffer(request.transactionHash)},
        revocation_block_number = ${observation.blockNumber.toString()},
        terminal_at = ${observation.observedAt}
      where id = ${policyId}
    `;
  });

  return { status: "REVOKED" as const };
}
