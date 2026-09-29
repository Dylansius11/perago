import { readFile } from "node:fs/promises";
import {
  ACCOUNT_EXECUTE_SELECTOR,
  deriveSemiModularAccountAddress,
  hashMandateSessionPermission,
  type PreparePolicyTransitionRequest,
  type WalletPolicy,
} from "@perago/sdk";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { WalletIdentity } from "../auth/wallet-auth.js";
import {
  confirmPolicyActivation,
  confirmPolicyRevocation,
  createWalletPolicy,
  type PolicyChainVerifier,
  type PolicyServiceConfig,
  preparePolicyActivation,
  preparePolicyRevocation,
} from "./policies.js";

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
  new URL("../../drizzle/0006_commerce_settlement.sql", import.meta.url),
];
const owner = privateKeyToAccount(
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
);
const account = deriveSemiModularAccountAddress({ owner: owner.address });
const mandateExecutor = "0x3333333333333333333333333333333333333333";
const sessionSigner = "0x4444444444444444444444444444444444444444";
const inputToken = "0x5555555555555555555555555555555555555555";
const protectedToken = "0x6666666666666666666666666666666666666666";
const performSelector = "0x12345678";
const now = new Date("2026-09-20T12:00:00.000Z");
const txHash =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const userOpHash =
  "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

const identity: WalletIdentity = {
  account: account.toLowerCase() as `0x${string}`,
  chainId: "97",
  expiresAt: "2026-09-20T13:00:00.000Z",
  ownerEpoch: "0",
  rootOwner: owner.address.toLowerCase() as `0x${string}`,
  walletId: "00000000-0000-4000-8000-000000000001",
};

const policy: WalletPolicy = {
  account: identity.account,
  activeAssets: [
    {
      maxInputPerTask: "1000000000000000000",
      rollingDailyCap: "3000000000000000000",
      token: inputToken,
    },
  ],
  allowedRecipients: "SELF",
  approvedAdapterIds: ["pancakeswap-v3"],
  chainId: "97",
  maxSlippageBps: "100",
  maxTaskLifetimeSeconds: "3600",
  protectedAssets: [protectedToken],
  schemaVersion: "1",
  services: ["SWAP"],
  version: "1",
};

const transition: PreparePolicyTransitionRequest = {
  ownerEpoch: "1",
  permission: {
    account: identity.account,
    entityId: 7,
    nativeSpendLimit: "0",
    selectors: [performSelector],
    sessionSigner,
    target: mandateExecutor,
    validAfter: "1789905600",
    validUntil: "1789909200",
  },
  validUntil: "1789909200",
};

const config: PolicyServiceConfig = {
  mandateExecutor,
  now: () => now,
  performSelector,
  tokens: [inputToken, protectedToken],
};

function confirmedVerifier(input: {
  activePolicyHash: `0x${string}`;
  ownerEpoch: string;
  permissionHash: `0x${string}`;
  rootOwner?: `0x${string}`;
}): PolicyChainVerifier {
  return {
    async verify(expectation) {
      expect(expectation.transitionCallData.slice(0, 10)).toBe("0x34fcd5be");
      return {
        account: identity.account,
        activePolicyHash: input.activePolicyHash,
        blockNumber: 1234n,
        observedAt: new Date("2026-09-20T12:10:00.000Z"),
        ownerEpoch: input.ownerEpoch,
        permissionHash: input.permissionHash,
        rootOwner: input.rootOwner ?? identity.rootOwner,
        status: "CONFIRMED" as const,
      };
    },
  };
}

beforeAll(async () => {
  await sql.unsafe("drop schema public cascade; create schema public");
  for (const migration of migrations) {
    await sql.unsafe(await readFile(migration, "utf8"));
  }
});

