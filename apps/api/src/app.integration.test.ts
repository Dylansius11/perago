import { readFile } from "node:fs/promises";
import {
  deriveSemiModularAccountAddress,
  getAccountPolicyTypedData,
  hashTaskIntent,
} from "@perago/sdk";
import postgres from "postgres";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApp } from "./app.js";
import type { WalletAuthConfig } from "./auth/wallet-auth.js";
import { loadBscTestnetCatalog } from "./compiler/catalog.js";
import { loadDeployment } from "./deployment.js";
import { type Planner, PlannerUnavailableError } from "./planner/provider.js";
import type {
  PolicyChainVerifier,
  PolicyServiceConfig,
} from "./services/policies.js";
import type { TaskServiceConfig } from "./services/tasks.js";

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
  new URL("../drizzle/0002_task_compilation.sql", import.meta.url),
  new URL("../drizzle/0003_mandate_signing.sql", import.meta.url),
  new URL("../drizzle/0004_execution_worker.sql", import.meta.url),
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
const catalog = loadBscTestnetCatalog();
const [wbnb, cake] = ["WBNB", "Cake"].map(
  (symbol) =>
    catalog.tokens.find((token) => token.symbol === symbol)?.address ?? "",
);
const taskConfig: TaskServiceConfig = {
  catalog,
  compileLeaseSeconds: 120,
  intentKey: Buffer.alloc(32, 7),
  now: () => now,
};
/** Scripted provider seam; the real Groq path is smoked separately. */
const plannerQueue: unknown[] = [];
let plannerCalls = 0;
const planner: Planner = async () => {
  plannerCalls += 1;
  const next = plannerQueue.shift();
  if (next instanceof Error) throw next;
  return next;
};
const app = createApiApp({
  authConfig,
  // Chain-backed simulation and signing are proven by the Phase 3 fork smoke;
  // these routes never reach the chain, so the client points nowhere.
  mandateConfig: {
    blockTag: "latest",
    catalog,
    client: createPublicClient({ transport: http("http://127.0.0.1:9") }),
    deployment: loadDeployment(catalog, "deployments/bsc-testnet.perago.json"),
    now: () => now,
    quoteTtlSeconds: 120,
  },
  executionConfig: {
    client: createPublicClient({ transport: http("http://127.0.0.1:9") }),
    deployment: loadDeployment(catalog, "deployments/bsc-testnet.perago.json"),
    leaseSeconds: 60,
    workerTokenHash: Buffer.alloc(32, 1),
  },
  planner,
  policyConfig,
  policyVerifier: verifier,
  sql,
  taskConfig,
});
let authorization = "";

function swapCandidate(inputAmount: string) {
  return {
    action: {
      kind: "SWAP",
      adapterId: "pancakeswap-v3",
      inputSymbol: "WBNB",
      inputAmount,
      outputSymbol: "Cake",
      maxSlippageBps: null,
      recipient: null,
    },
  };
}

