import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import {
  type Address,
  buildUserOperation,
  buildUserOperationNonceKey,
  deriveSemiModularAccountAddress,
  encodeAccountExecute,
  encodeAccountExecuteBatch,
  encodeAccountPolicyTransition,
  encodeHandleOps,
  encodeSemiModularAccountFactoryData,
  getAccountPolicyTypedData,
  getTaskMandateTypedData,
  type Hash,
  hashUserOperation,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  mandateExecutorAbi,
  packUserOperationSignature,
  ROOT_OWNER_ENTITY_ID,
  type TaskMandate,
  wrapExecuteUserOp,
} from "@perago/sdk";
import postgres from "postgres";
import {
  BaseError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  type Hex,
  maxUint256,
  type PublicClient,
  parseAbi,
  parseEther,
  parseEventLogs,
  toFunctionSelector,
} from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApp } from "../app.js";
import { loadBscTestnetCatalog } from "../compiler/catalog.js";
import { loadDeployment, type PeragoDeployment } from "../deployment.js";
import { createOpenRouterPlanner } from "../planner/provider.js";
import { registerDeploymentAdapters } from "../services/mandates.js";
import type { PolicyChainVerifier } from "../services/policies.js";
import {
  createExecutorProcesses,
  events,
  submitted,
  type WorkerRun,
} from "./executor-process.js";
import {
  deployUnboundExecutor,
  forkTransport,
  manifestDeployer,
  requiredEnv,
  resetDatabase,
  startAnvil,
} from "./fork.js";

/**
 * P4-002 smoke. The real API (HTTP, PostgreSQL, OpenRouter planner) queues signed
 * mandates; the real executor process (`apps/executor/src/main.ts`) leases and
 * drives them against a local anvil fork of BSC Testnet that mines a block
 * every second with `finalized` two blocks behind `latest`. The executor is
 * killed and restarted between every lifecycle transition, raced against a
 * second worker, fed dropped and replaced transactions, and handed revoked,
 * nonce-invalidated, expired, and stalled mandates. MandateExecutor is a fork
 * deployment over the production adapters that allows unbound ERC-8183 jobs
 * (labelled `fork-unbound`); nothing is broadcast to chain 97.
 */

const SMOKE = "Phase 4 executor";
const RPC = requiredEnv("PERAGO_BSC_TESTNET_RPC", SMOKE);
const DATABASE_URL = requiredEnv("TEST_DATABASE_URL", SMOKE);
const OPENROUTER_KEY = requiredEnv("PERAGO_OPENROUTER_API_KEY", SMOKE);
const ANVIL = process.env.ANVIL_BIN || "anvil";
const FORGE = process.env.FORGE_BIN || "forge";
const PORT = 8549;
const FORK_URL = `http://127.0.0.1:${PORT}`;
const LEASE_SECONDS = 4;
const EXECUTION_WINDOW = 600n;
const EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../../../docs/evidence/bsc-testnet.fork.phase4-executor-smoke.json",
    import.meta.url,
  ),
);
const ENTRY_POINT = MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint;

const catalog = loadBscTestnetCatalog();
const production = loadDeployment(
  catalog,
  "deployments/bsc-testnet.perago.json",
);
const token = (symbol: string) => {
  const found = catalog.tokens.find((entry) => entry.symbol === symbol);
  if (!found) throw new Error(`catalog has no ${symbol}`);
  return found.address;
};
const WBNB = token("WBNB");
const CAKE = token("Cake");
const wbnbAbi = parseAbi(["function deposit() payable"]);
const performSelector = toFunctionSelector(
  getAbiItem({ abi: mandateExecutorAbi, name: "perform" }),
);

// biome-ignore lint/suspicious/noExplicitAny: untyped JSON response bodies
type ApiBody = Record<string, any>;

const rootOwner = privateKeyToAccount(generatePrivateKey());
const sessionKey = generatePrivateKey();
const session = privateKeyToAccount(sessionKey);
/** A generated fork relayer: chain 97 has an EIP-7702 delegation on the well-known dev key. */
const relayer = privateKeyToAccount(generatePrivateKey());
const workerToken = randomBytes(32).toString("base64url");
const testClient = createTestClient({
  chain: bscTestnet,
  mode: "anvil",
  transport: forkTransport(FORK_URL),
});
const wallet = createWalletClient({
  chain: bscTestnet,
  transport: forkTransport(FORK_URL),
});
const evidence: Record<string, unknown> = {};
const executorLog: string[] = [];

let anvil: ChildProcess | undefined;
let server: ReturnType<typeof serve> | undefined;
let sql: postgres.Sql;
let fork: PublicClient;
let deployment: PeragoDeployment;
let account: Address;
let apiUrl = "";
let manifestPath = "";
let authorization = "";
let sessionEntityId = 0;
/** Every write in this smoke is after this block; earlier ranges would be served by chain 97's RPC. */
let forkBlockNumber = 0n;

const asBuffer = (value: Hex) => Buffer.from(value.slice(2), "hex");
const asHex = (value: Buffer | null) =>
  value ? (`0x${value.toString("hex")}` as Hex) : null;

async function api(path: string, body: unknown, method = "POST") {
  const response = await fetch(new URL(path, apiUrl), {
    body: JSON.stringify(body),
    headers: { authorization, "content-type": "application/json" },
    method,
  });
  return { body: (await response.json()) as ApiBody, status: response.status };
}