beforeEach(async () => {
  await sql.unsafe(
    "truncate wallet_auth_challenges, wallet_sessions, wallet_policies, wallets cascade",
  );
  await sql`
    insert into wallets (
      id, chain_id, account_address, root_owner_address, account_type,
      account_version, entry_point_address, factory_address, owner_epoch,
      created_at, updated_at
    ) values (
      ${identity.walletId}, 97, ${Buffer.from(identity.account.slice(2), "hex")},
      ${Buffer.from(identity.rootOwner.slice(2), "hex")}, 'ALCHEMY_MODULAR_V2',
      '2.0.0', ${Buffer.alloc(20, 1)}, ${Buffer.alloc(20, 2)}, 0, ${now}, ${now}
    )
  `;
});

afterAll(async () => {
  await sql.end();
});

describe("P3-002 wallet policy lifecycle", () => {
  it("waits for exact confirmed owner, policy, and permission state before activation and revocation", async () => {
    const draft = await createWalletPolicy(sql, identity, { policy });
    const prepared = await preparePolicyActivation(
      sql,
      identity,
      draft.policyId,
      transition,
      config,
    );
    const rootSignature = await owner.signTypedData(prepared.typedData);
    // The active asset gets its rolling daily cap; the protected asset stays at zero.
    expect(prepared.allowances).toEqual([
      { amount: 3_000_000_000_000_000_000n, token: inputToken },
      { amount: 0n, token: protectedToken },
    ]);

    const pending: PolicyChainVerifier = {
      async verify() {
        return { status: "PENDING" as const };
      },
    };
    await expect(
      confirmPolicyActivation(
        sql,
        identity,
        draft.policyId,
        {
          ...transition,
          rootSignature,
          transactionHash: txHash,
          userOperationHash: userOpHash,
        },
        config,
        pending,
      ),
    ).resolves.toEqual({ status: "PENDING" });
    const [stillDraft] = await sql<{ status: string }[]>`
      select status from wallet_policies where id = ${draft.policyId}
    `;
    expect(stillDraft?.status).toBe("DRAFT");

    const permissionHash = hashMandateSessionPermission(transition.permission);
    const activated = await confirmPolicyActivation(
      sql,
      identity,
      draft.policyId,
      {
        ...transition,
        rootSignature,
        transactionHash: txHash,
        userOperationHash: userOpHash,
      },
      config,
      confirmedVerifier({
        activePolicyHash: draft.policyHash,
        ownerEpoch: "1",
        permissionHash,
      }),
    );
    expect(activated.status).toBe("ACTIVE");

    const revocation = await preparePolicyRevocation(
      sql,
      identity,
      draft.policyId,
      { validUntil: "1789912800" },
      config,
    );
    expect(revocation.allowances).toEqual([
      { amount: 0n, token: inputToken },
      { amount: 0n, token: protectedToken },
    ]);
    const revocationSignature = await owner.signTypedData(revocation.typedData);
    const revoked = await confirmPolicyRevocation(
      sql,
      identity,
      draft.policyId,
      {
        rootSignature: revocationSignature,
        transactionHash: txHash,
        userOperationHash: userOpHash,
        validUntil: "1789912800",
      },
      config,
      confirmedVerifier({
        activePolicyHash: revocation.revocationHash,
        ownerEpoch: "1",
        permissionHash: revocation.permissionHash,
      }),
    );
    expect(revoked.status).toBe("REVOKED");
    const [revokedRow] = await sql<
      {
        revocation_block_number: string | null;
        revocation_call_data: Buffer | null;
        revocation_tx_hash: Buffer | null;
        revocation_user_operation_hash: Buffer | null;
      }[]
    >`
      select revocation_block_number::text, revocation_call_data,
        revocation_tx_hash, revocation_user_operation_hash
      from wallet_policies where id = ${draft.policyId}
    `;
    expect(revokedRow).toMatchObject({
      revocation_block_number: "1234",
      revocation_tx_hash: Buffer.from(txHash.slice(2), "hex"),
      revocation_user_operation_hash: Buffer.from(userOpHash.slice(2), "hex"),
    });
    expect(revokedRow?.revocation_call_data?.length).toBeGreaterThan(4);
  });

  it("rejects split permission and policy activation evidence in PostgreSQL", async () => {
    const draft = await createWalletPolicy(sql, identity, { policy });
    await sql`
      update wallet_policies set status = 'ACTIVATING',
        permission_document = ${sql.json(transition.permission)},
        permission_hash = ${Buffer.alloc(32, 1)},
        permission_call_data = ${Buffer.from("01", "hex")},
        permission_user_operation_hash = ${Buffer.alloc(32, 2)},
        permission_tx_hash = ${Buffer.alloc(32, 3)},
        activation_call_data = ${Buffer.from("02", "hex")},
        activation_user_operation_hash = ${Buffer.alloc(32, 4)},
        activation_tx_hash = ${Buffer.alloc(32, 5)},
        activation_block_number = 1,
        activated_at = ${now}
      where id = ${draft.policyId}
    `;

    await expect(
      sql`
        update wallet_policies set status = 'ACTIVE'
        where id = ${draft.policyId}
      `,
    ).rejects.toMatchObject({
      constraint_name: "wallet_policy_activation_atomic_evidence",
    });
  });

  it("rejects revocation when the wallet owner epoch changes after chain verification", async () => {
    const draft = await createWalletPolicy(sql, identity, { policy });
    const activation = await preparePolicyActivation(
      sql,
      identity,
      draft.policyId,
      transition,
      config,
    );
    await confirmPolicyActivation(
      sql,
      identity,
      draft.policyId,
      {
        ...transition,
        rootSignature: await owner.signTypedData(activation.typedData),
        transactionHash: txHash,
        userOperationHash: userOpHash,
      },
      config,
      confirmedVerifier({
        activePolicyHash: draft.policyHash,
        ownerEpoch: "1",
        permissionHash: hashMandateSessionPermission(transition.permission),
      }),
    );

    const revocation = await preparePolicyRevocation(
      sql,
      identity,
      draft.policyId,
      { validUntil: "1789912800" },
      config,
    );
    const confirmed = confirmedVerifier({
      activePolicyHash: revocation.revocationHash,
      ownerEpoch: "1",
      permissionHash: revocation.permissionHash,
    });
    const ownerChangedDuringVerification: PolicyChainVerifier = {
      async verify(expectation) {
        await sql`
          update wallets set owner_epoch = 2
          where id = ${identity.walletId}
        `;
        return confirmed.verify(expectation);
      },
    };

    await expect(
      confirmPolicyRevocation(
        sql,
        identity,
        draft.policyId,
        {
          rootSignature: await owner.signTypedData(revocation.typedData),
          transactionHash: txHash,
          userOperationHash: userOpHash,
          validUntil: "1789912800",
        },
        config,
        ownerChangedDuringVerification,
      ),
    ).rejects.toThrow("wallet owner epoch changed while confirming");
    const [row] = await sql<{ status: string }[]>`
      select status from wallet_policies where id = ${draft.policyId}
    `;
    expect(row?.status).toBe("ACTIVE");
  });

  it("rejects broader permissions and stale chain observations", async () => {
    const draft = await createWalletPolicy(sql, identity, { policy });
    await expect(
      preparePolicyActivation(
        sql,
        identity,
        draft.policyId,
        {
          ...transition,
          permission: {
            ...transition.permission,
            selectors: [ACCOUNT_EXECUTE_SELECTOR],
          },
        },
        config,
      ),
    ).rejects.toThrow();

    const prepared = await preparePolicyActivation(
      sql,
      identity,
      draft.policyId,
      transition,
      config,
    );
    const rootSignature = await owner.signTypedData(prepared.typedData);
    await expect(
      confirmPolicyActivation(
        sql,
        identity,
        draft.policyId,
        {
          ...transition,
          rootSignature,
          transactionHash: txHash,
          userOperationHash: userOpHash,
        },
        config,
        confirmedVerifier({
          activePolicyHash: draft.policyHash,
          ownerEpoch: "1",
          permissionHash: prepared.permissionHash,
          rootOwner: "0x7777777777777777777777777777777777777777",
        }),
      ),
    ).rejects.toThrow("confirmed root owner is stale");
  });
});