function postTask(clientRequestId: string, goal: string) {
  return app.request("/tasks", {
    body: JSON.stringify({
      clientRequestId,
      intent: {
        schemaVersion: "1",
        account,
        chainId: "97",
        recipient: account,
        goal,
        requestedExpirySeconds: "1800",
      },
    }),
    headers: { authorization, "content-type": "application/json" },
    method: "POST",
  });
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

describe("P3-002 API route smoke", () => {
  it("authenticates a real signature and activates a validated policy through Hono", async () => {
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
    authorization = `Bearer ${session.token}`;

    const policyResponse = await app.request("/policies", {
      body: JSON.stringify({
        policy: {
          account,
          activeAssets: [
            {
              maxInputPerTask: "1000000000000000000",
              rollingDailyCap: "1000000000000000000",
              token: wbnb,
            },
          ],
          allowedRecipients: "SELF",
          approvedAdapterIds: ["pancakeswap-v3"],
          chainId: "97",
          maxSlippageBps: "100",
          maxTaskLifetimeSeconds: "3600",
          protectedAssets: [cake],
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

  it("compiles an intent through the active policy and persists the rule matrix", async () => {
    type TaskResponse = {
      decision: {
        outcome: string;
        rules: { rule: string; outcome: string; reasonCode: string | null }[];
      };
      plan: {
        action: { inputAmount: string; inputToken: string; poolFee: string };
      } | null;
      planHash: string | null;
      status: string;
      taskId: string;
    };

    plannerQueue.push(new PlannerUnavailableError("planner request failed"));
    const unavailable = await postTask(
      "request-swap-1",
      "Swap 0.5 WBNB for CAKE",
    );
    expect(unavailable.status).toBe(503);
    const draft = (await unavailable.json()) as {
      taskId: string;
      status: string;
    };
    expect(draft.status).toBe("DRAFT");

    plannerQueue.push(swapCandidate("0.5"));
    const compiled = await postTask("request-swap-1", "Swap 0.5 WBNB for CAKE");
    expect(compiled.status).toBe(200);
    const passing = (await compiled.json()) as TaskResponse;
    expect(passing.taskId).toBe(draft.taskId);
    expect(passing.status).toBe("READY_TO_SIMULATE");
    expect(passing.decision.outcome).toBe("PASS");
    expect(passing.plan?.action).toMatchObject({
      inputAmount: "500000000000000000",
      inputToken: wbnb,
      poolFee: "500",
    });

    const callsBeforeReplay = plannerCalls;
    const replay = await postTask("request-swap-1", "Swap 0.5 WBNB for CAKE");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(passing);
    expect(plannerCalls).toBe(callsBeforeReplay);

    const reused = await postTask("request-swap-1", "Swap 0.9 WBNB for CAKE");
    expect(reused.status).toBe(409);

    const [stored] = await sql<
      {
        intent_document: Record<string, string>;
        intent_hash: Buffer;
        intent_text_ciphertext: Buffer;
      }[]
    >`select intent_document, intent_hash, intent_text_ciphertext from tasks where id = ${passing.taskId}`;
    expect(stored?.intent_document.goal).toBeUndefined();
    expect(stored?.intent_text_ciphertext.includes("Swap 0.5 WBNB")).toBe(
      false,
    );
    expect(`0x${stored?.intent_hash.toString("hex")}`).toBe(
      hashTaskIntent({
        ...stored?.intent_document,
        goal: "Swap 0.5 WBNB for CAKE",
      }),
    );

    // A signed mandate reserves its spend against the rolling daily cap.
    const adapterId = "00000000-0000-4000-8000-000000000001";
    const simulationId = "00000000-0000-4000-8000-000000000002";
    const bytes = (length: number, fill: number) => Buffer.alloc(length, fill);
    await sql`
      insert into protocol_adapters (
        id, chain_id, kind, slug, status, adapter_address, adapter_code_hash,
        verifier_id, protocol_name, protocol_target_address, entry_selector,
        config_document, source_url
      ) values (
        ${adapterId}, 97, 'SWAP', 'pancakeswap-v3', 'PROPOSED', ${bytes(20, 1)},
        ${bytes(32, 2)}, ${bytes(32, 3)}, 'PancakeSwap V3', ${bytes(20, 4)},
        ${bytes(4, 5)}, ${sql.json({})}, 'https://example.test'
      )
    `;
    await sql`
      insert into simulations (
        id, task_id, adapter_id, sequence, status, chain_id, block_number,
        block_hash, adapter_code_hash, quote_expires_at, request_document,
        result_document, simulation_hash
      ) values (
        ${simulationId}, ${passing.taskId}, ${adapterId}, 1, 'PASSED', 97, 1,
        ${bytes(32, 6)}, ${bytes(32, 2)}, ${now}, ${sql.json({})},
        ${sql.json({})}, ${bytes(32, 7)}
      )
    `;
    const [task] = await sql<{ wallet_id: string; wallet_policy_id: string }[]>`
      select wallet_id, wallet_policy_id from tasks where id = ${passing.taskId}
    `;
    const insertMandate = () => sql`
      insert into mandates (
        mandate_hash, task_id, simulation_id, wallet_id, wallet_policy_id,
        adapter_id, chain_id, mandate_executor_address, root_owner_address,
        account_address, executor_address, nonce, expires_at_chain_seconds,
        typed_data, signature, status, created_at
      ) values (
        ${bytes(32, 8)}, ${passing.taskId}, ${simulationId}, ${task?.wallet_id ?? ""},
        ${task?.wallet_policy_id ?? ""}, ${adapterId}, 97, ${bytes(20, 9)},
        ${bytes(20, 10)}, ${bytes(20, 11)}, ${bytes(20, 12)}, 1, 2000000000,
        ${sql.json({})}, ${bytes(65, 13)}, 'SIGNED',
        ${new Date(now.getTime() - 3_600_000)}
      )
    `;
    // The database admits a signed mandate only for a task ready to sign on its
    // latest passing simulation, and a SIGNED task only with that mandate.
    await expect(insertMandate()).rejects.toThrow(
      /latest passing simulation while ready to sign/u,
    );
    await sql`update tasks set status = 'SIMULATED' where id = ${passing.taskId}`;
    await sql`update tasks set status = 'READY_TO_SIGN' where id = ${passing.taskId}`;
    await expect(
      sql`update tasks set status = 'SIGNED' where id = ${passing.taskId}`,
    ).rejects.toThrow(/requires its signed mandate/u);
    await insertMandate();
    await sql`update tasks set status = 'SIGNED' where id = ${passing.taskId}`;
    await expect(
      sql`insert into executions (id, mandate_hash, status) values (${adapterId}, ${bytes(32, 8)}, 'LEASED')`,
    ).rejects.toThrow(/queued fresh/u);

    plannerQueue.push(swapCandidate("0.6"));
    const overCap = await postTask("request-swap-2", "Swap 0.6 WBNB for CAKE");
    expect(overCap.status).toBe(200);
    const rejected = (await overCap.json()) as TaskResponse;
    expect(rejected.status).toBe("REJECTED_POLICY");
    expect(rejected.plan).toBeNull();
    expect(
      rejected.decision.rules.filter((rule) => rule.outcome === "FAIL"),
    ).toEqual([
      {
        rule: "DAILY_CAP",
        outcome: "FAIL",
        reasonCode: "DAILY_CAP_EXCEEDED",
        limit: "1000000000000000000",
        observed: "500000000000000000 reserved in 24h + 600000000000000000",
      },
    ]);

    plannerQueue.push({ action: { kind: "SWAP", calldata: "0xa9059cbb" } });
    const invalid = await postTask(
      "request-swap-3",
      "Swap using this calldata",
    );
    expect(invalid.status).toBe(502);

    await expect(
      sql`update tasks set status = 'READY_TO_SIMULATE' where id = ${rejected.taskId}`,
    ).rejects.toThrow(/illegal task transition/u);
    await expect(
      sql`update tasks set policy_decision = '{}'::jsonb where id = ${passing.taskId}`,
    ).rejects.toThrow(/compilation is immutable/u);
  });
});