/** A root-owner UserOperation, submitted to the EntryPoint by an unrelated relayer. */
async function rootOperation(callData: Hex) {
  const nonce = await fork.readContract({
    abi: entryPoint07Abi,
    address: ENTRY_POINT,
    args: [
      account,
      buildUserOperationNonceKey({
        entityId: ROOT_OWNER_ENTITY_ID,
        isGlobalValidation: true,
      }),
    ],
    functionName: "getNonce",
  });
  const unsigned = buildUserOperation({ callData, nonce, sender: account });
  const userOperationHash = hashUserOperation(unsigned, 97);
  const signed = {
    ...unsigned,
    signature: packUserOperationSignature(
      await rootOwner.signMessage({ message: { raw: userOperationHash } }),
    ),
  };
  const hash = await wallet.sendTransaction({
    account: relayer,
    data: encodeHandleOps([signed], relayer.address),
    to: ENTRY_POINT,
  });
  const receipt = await fork.waitForTransactionReceipt({ hash });
  const [event] = parseEventLogs({
    abi: entryPoint07Abi,
    eventName: "UserOperationEvent",
    logs: receipt.logs,
  });
  expect(event?.args.userOpHash).toBe(userOperationHash);
  expect(event?.args.success).toBe(true);
  return { transactionHash: hash, userOperationHash };
}

const rootCall = (target: Address, data: Hex) =>
  rootOperation(encodeAccountExecute({ data, target, value: 0n }));

const approveExecutor = (mandate: TaskMandate, amount: bigint) =>
  rootCall(
    mandate.inputToken,
    encodeFunctionData({
      abi: erc20Abi,
      args: [deployment.mandateExecutor.address, amount],
      functionName: "approve",
    }),
  );

type Signed = { taskId: string; mandate: TaskMandate; mandateHash: Hash };

/** Natural-language goal to a root-signed, queued mandate through the public API. */
async function signedMandate(
  clientRequestId: string,
  goal: string,
): Promise<Signed> {
  const task = await api("/tasks", {
    clientRequestId,
    intent: {
      schemaVersion: "1",
      account,
      chainId: "97",
      recipient: account,
      goal,
      requestedExpirySeconds: "1800",
    },
  });
  expect(task.status, JSON.stringify(task.body)).toBe(200);
  const simulation = await api(`/tasks/${task.body.taskId}/simulations`, {});
  expect(simulation.status, JSON.stringify(simulation.body)).toBe(201);
  expect(simulation.body.status).toBe("PASSED");
  const prepared = await api(`/tasks/${task.body.taskId}/mandate/prepare`, {});
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
  const signature = await rootOwner.signTypedData(
    getTaskMandateTypedData(prepared.body.mandate, prepared.body.domain),
  );
  const accepted = await api(`/tasks/${task.body.taskId}/mandate`, {
    signature,
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  return {
    mandate: prepared.body.mandate,
    mandateHash: prepared.body.mandateHash,
    taskId: task.body.taskId,
  };
}

let executor: ReturnType<typeof createExecutorProcesses>;

type Submission = {
  kind: string;
  transactionHash: Hash;
  userOperationHash: Hash | null;
};

/** Runs one step that must submit exactly one transaction of `kind`. */
async function submits(name: string, kind: string): Promise<Submission> {
  const lines = submitted(await executor.step(name));
  expect(
    lines.map((line) => line.kind),
    name,
  ).toEqual([kind]);
  const [line] = lines;
  if (!line?.transactionHash) throw new Error(`${name} logged no hash`);
  return {
    kind,
    transactionHash: line.transactionHash,
    userOperationHash: line.userOperationHash ?? null,
  };
}

/** Waits until a transaction's block is at or below the fork's `finalized` tag. */
async function awaitFinality(hash: Hash) {
  const receipt = await fork.waitForTransactionReceipt({ hash });
  while (
    (await fork.getBlock({ blockTag: "finalized" })).number <
    receipt.blockNumber
  ) {
    await delay(300); // Blocks arrive once per second; finality has no subscription.
  }
  return receipt;
}

function hasRevertData(value: unknown): value is { data: Hex } {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "string" &&
    value.data.startsWith("0x")
  );
}

type ExecutionRow = {
  status: string;
  mandate_status: string;
  pending_transaction_kind: string | null;
  pending_transaction_hash: Buffer | null;
  pending_user_operation_hash: Buffer | null;
  authorize_tx_hash: Buffer | null;
  begin_tx_hash: Buffer | null;
  execute_user_operation_hash: Buffer | null;
  execute_tx_hash: Buffer | null;
  finalize_tx_hash: Buffer | null;
  submission_attempts: number;
  last_error_code: string | null;
  last_error_detail: string | null;
};

async function execution(mandateHash: Hash): Promise<ExecutionRow> {
  const [row] = await sql<ExecutionRow[]>`
    select e.status, m.status as mandate_status, e.pending_transaction_kind,
      e.pending_transaction_hash, e.pending_user_operation_hash, e.authorize_tx_hash,
      e.begin_tx_hash, e.execute_user_operation_hash, e.execute_tx_hash, e.finalize_tx_hash,
      e.submission_attempts, e.last_error_code, e.last_error_detail
    from executions e join mandates m on m.mandate_hash = e.mandate_hash
    where e.mandate_hash = ${asBuffer(mandateHash)}
  `;
  if (!row) throw new Error(`no execution for ${mandateHash}`);
  return row;
}

const MANDATE_STATUS = [
  "NONE",
  "AUTHORIZED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REVOKED",
  "EXPIRED",
];

async function onchainStatus(mandateHash: Hash): Promise<string> {
  const record = await fork.readContract({
    abi: mandateExecutorAbi,
    address: deployment.mandateExecutor.address,
    args: [mandateHash],
    functionName: "mandateRecord",
  });
  return MANDATE_STATUS[record.status] ?? "UNKNOWN";
}

/** Every MandateExecutor lifecycle event ever emitted for one mandate. */
async function lifecycle(mandateHash: Hash): Promise<string[]> {
  const logs = await fork.getContractEvents({
    abi: mandateExecutorAbi,
    address: deployment.mandateExecutor.address,
    // Blocks at or below the fork point are served by chain 97's RPC; this smoke's logs are all later.
    fromBlock: forkBlockNumber + 1n,
  });
  return logs
    .filter(
      (log) =>
        "mandateHash" in log.args &&
        log.args.mandateHash?.toLowerCase() === mandateHash,
    )
    .map((log) => log.eventName);
}

const executorNonce = () =>
  fork.getTransactionCount({ address: session.address });

async function pauseMining() {
  await testClient.setIntervalMining({ interval: 0 });
}
async function resumeMining() {
  await testClient.setIntervalMining({ interval: 1 });
}

function printableRow(row: ExecutionRow) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      Buffer.isBuffer(value) ? asHex(value) : value,
    ]),
  );
}

beforeAll(async () => {
  anvil = await startAnvil({
    anvil: ANVIL,
    blockTime: 1,
    port: PORT,
    rpc: RPC,
    slotsInAnEpoch: 1,
  });
  fork = createPublicClient({
    chain: bscTestnet,
    transport: forkTransport(FORK_URL),
  });
  const forkBlock = await fork.getBlock();
  forkBlockNumber = forkBlock.number;
  await testClient.setBalance({
    address: relayer.address,
    value: parseEther("100"),
  });
  const created = await deployUnboundExecutor({
    executionWindowSeconds: EXECUTION_WINDOW,
    forge: FORGE,
    forkUrl: FORK_URL,
    production,
  });
  deployment = created.deployment;

  // The executor process reads its deployment from a manifest, as in production.
  manifestPath = join(
    await mkdtemp(join(tmpdir(), "perago-p4-")),
    "fork.perago.json",
  );
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      chainId: 97,
      label: deployment.label,
      protocolManifest: "deployments/bsc-testnet.protocols.json",
      constructor: {
        executionWindowSeconds: EXECUTION_WINDOW.toString(),
        allowUnboundCommerceJobs: true,
      },
      contracts: {
        mandateExecutor: deployment.mandateExecutor,
        swapAdapter: production.adapters.SWAP.adapter,
        swapVerifier: production.adapters.SWAP.verifier,
        stakeAdapter: production.adapters.STAKE.adapter,
        stakeVerifier: production.adapters.STAKE.verifier,
      },
    }),
  );

  account = deriveSemiModularAccountAddress({
    owner: rootOwner.address,
  }).toLowerCase() as Address;
  const factoryHash = await wallet.sendTransaction({
    account: relayer,
    data: encodeSemiModularAccountFactoryData({ owner: rootOwner.address }),
    to: MODULAR_ACCOUNT_V2_ADDRESSES.factory,
  });
  expect(
    (await fork.waitForTransactionReceipt({ hash: factoryHash })).status,
  ).toBe("success");
  await testClient.setBalance({ address: account, value: parseEther("1") });
  await testClient.setBalance({
    address: session.address,
    value: parseEther("5"),
  });
  await testClient.impersonateAccount({ address: account });
  await fork.waitForTransactionReceipt({
    hash: await wallet.sendTransaction({
      account,
      data: encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }),
      to: WBNB,
      value: parseEther("0.5"),
    }),
  });
  await testClient.stopImpersonatingAccount({ address: account });
  const deployer = await manifestDeployer();
  await testClient.impersonateAccount({ address: deployer });
  await fork.waitForTransactionReceipt({
    hash: await wallet.sendTransaction({
      account: deployer,
      data: encodeFunctionData({
        abi: erc20Abi,
        args: [account, parseEther("10")],
        functionName: "transfer",
      }),
      to: CAKE,
    }),
  });
  await testClient.stopImpersonatingAccount({ address: deployer });

  sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
  await resetDatabase(sql);
  await registerDeploymentAdapters(sql, {
    blockTag: "latest",
    client: fork,
    deployment,
  });

  const forkPolicyVerifier: PolicyChainVerifier = {
    async verify(expectation) {
      const receipt = await fork.getTransactionReceipt({
        hash: expectation.transactionHash,
      });
      const config = await fork.readContract({
        abi: mandateExecutorAbi,
        address: deployment.mandateExecutor.address,
        args: [expectation.account],
        functionName: "accountConfig",
      });
      return {
        account: expectation.account,
        activePolicyHash: config.activePolicyHash.toLowerCase() as Hash,
        blockNumber: receipt.blockNumber,
        observedAt: new Date(),
        ownerEpoch: config.ownerEpoch.toString(),
        permissionHash: config.permissionHash.toLowerCase() as Hash,
        rootOwner: config.rootOwner.toLowerCase() as Address,
        status: "CONFIRMED",
      };
    },
  };
  const app = createApiApp({
    authConfig: {
      challengeTtlMs: 300_000,
      domain: "api.perago.test",
      now: () => new Date(),
      sessionTtlMs: 3_600_000,
      uri: "https://api.perago.test",
    },
    executionConfig: {
      client: fork,
      deployment,
      leaseSeconds: LEASE_SECONDS,
      workerTokenHash: createHash("sha256").update(workerToken).digest(),
    },
    mandateConfig: {
      blockTag: "latest",
      catalog,
      client: fork,
      deployment,
      now: () => new Date(),
      quoteTtlSeconds: 120,
    },
    planner: createOpenRouterPlanner({
      apiKey: OPENROUTER_KEY,
      timeoutMs: 60_000,
    }),
    policyConfig: {
      mandateExecutor: deployment.mandateExecutor.address,
      now: () => new Date(),
      performSelector,
      tokens: catalog.tokens.map((token) => token.address),
    },
    policyVerifier: forkPolicyVerifier,
    sql,
    taskConfig: {
      catalog,
      compileLeaseSeconds: 120,
      intentKey: randomBytes(32),
      now: () => new Date(),
    },
  });
  const started = Promise.withResolvers<AddressInfo>();
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
    started.resolve(info),
  );
  apiUrl = `http://127.0.0.1:${(await started.promise).port}/`;
  executor = createExecutorProcesses({
    apiUrl,
    executorKey: sessionKey,
    log: executorLog,
    manifestPath,
    pollMs: 400,
    rpcUrl: FORK_URL,
    workerToken,
  });

  evidence.label =
    "fork: every write below is on a local anvil fork of BSC Testnet (chain 97) mining one block per second with finalized = latest - 2; nothing was broadcast to chain 97";
  evidence.fork = {
    chainId: 97,
    forkedAtBlock: forkBlock.number.toString(),
    forkedAtBlockHash: forkBlock.hash,
    anvil: "--block-time 1 --slots-in-an-epoch 1",
    mandateExecutor: deployment.mandateExecutor,
    mandateExecutorDeployTransaction: created.transactionHash,
    mandateExecutorConstructor: {
      swapAdapter: production.adapters.SWAP.adapter.address,
      stakeAdapter: production.adapters.STAKE.adapter.address,
      executionWindowSeconds: EXECUTION_WINDOW.toString(),
      allowUnboundCommerceJobs: true,
    },
    productionAdaptersAndVerifiers: "deployments/bsc-testnet.perago.json",
    account,
    rootOwner: rootOwner.address.toLowerCase(),
    executorSession: session.address.toLowerCase(),
    keys: "root owner, session/executor, and worker token were generated for this run and never persisted",
    executorProcess:
      "apps/executor/src/main.ts, spawned with only PATH and PERAGO_* deployment variables",
  };
}, 300_000);

afterAll(async () => {
  server?.close();
  anvil?.kill();
  await sql?.end();
});

describe("Phase 4 executor smoke on a chain-97 fork", {
  timeout: 900_000,
}, () => {
  it("activates a Wallet Policy with a real root UserOperation that installs the perform-only session", async () => {
    const challenge = await api("/auth/challenges", {
      account,
      chainId: "97",
      rootOwner: rootOwner.address,
    });
    expect(challenge.status).toBe(201);
    const sessionResponse = await api("/auth/sessions", {
      challengeId: challenge.body.challengeId,
      signature: await rootOwner.signMessage({
        message: challenge.body.message,
      }),
    });
    expect(sessionResponse.status).toBe(201);
    authorization = `Bearer ${sessionResponse.body.token}`;

    const policy = await api("/policies", {
      policy: {
        schemaVersion: "1",
        account,
        chainId: "97",
        version: "1",
        protectedAssets: [],
        activeAssets: [
          {
            token: WBNB,
            maxInputPerTask: parseEther("0.05").toString(),
            rollingDailyCap: parseEther("0.5").toString(),
          },
          {
            token: CAKE,
            maxInputPerTask: parseEther("5").toString(),
            rollingDailyCap: parseEther("20").toString(),
          },
        ],
        services: ["SWAP", "STAKE"],
        approvedAdapterIds: ["pancakeswap-v3", "cake-pool"],
        maxSlippageBps: "100",
        allowedRecipients: "SELF",
        maxTaskLifetimeSeconds: "3600",
      },
    });
    expect(policy.status).toBe(201);

    const chainNow = (await fork.getBlock()).timestamp;
    const validUntil = String(chainNow + 2n * 86_400n);
    sessionEntityId = 1;
    const transition = {
      ownerEpoch: "1",
      permission: {
        account,
        entityId: sessionEntityId,
        nativeSpendLimit: "0",
        selectors: [performSelector],
        sessionSigner: session.address,
        target: deployment.mandateExecutor.address,
        validAfter: String(chainNow - 60n),
        validUntil,
      },
      validUntil,
    };
    const prepared = await api(
      `/policies/${policy.body.policyId}/activation/prepare`,
      transition,
    );
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    const rootSignature = await rootOwner.signTypedData(
      getAccountPolicyTypedData(prepared.body.accountPolicy, {
        chainId: "97",
        verifyingContract: deployment.mandateExecutor.address,
      }),
    );
    const activation = await rootOperation(
      encodeAccountPolicyTransition({
        account,
        allowances: prepared.body.allowances.map(
          (allowance: { amount: string; token: Address }) => ({
            amount: BigInt(allowance.amount),
            token: allowance.token,
          }),
        ),
        mandateExecutor: deployment.mandateExecutor.address,
        permissionCallData: prepared.body.permissionCallData,
        policy: prepared.body.accountPolicy,
        rootSignature,
      }),
    );
    const confirmed = await api(
      `/policies/${policy.body.policyId}/activation`,
      { ...transition, rootSignature, ...activation },
      "PUT",
    );
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    evidence.policy = {
      policyHash: policy.body.policyHash,
      accountPolicy: prepared.body.accountPolicy,
      session: transition.permission,
      activation: {
        ...activation,
        note: "one root UserOperation installed the perform-only session and registered the policy in MandateExecutor",
      },
    };
  });

  it("refuses every forbidden session call at the account", async () => {
    const nonce = await fork.readContract({
      abi: entryPoint07Abi,
      address: ENTRY_POINT,
      args: [
        account,
        buildUserOperationNonceKey({
          entityId: sessionEntityId,
          isGlobalValidation: false,
        }),
      ],
      functionName: "getNonce",
    });
    const forbidden: [string, Hex][] = [
      [
        "token approve through the session",
        wrapExecuteUserOp(
          encodeAccountExecute({
            data: encodeFunctionData({
              abi: erc20Abi,
              args: [session.address, maxUint256],
              functionName: "approve",
            }),
            target: WBNB,
            value: 0n,
          }),
        ),
      ],
      [
        "MandateExecutor.revoke, a selector outside the perform-only allowlist",
        wrapExecuteUserOp(
          encodeAccountExecute({
            data: encodeFunctionData({
              abi: mandateExecutorAbi,
              args: [`0x${"00".repeat(32)}`],
              functionName: "revoke",
            }),
            target: deployment.mandateExecutor.address,
            value: 0n,
          }),
        ),
      ],
      [
        "executeBatch, a privileged account selector",
        encodeAccountExecuteBatch([{ data: "0x", target: WBNB, value: 0n }]),
      ],
      [
        "native value out of the account",
        wrapExecuteUserOp(
          encodeAccountExecute({
            data: "0x",
            target: session.address,
            value: 1n,
          }),
        ),
      ],
    ];
    const refusals: Record<string, string>[] = [];
    for (const [name, callData] of forbidden) {
      const unsigned = buildUserOperation({ callData, nonce, sender: account });
      const userOperationHash = hashUserOperation(unsigned, 97);
      const signed = {
        ...unsigned,
        signature: packUserOperationSignature(
          await session.signMessage({ message: { raw: userOperationHash } }),
        ),
      };
      let refusal = "";
      try {
        await fork.call({
          account: relayer,
          data: encodeHandleOps([signed], relayer.address),
          to: ENTRY_POINT,
        });
      } catch (error) {
        const carrier =
          error instanceof BaseError ? error.walk(hasRevertData) : null;
        const data = hasRevertData(carrier) ? carrier.data : null;
        const decoded = data
          ? decodeErrorResult({ abi: entryPoint07Abi, data })
          : null;
        refusal = decoded
          ? `${decoded.errorName}(${decoded.args?.slice(1).map(String).join(", ")})`
          : "reverted";
      }
      expect(refusal, name).toMatch(/^FailedOp/u);
      refusals.push({ call: name, refusal });
    }
    evidence.forbiddenSessionCalls = {
      note: "session-signed UserOperations evaluated with eth_call of EntryPoint.handleOps on the fork; each fails validation before any call",
      refusals,
    };
  });

  let swap: Signed;

  it("drives a swap through every transition with a fresh process per step and a racing second worker", async () => {
    swap = await signedMandate("p4-smoke-swap", "Swap 0.01 WBNB for CAKE");
    const duplicate = await sql`
      insert into executions (id, mandate_hash, status)
      values (gen_random_uuid(), ${asBuffer(swap.mandateHash)}, 'QUEUED')
    `.catch((error: Error) => error.message);
    expect(duplicate).toMatch(/duplicate key|unique/u);

    const approval = await approveExecutor(
      swap.mandate,
      BigInt(swap.mandate.maxInput),
    );
    const nonceBefore = await executorNonce();
    const wbnbBefore = await fork.readContract({
      abi: erc20Abi,
      address: WBNB,
      args: [account],
      functionName: "balanceOf",
    });
    const cakeBefore = await fork.readContract({
      abi: erc20Abi,
      address: CAKE,
      args: [account],
      functionName: "balanceOf",
    });

    const steps: Record<string, unknown>[] = [];
    // Two workers start together; only the lease holder acts, the other waits out the lease.
    const [first, second] = await Promise.all([
      executor.step("p4-race-a"),
      executor.step("p4-race-b"),
    ]);
    const record = async (name: string, run: WorkerRun) => {
      const row = await execution(swap.mandateHash);
      steps.push({
        worker: name,
        submitted: submitted(run).map((line) => ({
          kind: line.kind,
          transactionHash: line.transactionHash,
        })),
        executionStatus: row.status,
        pending: row.pending_transaction_kind,
        onchain: await onchainStatus(swap.mandateHash),
      });
    };
    await record("p4-race-a", first);
    await record("p4-race-b", second);
    expect(
      [...submitted(first), ...submitted(second)]
        .map((line) => line.kind)
        .sort(),
    ).toEqual(["AUTHORIZE", "BEGIN"]);

    const perform = await executor.step("p4-step-perform");
    await record("p4-step-perform", perform);
    expect(submitted(perform).map((line) => line.kind)).toEqual(["PERFORM"]);
    const finish = await executor.step("p4-step-finish");
    await record("p4-step-finish", finish);
    expect(submitted(finish)).toEqual([]);

    const row = await execution(swap.mandateHash);
    expect(row.status).toBe("TERMINAL");
    expect(row.mandate_status).toBe("SUCCEEDED");
    expect(row.submission_attempts).toBe(3);
    expect(await onchainStatus(swap.mandateHash)).toBe("SUCCEEDED");
    expect(await lifecycle(swap.mandateHash)).toEqual([
      "MandateAuthorized",
      "ExecutionBegun",
      "ExecutionReceiptRecorded",
    ]);
    expect((await executorNonce()) - nonceBefore).toBe(3);

    const wbnbAfter = await fork.readContract({
      abi: erc20Abi,
      address: WBNB,
      args: [account],
      functionName: "balanceOf",
    });
    const cakeAfter = await fork.readContract({
      abi: erc20Abi,
      address: CAKE,
      args: [account],
      functionName: "balanceOf",
    });
    expect(wbnbBefore - wbnbAfter).toBe(BigInt(swap.mandate.maxInput));
    expect(cakeAfter - cakeBefore).toBeGreaterThanOrEqual(
      BigInt(swap.mandate.minOutput),
    );
    const allowanceAfter = await fork.readContract({
      abi: erc20Abi,
      address: WBNB,
      args: [account, deployment.mandateExecutor.address],
      functionName: "allowance",
    });
    expect(allowanceAfter).toBe(0n);
    const [receipt] = await sql<
      { status: string; verification_hash: Buffer; execution_tx_hash: Buffer }[]
    >`
      select status, verification_hash, execution_tx_hash from execution_receipts
      where mandate_hash = ${asBuffer(swap.mandateHash)}
    `;
    expect(receipt?.status).toBe("SUCCEEDED");
    expect(asHex(receipt?.execution_tx_hash ?? null)).toBe(
      asHex(row.execute_tx_hash),
    );

    // A finished execution never re-enters the queue, and its row is immutable.
    const reopen = await sql`
      update executions set status = 'QUEUED' where mandate_hash = ${asBuffer(swap.mandateHash)}
    `.catch((error: Error) => error.message);
    expect(reopen).toMatch(/immutable/u);
    const idle = executor.start("p4-redelivery", "loop");
    await delay(6_000); // Gives a live worker several lease polls against a finished queue.
    idle.child.kill("SIGTERM");
    await idle.exited;
    expect(idle.lines.some((line) => line.includes('"job.leased"'))).toBe(
      false,
    );
    expect((await executorNonce()) - nonceBefore).toBe(3);

    evidence.swap = {
      taskId: swap.taskId,
      mandateHash: swap.mandateHash,
      mandate: swap.mandate,
      rootApproval: approval,
      duplicateExecutionInsert: duplicate,
      steps,
      execution: printableRow(row),
      onchainEvents: await lifecycle(swap.mandateHash),
      executorTransactions: 3,
      balances: {
        wbnbSpent: (wbnbBefore - wbnbAfter).toString(),
        cakeReceived: (cakeAfter - cakeBefore).toString(),
        minOutput: swap.mandate.minOutput,
        allowanceAfter: allowanceAfter.toString(),
      },
      receipt: {
        status: receipt?.status,
        verificationHash: asHex(receipt?.verification_hash ?? null),
      },
      finishedRowReopen: reopen,
      redelivery:
        "a live loop worker found nothing to lease for 6 s; the executor nonce did not move",
    };
  });

  it("rebroadcasts dropped transactions and UserOperations byte-for-byte and retires a replaced one", async () => {
    const stake = await signedMandate("p4-smoke-stake", "Stake 1 CAKE");
    await approveExecutor(stake.mandate, BigInt(stake.mandate.maxInput));
    const cakeBefore = await fork.readContract({
      abi: erc20Abi,
      address: CAKE,
      args: [account],
      functionName: "balanceOf",
    });
    const trail: Record<string, unknown>[] = [];

    // Dropped authorize: the persisted bytes are rebroadcast unchanged.
    await pauseMining();
    const authorize = await submits("p4-drop-authorize", "AUTHORIZE");
    expect(
      asHex((await execution(stake.mandateHash)).pending_transaction_hash),
    ).toBe(authorize.transactionHash);
    await testClient.dropTransaction({ hash: authorize.transactionHash });
    await resumeMining();
    const rebroadcast = await executor.step("p4-rebroadcast-authorize");
    expect(
      events(rebroadcast).some(
        (line) => line.event === "transaction.rebroadcast",
      ),
    ).toBe(true);
    expect(submitted(rebroadcast)).toEqual([]);
    expect((await awaitFinality(authorize.transactionHash)).status).toBe(
      "success",
    );
    trail.push({
      step: "authorize dropped from the mempool, then rebroadcast unchanged",
      transactionHash: authorize.transactionHash,
    });

    // Replaced begin: another transaction consumes its nonce; the API retires the hash only at finality.
    await pauseMining();
    const begin = await submits("p4-begin-to-replace", "BEGIN");
    const beginNonce = await fork.getTransactionCount({
      address: session.address,
      blockTag: "latest",
    });
    const replacement = await wallet.sendTransaction({
      account: session,
      maxFeePerGas: parseEther("0.0000001"),
      maxPriorityFeePerGas: parseEther("0.0000001"),
      nonce: beginNonce,
      to: session.address,
      value: 0n,
    });
    await resumeMining();
    expect((await awaitFinality(replacement)).status).toBe("success");
    const retired = await executor.step("p4-retire-begin");
    expect(
      events(retired).some((line) => line.event === "transaction.retired"),
    ).toBe(true);
    expect(
      (await execution(stake.mandateHash)).pending_transaction_hash,
    ).toBeNull();
    expect(await onchainStatus(stake.mandateHash)).toBe("AUTHORIZED");
    const rebegin = await submits("p4-begin-again", "BEGIN");
    expect(rebegin.transactionHash).not.toBe(begin.transactionHash);
    expect((await awaitFinality(rebegin.transactionHash)).status).toBe(
      "success",
    );
    trail.push({
      step: "begin replaced by a same-nonce transfer, retired at finality, then re-signed",
      replacedTransactionHash: begin.transactionHash,
      replacementTransactionHash: replacement,
      beginTransactionHash: rebegin.transactionHash,
    });

    // Dropped UserOperation: the same handleOps bytes carry the same UserOperation hash.
    await pauseMining();
    const perform = await submits("p4-drop-perform", "PERFORM");
    expect(
      asHex((await execution(stake.mandateHash)).pending_user_operation_hash),
    ).toBe(perform.userOperationHash);
    await testClient.dropTransaction({ hash: perform.transactionHash });
    await resumeMining();
    const rebroadcastPerform = await executor.step("p4-rebroadcast-perform");
    expect(submitted(rebroadcastPerform)).toEqual([]);
    const included = await awaitFinality(perform.transactionHash);
    const [event] = parseEventLogs({
      abi: entryPoint07Abi,
      eventName: "UserOperationEvent",
      logs: included.logs,
    });
    expect(event?.args.userOpHash).toBe(perform.userOperationHash);
    expect(event?.args.success).toBe(true);
    expect(submitted(await executor.step("p4-stake-finish"))).toEqual([]);
    trail.push({
      step: "perform handleOps dropped, then rebroadcast unchanged",
      transactionHash: perform.transactionHash,
      userOperationHash: perform.userOperationHash,
    });

    const row = await execution(stake.mandateHash);
    expect(row.status).toBe("TERMINAL");
    expect(row.mandate_status).toBe("SUCCEEDED");
    expect(asHex(row.execute_user_operation_hash)).toBe(
      perform.userOperationHash,
    );
    expect(asHex(row.begin_tx_hash)).toBe(rebegin.transactionHash);
    expect(await lifecycle(stake.mandateHash)).toEqual([
      "MandateAuthorized",
      "ExecutionBegun",
      "ExecutionReceiptRecorded",
    ]);
    const cakeAfter = await fork.readContract({
      abi: erc20Abi,
      address: CAKE,
      args: [account],
      functionName: "balanceOf",
    });
    expect(cakeBefore - cakeAfter).toBe(BigInt(stake.mandate.maxInput));
    evidence.stake = {
      taskId: stake.taskId,
      mandateHash: stake.mandateHash,
      mandate: stake.mandate,
      trail,
      execution: printableRow(row),
      onchainEvents: await lifecycle(stake.mandateHash),
      cakeStaked: (cakeBefore - cakeAfter).toString(),
    };
  });

  it("ends a revoked mandate without beginning it", async () => {
    const revoked = await signedMandate(
      "p4-smoke-revoke",
      "Swap 0.01 WBNB for CAKE",
    );
    await approveExecutor(revoked.mandate, BigInt(revoked.mandate.maxInput));
    const authorize = await submits("p4-revoke-authorize", "AUTHORIZE");
    await fork.waitForTransactionReceipt({ hash: authorize.transactionHash });
    const revocation = await rootCall(
      deployment.mandateExecutor.address,
      encodeFunctionData({
        abi: mandateExecutorAbi,
        args: [revoked.mandateHash],
        functionName: "revoke",
      }),
    );
    const finish = await executor.step("p4-revoke-finish");
    expect(submitted(finish)).toEqual([]);
    const row = await execution(revoked.mandateHash);
    expect(row.status).toBe("TERMINAL");
    expect(row.mandate_status).toBe("REVOKED");
    expect(row.begin_tx_hash).toBeNull();
    expect(await lifecycle(revoked.mandateHash)).toEqual([
      "MandateAuthorized",
      "MandateRevoked",
    ]);
    // The unexecuted mandate leaves its exact allowance; the owner clears it (SMART-CONTRACT.md §7).
    await approveExecutor(revoked.mandate, 0n);
    evidence.revoked = {
      mandateHash: revoked.mandateHash,
      authorizeTransaction: authorize.transactionHash,
      rootRevocation: revocation,
      execution: printableRow(row),
      onchainEvents: await lifecycle(revoked.mandateHash),
    };
  });

  it("defers without the exact root approval and rejects a mandate whose nonce the owner invalidated", async () => {
    const pending = await signedMandate(
      "p4-smoke-invalidate",
      "Swap 0.01 WBNB for CAKE",
    );
    // The precondition under test: MandateExecutor holds no allowance on the input.
    await approveExecutor(pending.mandate, 0n);
    const nonceBefore = await executorNonce();
    const deferred = await executor.step("p4-approval-missing");
    expect(submitted(deferred)).toEqual([]);
    expect(
      events(deferred).some(
        (line) =>
          line.event === "job.deferred" && line.code === "APPROVAL_MISSING",
      ),
    ).toBe(true);
    expect((await execution(pending.mandateHash)).status).toBe("RETRY_WAIT");

    const invalidation = await rootCall(
      deployment.mandateExecutor.address,
      encodeFunctionData({
        abi: mandateExecutorAbi,
        args: [[BigInt(pending.mandate.nonce)]],
        functionName: "invalidateNonces",
      }),
    );
    await awaitFinality(invalidation.transactionHash);
    const rejected = await executor.step("p4-rejected");
    expect(submitted(rejected)).toEqual([]);
    const row = await execution(pending.mandateHash);
    expect(row.status).toBe("REJECTED");
    expect(row.last_error_code).toBe("AUTHORIZATION_REJECTED");
    expect(row.last_error_detail).toBe("NonceAlreadyUsed");
    expect(await executorNonce()).toBe(nonceBefore);
    expect(await onchainStatus(pending.mandateHash)).toBe("NONE");
    evidence.rejectedBeforeAuthorization = {
      mandateHash: pending.mandateHash,
      deferral:
        "APPROVAL_MISSING: the account had no allowance for MandateExecutor, so the worker neither authorized nor spent the nonce",
      rootNonceInvalidation: invalidation,
      execution: printableRow(row),
      executorTransactions: 0,
    };
  });

  it("finalizes an expired authorization and a stalled attempt, surviving a SIGKILL mid-run", async () => {
    // An expiring authorization: authorized, then the owner withdraws the approval. The
    // deferral outlasts the run, so this job stays parked until the chain clock moves.
    const expiring = await signedMandate(
      "p4-smoke-expiring",
      "Swap 0.01 WBNB for CAKE",
    );
    await approveExecutor(expiring.mandate, BigInt(expiring.mandate.maxInput));
    const authorize = await submits("p4-expiring-authorize", "AUTHORIZE");
    await fork.waitForTransactionReceipt({ hash: authorize.transactionHash });
    await awaitFinality(
      (await approveExecutor(expiring.mandate, 0n)).transactionHash,
    );
    const withheld = await executor.step("p4-expiring-deferred", 3_600);
    expect(
      events(withheld).some(
        (line) =>
          line.event === "job.deferred" && line.code === "APPROVAL_MISSING",
      ),
    ).toBe(true);
    expect(await onchainStatus(expiring.mandateHash)).toBe("AUTHORIZED");

    // A stalled attempt: begun, then never performed before its window closes.
    const stalled = await signedMandate(
      "p4-smoke-stalled",
      "Swap 0.01 WBNB for CAKE",
    );
    await approveExecutor(stalled.mandate, BigInt(stalled.mandate.maxInput));
    await submits("p4-stalled-authorize", "AUTHORIZE");
    const begun = await submits("p4-stalled-begin", "BEGIN");
    await awaitFinality(begun.transactionHash);
    expect(await onchainStatus(stalled.mandateHash)).toBe("EXECUTING");

    await testClient.increaseTime({ seconds: 3_600 });
    await testClient.mine({ blocks: 1 });
    // The queue's retry clock is the database's; align it with the warped chain clock.
    await sql`
      update executions set next_retry_at = now() where mandate_hash = ${asBuffer(expiring.mandateHash)}
    `;

    // A continuous worker is killed without warning once a finalize is in flight, then restarted.
    const parked = [
      asBuffer(stalled.mandateHash),
      asBuffer(expiring.mandateHash),
    ];
    const first = executor.start("p4-loop-killed", "loop");
    let inflight = "";
    for (let attempt = 0; attempt < 480 && inflight === ""; attempt += 1) {
      // The stalled mandate's BEGIN is still pending until its first reconcile; only a finalize counts.
      const [row] = await sql<{ pending: string }[]>`
        select pending_transaction_kind::text as pending from executions
        where mandate_hash in ${sql(parked)} and pending_transaction_kind::text like 'FINALIZE_%'
      `;
      inflight = row?.pending ?? "";
      if (inflight === "") await delay(100); // Watches the durable queue for the persisted hash.
    }
    expect(inflight).toMatch(/^FINALIZE_/u);
    first.child.kill("SIGKILL");
    await first.exited;

    const restarted = executor.start("p4-loop-restarted", "loop");
    for (let attempt = 0; attempt < 480; attempt += 1) {
      const rows = await sql<{ status: string }[]>`
        select status from executions where mandate_hash in ${sql(parked)}
      `;
      if (rows.every((row) => row.status === "TERMINAL")) break;
      await delay(500); // Waits for finality on the fork; the worker owns progress.
    }
    restarted.child.kill("SIGTERM");
    await restarted.exited;

    const stalledRow = await execution(stalled.mandateHash);
    const expiredRow = await execution(expiring.mandateHash);
    expect(stalledRow).toMatchObject({
      mandate_status: "FAILED",
      status: "TERMINAL",
    });
    expect(expiredRow).toMatchObject({
      mandate_status: "EXPIRED",
      status: "TERMINAL",
    });
    expect(stalledRow.execute_user_operation_hash).toBeNull();
    expect(await lifecycle(stalled.mandateHash)).toEqual([
      "MandateAuthorized",
      "ExecutionBegun",
      "ExecutionReceiptRecorded",
    ]);
    expect(await lifecycle(expiring.mandateHash)).toEqual([
      "MandateAuthorized",
      "MandateExpired",
    ]);
    const killed = submitted({ code: null, lines: first.lines }).map(
      (line) => line.kind,
    );
    const resumed = submitted({ code: null, lines: restarted.lines }).map(
      (line) => line.kind,
    );
    expect([...killed, ...resumed].sort()).toEqual([
      "FINALIZE_EXPIRED",
      "FINALIZE_STALLED",
    ]);
    evidence.expiredAndStalled = {
      timeWarp:
        "evm_increaseTime 3600 s on the fork after both mandates were parked",
      stalled: {
        mandateHash: stalled.mandateHash,
        execution: printableRow(stalledRow),
        onchainEvents: await lifecycle(stalled.mandateHash),
      },
      expired: {
        mandateHash: expiring.mandateHash,
        execution: printableRow(expiredRow),
        onchainEvents: await lifecycle(expiring.mandateHash),
      },
      sigkill: {
        killedWhileInFlight: inflight,
        killedWorkerSubmissions: killed,
        restartedWorkerSubmissions: resumed,
        note: "the worker was SIGKILLed after persisting an in-flight finalize; the restarted worker reconciled it and sent no second finalize",
      },
    };
  });

  it("keeps the executor key out of every log line", async () => {
    expect(executorLog.length).toBeGreaterThan(0);
    for (const line of executorLog) {
      expect(() => JSON.parse(line), line).not.toThrow();
      expect(line.toLowerCase()).not.toContain(
        sessionKey.slice(2).toLowerCase(),
      );
      expect(line).not.toContain(workerToken);
    }
    evidence.logging = {
      lines: executorLog.length,
      check:
        "every executor stdout/stderr line is one JSON object and contains neither the executor key (with or without 0x) nor the worker token",
    };
    await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  });
});
