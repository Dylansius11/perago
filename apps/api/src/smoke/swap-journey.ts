import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import {
  type Address,
  accountPolicySchema,
  buildUserOperation,
  buildUserOperationNonceKey,
  deriveSemiModularAccountAddress,
  encodeAccountExecute,
  encodeAccountPolicyTransition,
  encodeHandleOps,
  encodeSemiModularAccountFactoryData,
  encodeSimulatedAction,
  encodeSwapAction,
  executionProofSchema,
  getAccountPolicyTypedData,
  getExecutionProofTypedData,
  getTaskMandateTypedData,
  type Hash,
  hashSchema,
  hashUserOperation,
  MAX_SESSION_ENTITY_ID,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  mandateExecutorAbi,
  packUserOperationSignature,
  peragoAdapterAbi,
  policyDecisionSchema,
  ROOT_OWNER_ENTITY_ID,
  simulationResultSchema,
  type TaskMandate,
  taskMandateSchema,
  wrapExecuteUserOp,
} from "@perago/sdk";
import postgres from "postgres";
import {
  type Abi,
  BaseError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  type Hex,
  hashTypedData,
  http,
  keccak256,
  type Log,
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
import { z } from "zod";

import { createApiApp } from "../app.js";
import { loadBscTestnetCatalog } from "../compiler/catalog.js";
import { loadDeployment } from "../deployment.js";
import { createGroqPlanner } from "../planner/provider.js";
import { registerDeploymentAdapters } from "../services/mandates.js";
import { createViemPolicyChainVerifier } from "../services/policy-chain.js";
import {
  createExecutorProcesses,
  submitted,
  type WorkerRun,
} from "./executor-process.js";
import {
  forkTransport,
  requiredEnv,
  resetDatabase,
  startAnvil,
} from "./fork.js";

/**
 * P4-003 swap journey. One natural-language swap goes through the real API
 * (HTTP, PostgreSQL, Groq planner, real policy-chain verifier) and the real
 * executor process against the `testnet-demo` MandateExecutor (`SC-D-006`),
 * recording owner, account, policy, simulation, digest, authorization, begin,
 * the perform UserOperation and transaction, the output delta, the receipt,
 * and replay rejection. Excess spend, a lowered minimum, and a changed
 * recipient, adapter, selector, target, or action are refused at the policy,
 * signature, authorization, perform, and session layers.
 *
 * - `fork`: a local anvil fork of chain 97 with generated keys; nothing is
 *   broadcast to chain 97.
 * - `testnet`: live chain 97 with the disposable owner key and the executor
 *   key from `.env`; every transaction is public and explorer-linked.
 */

export type JourneyVenue = "fork" | "testnet";

const VENUES = {
  fork: {
    evidence: "bsc-testnet.fork.phase4-swap-journey.json",
    blockTag: "latest",
    leaseSeconds: 4,
    pollMs: 400,
    idleSeconds: 6,
  },
  testnet: {
    evidence: "bsc-testnet.phase4-swap-journey.json",
    blockTag: "finalized",
    leaseSeconds: 10,
    pollMs: 1_500,
    idleSeconds: 15,
  },
} as const;

const MANIFEST = "deployments/bsc-testnet.demo.perago.json";
const FORK_PORT = 8550;
const FORK_URL = `http://127.0.0.1:${FORK_PORT}`;
const SWAP_GOAL = "Swap 0.01 WBNB for CAKE";
const SWAP_INPUT = parseEther("0.01");
/** Gas float for the executor key on chain 97: three stage transactions at 0.1 gwei cost far less. */
const EXECUTOR_FLOAT = parseEther("0.005");
const ENTRY_POINT = MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint;
const OTHER = "0x00000000000000000000000000000000000000a1" as Address;
const ERROR_ABI = [...mandateExecutorAbi, ...entryPoint07Abi] as Abi;
const MANDATE_STATUS = [
  "NONE",
  "AUTHORIZED",
  "EXECUTING",
  "SUCCEEDED",
  "FAILED",
  "REVOKED",
  "EXPIRED",
];
const wbnbAbi = parseAbi(["function deposit() payable"]);

/** The API response fields this journey consumes, validated once at the HTTP boundary. */
const hexSchema = z.custom<Hex>(
  (value) => typeof value === "string" && /^0x[0-9a-fA-F]*$/u.test(value),
);
const errorBody = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const challengeBody = z.object({
  challengeId: z.string(),
  message: z.string(),
});
const sessionBody = z.object({ token: z.string() });
const policyBody = z.object({ policyId: z.string(), policyHash: hashSchema });
const activationBody = z.object({
  accountPolicy: accountPolicySchema,
  permissionCallData: hexSchema,
});
const confirmationBody = z.looseObject({ status: z.string() });
const taskBody = z.object({
  taskId: z.string(),
  planHash: hashSchema.nullable(),
  decision: policyDecisionSchema,
});
const simulationBody = z.object({
  status: z.string(),
  simulationHash: hashSchema,
  result: simulationResultSchema,
});
const preparedBody = z.object({
  mandate: taskMandateSchema,
  mandateHash: hashSchema,
});
const acceptedBody = z.object({
  mandateHash: hashSchema,
  status: z.string(),
  executionStatus: z.string(),
});

type ExecutionRow = {
  status: string;
  mandate_status: string;
  authorize_tx_hash: Buffer | null;
  begin_tx_hash: Buffer | null;
  execute_user_operation_hash: Buffer | null;
  execute_tx_hash: Buffer | null;
  submission_attempts: number;
};

const asBuffer = (value: Hex) => Buffer.from(value.slice(2), "hex");
const asHex = (value: Buffer | null) =>
  value ? (`0x${value.toString("hex")}` as Hash) : null;
const bump = (value: string) => (BigInt(value) + 1n).toString();
const lower = (value: string) => (BigInt(value) - 1n).toString();

function privateKey(name: string, smoke: string): Hex {
  const value = requiredEnv(name, smoke);
  if (!/^0x[0-9a-fA-F]{64}$/u.test(value)) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte hex key`);
  }
  return value as Hex;
}

function hasRevertData(value: unknown): value is { data: Hex } {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "string" &&
    value.data.startsWith("0x") &&
    value.data.length >= 10
  );
}

/** The decoded custom error of a refused call; EntryPoint refusals carry their AA reason. */
function revertOf(error: unknown): string {
  const carrier = error instanceof BaseError ? error.walk(hasRevertData) : null;
  if (!hasRevertData(carrier)) throw error;
  try {
    const decoded = decodeErrorResult({ abi: ERROR_ABI, data: carrier.data });
    return decoded.errorName.startsWith("FailedOp")
      ? `${decoded.errorName}(${String(decoded.args?.[1])})`
      : decoded.errorName;
  } catch {
    return `undecoded revert ${carrier.data.slice(0, 10)}`;
  }
}

async function refused(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return revertOf(error);
  }
  throw new Error(
    "the chain accepted a call this journey expects it to refuse",
  );
}

export function defineSwapJourney(venue: JourneyVenue): void {
  const settings = VENUES[venue];
  const SMOKE = `Phase 4 swap journey (${venue})`;
  const RPC = requiredEnv("PERAGO_BSC_TESTNET_RPC", SMOKE);
  const DATABASE_URL = requiredEnv("TEST_DATABASE_URL", SMOKE);
  const GROQ_KEY = requiredEnv("PERAGO_GROQ_API_KEY", SMOKE);
  const EVIDENCE_PATH = fileURLToPath(
    new URL(`../../../../docs/evidence/${settings.evidence}`, import.meta.url),
  );
  const live = venue === "testnet";
  const rpcUrl = live ? RPC : FORK_URL;
  const transport = live
    ? http(RPC, { retryCount: 5, timeout: 60_000 })
    : forkTransport(FORK_URL);

  const catalog = loadBscTestnetCatalog();
  const deployment = loadDeployment(catalog, MANIFEST);
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
  const EXECUTOR = deployment.mandateExecutor.address;
  const domain = { chainId: "97", verifyingContract: EXECUTOR };
  const performSelector = toFunctionSelector(
    getAbiItem({ abi: mandateExecutorAbi, name: "perform" }),
  );
  const adapterValidateSelector = toFunctionSelector(
    getAbiItem({ abi: peragoAdapterAbi, name: "validate" }),
  );

  const rootOwner = privateKeyToAccount(
    live
      ? privateKey("PERAGO_DISPOSABLE_OWNER_KEY", SMOKE)
      : generatePrivateKey(),
  );
  const executorKey = live
    ? privateKey("PERAGO_EXECUTOR_KEY", SMOKE)
    : generatePrivateKey();
  const executorAccount = privateKeyToAccount(executorKey);
  /** On the fork a generated relayer: chain 97 has an EIP-7702 delegation on the well-known dev key. */
  const relayer = live ? rootOwner : privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const workerToken = randomBytes(32).toString("base64url");
  const account = deriveSemiModularAccountAddress({
    owner: rootOwner.address,
  }).toLowerCase() as Address;
  const client: PublicClient = createPublicClient({
    chain: bscTestnet,
    transport,
  });
  const wallet = createWalletClient({ chain: bscTestnet, transport });
  const testClient = createTestClient({
    chain: bscTestnet,
    mode: "anvil",
    transport,
  });
  const explorer = (hash: Hash) =>
    live ? `https://testnet.bscscan.com/tx/${hash}` : null;

  const evidence: Record<string, unknown> = {};
  const executorLog: string[] = [];
  let anvil: ChildProcess | undefined;
  let server: ReturnType<typeof serve> | undefined;
  let sql: postgres.Sql;
  let executor: ReturnType<typeof createExecutorProcesses>;
  let apiUrl = "";
  let authorization = "";
  let sessionEntityId = 0;

  async function api<T>(
    schema: z.ZodType<T>,
    path: string,
    body: unknown,
    method = "POST",
  ) {
    const response = await fetch(new URL(path, apiUrl), {
      body: JSON.stringify(body),
      headers: { authorization, "content-type": "application/json" },
      method,
    });
    const json: unknown = await response.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new Error(
        `${method} ${path} answered ${response.status} with an unexpected body: ${JSON.stringify(json)}`,
      );
    }
    return { body: parsed.data, status: response.status };
  }

  async function send(request: { to: Address; data?: Hex; value?: bigint }) {
    const hash = await wallet.sendTransaction({ account: relayer, ...request });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status, hash).toBe("success");
    return hash;
  }

  const balanceOf = (asset: Address, owner: Address) =>
    client.readContract({
      abi: erc20Abi,
      address: asset,
      args: [owner],
      functionName: "balanceOf",
    });

  /** Waits until a transaction's block is at or below the chain's `finalized` tag. */
  async function awaitFinality(hash: Hash) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    while (
      (await client.getBlock({ blockTag: "finalized" })).number <
      receipt.blockNumber
    ) {
      await delay(500); // Finality has no subscription; chain 97 finalizes within about a second.
    }
    return receipt;
  }

  /** A root-owner UserOperation submitted to the EntryPoint by the relayer. */
  async function rootOperation(callData: Hex) {
    const nonce = await client.readContract({
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
    const transactionHash = await send({
      data: encodeHandleOps([signed], relayer.address),
      to: ENTRY_POINT,
    });
    const receipt = await client.getTransactionReceipt({
      hash: transactionHash,
    });
    const [event] = parseEventLogs({
      abi: entryPoint07Abi,
      eventName: "UserOperationEvent",
      logs: receipt.logs,
    });
    expect(event?.args.userOpHash).toBe(userOperationHash);
    expect(event?.args.success).toBe(true);
    return {
      transactionHash,
      userOperationHash,
      explorer: explorer(transactionHash),
    };
  }

  /** A session-signed UserOperation, evaluated by `eth_call` of `handleOps` and never broadcast. */
  async function sessionOperation(callData: Hex) {
    const nonce = await client.readContract({
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
    const unsigned = buildUserOperation({ callData, nonce, sender: account });
    const signature = packUserOperationSignature(
      await executorAccount.signMessage({
        message: { raw: hashUserOperation(unsigned, 97) },
      }),
    );
    return { ...unsigned, signature };
  }

  const handleOpsCall = (
    operation: Awaited<ReturnType<typeof sessionOperation>>,
  ) =>
    client.call({
      account: executorAccount.address,
      data: encodeHandleOps([operation], executorAccount.address),
      to: ENTRY_POINT,
    });

  const typedMandate = (mandate: TaskMandate) =>
    getTaskMandateTypedData(mandate, domain).message;

  const authorizeData = (mandate: TaskMandate, signature: Hex) =>
    encodeFunctionData({
      abi: mandateExecutorAbi,
      args: [typedMandate(mandate), signature],
      functionName: "authorize",
    });

  type Proof = {
    proof: ReturnType<typeof executionProofSchema.parse>;
    signature: Hex;
  };

  const performData = (mandate: TaskMandate, action: Hex, proof: Proof) =>
    encodeFunctionData({
      abi: mandateExecutorAbi,
      args: [
        typedMandate(mandate),
        action,
        { ...proof.proof, validUntil: Number(proof.proof.validUntil) },
        proof.signature,
      ],
      functionName: "perform",
    });

  const onchainRecord = (mandateHash: Hash) =>
    client.readContract({
      abi: mandateExecutorAbi,
      address: EXECUTOR,
      args: [mandateHash],
      functionName: "mandateRecord",
    });

  async function execution(mandateHash: Hash): Promise<ExecutionRow> {
    const [row] = await sql<ExecutionRow[]>`
      select e.status, m.status as mandate_status, e.authorize_tx_hash, e.begin_tx_hash,
        e.execute_user_operation_hash, e.execute_tx_hash, e.submission_attempts
      from executions e join mandates m on m.mandate_hash = e.mandate_hash
      where e.mandate_hash = ${asBuffer(mandateHash)}
    `;
    if (!row) throw new Error(`no execution for ${mandateHash}`);
    return row;
  }

  /** Runs one executor step that must submit exactly the given stage transaction. */
  async function stage(name: string, kind: string) {
    const run: WorkerRun = await executor.step(name);
    const lines = submitted(run);
    expect(
      lines.map((line) => line.kind),
      name,
    ).toEqual([kind]);
    const hash = lines[0]?.transactionHash;
    if (!hash) throw new Error(`${name} logged no transaction hash`);
    return hash;
  }

  beforeAll(async () => {
    if (!live) {
      anvil = await startAnvil({
        anvil: process.env.ANVIL_BIN || "anvil",
        blockTime: 1,
        port: FORK_PORT,
        rpc: RPC,
        slotsInAnEpoch: 1,
      });
    }
    const startBlock = await client.getBlock({ blockTag: "finalized" });
    expect(await client.getChainId()).toBe(97);
    const executorCode = await client.getCode({ address: EXECUTOR });
    expect(keccak256(executorCode ?? "0x")).toBe(
      deployment.mandateExecutor.codeHash,
    );
    const funding: Record<string, unknown> = {};

    if (live) {
      // The disposable owner's existing account; it only needs the swap input and executor gas.
      expect(await client.getCode({ address: account })).toMatch(
        /^0x[0-9a-f]{10,}/u,
      );
      const float = await client.getBalance({
        address: executorAccount.address,
      });
      if (float < EXECUTOR_FLOAT / 2n) {
        const hash = await send({
          to: executorAccount.address,
          value: EXECUTOR_FLOAT - float,
        });
        funding.executorGas = {
          transactionHash: hash,
          explorer: explorer(hash),
        };
      }
      const held = await balanceOf(WBNB, account);
      if (held < SWAP_INPUT) {
        const need = SWAP_INPUT - held;
        const wrap = await send({
          data: encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }),
          to: WBNB,
          value: need,
        });
        const transfer = await send({
          data: encodeFunctionData({
            abi: erc20Abi,
            args: [account, need],
            functionName: "transfer",
          }),
          to: WBNB,
        });
        funding.accountWbnb = {
          amount: need.toString(),
          wrap: { transactionHash: wrap, explorer: explorer(wrap) },
          transfer: { transactionHash: transfer, explorer: explorer(transfer) },
        };
      }
    } else {
      await testClient.setBalance({
        address: relayer.address,
        value: parseEther("100"),
      });
      await testClient.setBalance({
        address: executorAccount.address,
        value: parseEther("5"),
      });
      await send({
        data: encodeSemiModularAccountFactoryData({ owner: rootOwner.address }),
        to: MODULAR_ACCOUNT_V2_ADDRESSES.factory,
      });
      await testClient.setBalance({ address: account, value: parseEther("1") });
      await testClient.impersonateAccount({ address: account });
      await client.waitForTransactionReceipt({
        hash: await wallet.sendTransaction({
          account,
          data: encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }),
          to: WBNB,
          value: parseEther("0.05"),
        }),
      });
      await testClient.stopImpersonatingAccount({ address: account });
    }

    sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
    await resetDatabase(sql);
    await registerDeploymentAdapters(sql, {
      blockTag: settings.blockTag,
      client,
      deployment,
    });
    const accountManifest = JSON.parse(
      readFileSync(
        new URL(
          "../../../../deployments/bsc-testnet.account.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { contracts: Record<string, { address: Address; codeHash: Hash }> };
    const pinned = (key: string) => {
      const entry = accountManifest.contracts[key];
      if (!entry) throw new Error(`account manifest has no ${key}`);
      return entry;
    };
    const implementation = pinned("semiModularAccountBytecode");
    const policyVerifier = createViemPolicyChainVerifier({
      client,
      confirmationDepth: 3,
      entryPoint: ENTRY_POINT,
      expectedCodeHashes: {
        [ENTRY_POINT]: pinned("entryPoint").codeHash,
        [implementation.address]: implementation.codeHash,
        [EXECUTOR]: deployment.mandateExecutor.codeHash,
      },
      implementation: implementation.address,
      mandateExecutor: EXECUTOR,
    });
    const app = createApiApp({
      authConfig: {
        challengeTtlMs: 300_000,
        domain: "api.perago.test",
        now: () => new Date(),
        sessionTtlMs: 3_600_000,
        uri: "https://api.perago.test",
      },
      executionConfig: {
        client,
        deployment,
        leaseSeconds: settings.leaseSeconds,
        workerTokenHash: createHash("sha256").update(workerToken).digest(),
      },
      mandateConfig: {
        blockTag: settings.blockTag,
        catalog,
        client,
        deployment,
        now: () => new Date(),
        quoteTtlSeconds: 120,
      },
      planner: createGroqPlanner({
        apiKey: GROQ_KEY,
        model: "openai/gpt-oss-120b",
        timeoutMs: 60_000,
      }),
      policyConfig: {
        mandateExecutor: EXECUTOR,
        now: () => new Date(),
        performSelector,
      },
      policyVerifier,
      sql,
      taskConfig: {
        catalog,
        compileLeaseSeconds: 120,
        intentKey: randomBytes(32),
        now: () => new Date(),
      },
    });
    const started = Promise.withResolvers<AddressInfo>();
    server = serve(
      { fetch: app.fetch, hostname: "127.0.0.1", port: 0 },
      (info) => started.resolve(info),
    );
    apiUrl = `http://127.0.0.1:${(await started.promise).port}/`;
    executor = createExecutorProcesses({
      apiUrl,
      executorKey,
      log: executorLog,
      manifestPath: MANIFEST,
      pollMs: settings.pollMs,
      rpcUrl,
      workerToken,
    });

    evidence.label = live
      ? "testnet-demo: every transaction below is on BNB Smart Chain Testnet (chain 97) against the SC-D-006 testnet-demo MandateExecutor; it is not the production executor, and no ERC-8183 payment is involved (Phase 6)"
      : "fork: every write below is on a local anvil fork of chain 97 mining one block per second with finalized = latest - 2, against the forked testnet-demo MandateExecutor; nothing was broadcast to chain 97";
    evidence.venue = {
      chainId: 97,
      [live ? "startedAtFinalizedBlock" : "forkedAtFinalizedBlock"]:
        startBlock.number.toString(),
      blockHash: startBlock.hash,
      mandateExecutor: {
        ...deployment.mandateExecutor,
        label: deployment.label,
        manifest: MANIFEST,
        codeHashMatchedAtStart: true,
      },
      swapAdapter: deployment.adapters.SWAP.adapter,
      swapVerifier: deployment.adapters.SWAP.verifier,
      executionWindowSeconds: deployment.executionWindowSeconds.toString(),
      owner: rootOwner.address.toLowerCase(),
      account,
      executor: executorAccount.address.toLowerCase(),
      relayer: relayer.address.toLowerCase(),
      keys: live
        ? "owner and executor keys come from the operator's untracked .env; the worker token was generated for this run; no key is written anywhere"
        : "owner, executor, and relayer keys and the worker token were generated for this run and never persisted",
      executorProcess:
        "apps/executor/src/main.ts, spawned with only public variables and its PERAGO_* deployment variables",
      policyVerifier:
        "createViemPolicyChainVerifier: exact UserOperation calldata, AccountPolicySet event, pinned EntryPoint/account/MandateExecutor code, three-block depth",
      funding,
    };
  }, 600_000);

  afterAll(async () => {
    server?.close();
    anvil?.kill();
    await sql?.end();
  });

  describe(`Phase 4 swap journey on ${live ? "chain 97 (testnet-demo)" : "a chain-97 fork"}`, {
    timeout: 1_800_000,
  }, () => {
    let taskId = "";
    let mandate: TaskMandate;
    let mandateHash: Hash;
    let rootSignature: Hex;
    let action: Hex;
    let swapFields: Record<string, string>;
    let wbnbBefore = 0n;
    let cakeBefore = 0n;
    let executorNonceBefore = 0;
    const transactions: Record<string, Hash> = {};

    it("activates a Wallet Policy and installs a perform-only session with one root UserOperation", async () => {
      const challenge = await api(challengeBody, "/auth/challenges", {
        account,
        chainId: "97",
        rootOwner: rootOwner.address,
      });
      expect(challenge.status, JSON.stringify(challenge.body)).toBe(201);
      const session = await api(sessionBody, "/auth/sessions", {
        challengeId: challenge.body.challengeId,
        signature: await rootOwner.signMessage({
          message: challenge.body.message,
        }),
      });
      expect(session.status).toBe(201);
      authorization = `Bearer ${session.body.token}`;

      const policy = await api(policyBody, "/policies", {
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
      expect(policy.status, JSON.stringify(policy.body)).toBe(201);

      const chainNow = (await client.getBlock()).timestamp;
      // A fresh session entity per run, so a rerun never collides with an installed one.
      sessionEntityId = randomInt(1_000, MAX_SESSION_ENTITY_ID);
      const validUntil = String(chainNow + 6n * 3_600n);
      const transition = {
        ownerEpoch: "1",
        permission: {
          account,
          entityId: sessionEntityId,
          nativeSpendLimit: "0",
          selectors: [performSelector],
          sessionSigner: executorAccount.address,
          target: EXECUTOR,
          validAfter: String(chainNow - 60n),
          validUntil,
        },
        validUntil,
      };
      const prepared = await api(
        activationBody,
        `/policies/${policy.body.policyId}/activation/prepare`,
        transition,
      );
      expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
      const signature = await rootOwner.signTypedData(
        getAccountPolicyTypedData(prepared.body.accountPolicy, domain),
      );
      const activation = await rootOperation(
        encodeAccountPolicyTransition({
          account,
          mandateExecutor: EXECUTOR,
          permissionCallData: prepared.body.permissionCallData,
          policy: prepared.body.accountPolicy,
          rootSignature: signature,
        }),
      );
      const confirm = () =>
        api(
          confirmationBody,
          `/policies/${policy.body.policyId}/activation`,
          {
            ...transition,
            rootSignature: signature,
            transactionHash: activation.transactionHash,
            userOperationHash: activation.userOperationHash,
          },
          "PUT",
        );
      let confirmed = await confirm();
      for (
        let attempt = 0;
        attempt < 180 && confirmed.body.status === "PENDING";
        attempt += 1
      ) {
        await delay(1_000); // The verifier answers PENDING until the receipt is three blocks deep.
        confirmed = await confirm();
      }
      expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
      expect(confirmed.body.status).not.toBe("PENDING");
      const config = await client.readContract({
        abi: mandateExecutorAbi,
        address: EXECUTOR,
        args: [account],
        functionName: "accountConfig",
      });
      expect(config.activePolicyHash.toLowerCase()).toBe(
        prepared.body.accountPolicy.policyHash.toLowerCase(),
      );
      evidence.policy = {
        policyId: policy.body.policyId,
        policyHash: policy.body.policyHash,
        accountPolicy: prepared.body.accountPolicy,
        session: transition.permission,
        activation: {
          ...activation,
          note: "one root UserOperation installed the perform-only session and called MandateExecutor.setAccountPolicy; the API confirmed it through the real policy-chain verifier",
        },
        confirmed: confirmed.body,
      };
    });

    it("refuses excess spend and a foreign recipient in policy, before anything is signed", async () => {
      const excess = await api(taskBody, "/tasks", {
        clientRequestId: "p4-journey-excess",
        intent: {
          schemaVersion: "1",
          account,
          chainId: "97",
          recipient: account,
          goal: "Swap 1 WBNB for CAKE",
          requestedExpirySeconds: "1800",
        },
      });
      expect(excess.status, JSON.stringify(excess.body)).toBe(200);
      const failing = (body: z.infer<typeof taskBody>) =>
        body.decision.rules
          .filter((rule) => rule.outcome === "FAIL")
          .map((rule) => `${rule.rule}:${rule.reasonCode}`);
      expect(excess.body.decision.outcome).toBe("FAIL");
      expect(failing(excess.body).join()).toMatch(/PER_TASK_CAP/u);
      const excessSimulation = await api(
        errorBody,
        `/tasks/${excess.body.taskId}/simulations`,
        {},
      );
      expect(excessSimulation.status).not.toBe(201);

      const recipient = await api(taskBody, "/tasks", {
        clientRequestId: "p4-journey-recipient",
        intent: {
          schemaVersion: "1",
          account,
          chainId: "97",
          recipient: OTHER,
          goal: SWAP_GOAL,
          requestedExpirySeconds: "1800",
        },
      });
      expect(recipient.status, JSON.stringify(recipient.body)).toBe(200);
      expect(recipient.body.decision.outcome).toBe("FAIL");
      expect(failing(recipient.body).join()).toMatch(/RECIPIENT/u);
      const recipientSimulation = await api(
        errorBody,
        `/tasks/${recipient.body.taskId}/simulations`,
        {},
      );
      expect(recipientSimulation.status).not.toBe(201);

      evidence.policyRefusals = {
        excessSpend: {
          goal: "Swap 1 WBNB for CAKE",
          policyLimit: "WBNB 0.05 per task",
          failingRules: failing(excess.body),
          simulation: {
            status: excessSimulation.status,
            error: excessSimulation.body.error,
          },
        },
        foreignRecipient: {
          recipient: OTHER,
          failingRules: failing(recipient.body),
          simulation: {
            status: recipientSimulation.status,
            error: recipientSimulation.body.error,
          },
        },
      };
    });

    it("compiles, simulates, and prepares one swap digest the chain agrees with", async () => {
      const task = await api(taskBody, "/tasks", {
        clientRequestId: "p4-journey-swap",
        intent: {
          schemaVersion: "1",
          account,
          chainId: "97",
          recipient: account,
          goal: SWAP_GOAL,
          requestedExpirySeconds: "1800",
        },
      });
      expect(task.status, JSON.stringify(task.body)).toBe(200);
      expect(task.body.decision.outcome).toBe("PASS");
      taskId = task.body.taskId;
      const simulation = await api(
        simulationBody,
        `/tasks/${taskId}/simulations`,
        {},
      );
      expect(simulation.status, JSON.stringify(simulation.body)).toBe(201);
      expect(simulation.body.status).toBe("PASSED");
      const result = simulation.body.result;
      const prepared = await api(
        preparedBody,
        `/tasks/${taskId}/mandate/prepare`,
        {},
      );
      expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
      mandate = prepared.body.mandate;
      mandateHash = prepared.body.mandateHash;
      expect(BigInt(mandate.maxInput)).toBe(SWAP_INPUT);
      expect(mandate.recipient).toBe(account);
      expect(mandate.adapter).toBe(deployment.adapters.SWAP.adapter.address);

      action = encodeSimulatedAction(result);
      expect(keccak256(action)).toBe(mandate.actionHash);
      if (result.action.kind !== "SWAP") throw new Error("not a swap action");
      const { kind: _kind, ...fields } = result.action;
      swapFields = fields;

      const sdkDigest = hashTypedData(getTaskMandateTypedData(mandate, domain));
      const chainDigest = await client.readContract({
        abi: mandateExecutorAbi,
        address: EXECUTOR,
        args: [typedMandate(mandate)],
        functionName: "hashMandate",
      });
      expect(sdkDigest).toBe(mandateHash);
      expect(chainDigest.toLowerCase()).toBe(mandateHash);

      evidence.task = {
        goal: SWAP_GOAL,
        taskId,
        planHash: task.body.planHash,
        decision: task.body.decision,
      };
      evidence.simulation = {
        simulationHash: simulation.body.simulationHash,
        block: result.block,
        minOutput: result.minOutput,
        expectedOutput:
          BigInt(result.balances.outcome.expectedAfter) -
          BigInt(result.balances.outcome.before),
        action: result.action,
      };
      evidence.digest = {
        api: mandateHash,
        sdk: sdkDigest,
        mandateExecutorHashMandate: chainDigest.toLowerCase(),
        mandate,
      };
    });

    it("rejects a root signature over any tampered field, then queues the exact one", async () => {
      const mutations: [string, TaskMandate][] = [
        [
          "maxInput raised (excess spend)",
          { ...mandate, maxInput: bump(mandate.maxInput) },
        ],
        [
          "minOutput lowered",
          { ...mandate, minOutput: lower(mandate.minOutput) },
        ],
        ["recipient changed", { ...mandate, recipient: OTHER }],
        [
          "adapter changed to the pinned stake adapter",
          { ...mandate, adapter: deployment.adapters.STAKE.adapter.address },
        ],
        [
          "adapterSelector changed to validate",
          { ...mandate, adapterSelector: adapterValidateSelector },
        ],
        [
          "actionHash changed",
          { ...mandate, actionHash: keccak256(mandate.actionHash) },
        ],
      ];
      const refusals: Record<string, unknown>[] = [];
      for (const [field, mutated] of mutations) {
        const signature = await rootOwner.signTypedData(
          getTaskMandateTypedData(mutated, domain),
        );
        const response = await api(errorBody, `/tasks/${taskId}/mandate`, {
          signature,
        });
        expect(response.status, field).toBe(409);
        expect(response.body.error.code, field).toBe("SIGNATURE_INVALID");
        refusals.push({ field, api: response.body.error.code });
      }
      rootSignature = await rootOwner.signTypedData(
        getTaskMandateTypedData(mandate, domain),
      );
      const accepted = await api(acceptedBody, `/tasks/${taskId}/mandate`, {
        signature: rootSignature,
      });
      expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
      expect(accepted.body).toMatchObject({
        executionStatus: "QUEUED",
        mandateHash,
        status: "SIGNED",
      });
      evidence.signing = {
        tamperedSignatureRefusals: refusals,
        accepted: accepted.body,
        note: "each tampered mandate was signed by the real root owner; the API refuses any signature that does not recover over the exact prepared digest",
      };
    });

    it("refuses tampered mandates at MandateExecutor.authorize under the owner's real signature", async () => {
      const authorize = (
        candidate: TaskMandate,
        from: Address = executorAccount.address,
      ) =>
        client.call({
          account: from,
          data: authorizeData(candidate, rootSignature),
          to: EXECUTOR,
        });
      const control = await authorize(mandate);
      const authorized = decodeFunctionResult({
        abi: mandateExecutorAbi,
        data: control.data ?? "0x",
        functionName: "authorize",
      });
      expect(authorized.toLowerCase()).toBe(mandateHash);

      const cases: [string, TaskMandate, RegExp, Address?][] = [
        [
          "maxInput raised (excess spend)",
          { ...mandate, maxInput: bump(mandate.maxInput) },
          /^InvalidRootSignature$/u,
        ],
        [
          "minOutput lowered",
          { ...mandate, minOutput: lower(mandate.minOutput) },
          /^InvalidRootSignature$/u,
        ],
        [
          "recipient changed",
          { ...mandate, recipient: OTHER },
          /^InvalidRootSignature$/u,
        ],
        [
          "adapter changed to the pinned stake adapter",
          { ...mandate, adapter: deployment.adapters.STAKE.adapter.address },
          /^InvalidRootSignature$/u,
        ],
        [
          "adapter changed to the PancakeSwap router",
          {
            ...mandate,
            adapter: deployment.adapters.SWAP.protocolTarget.address,
          },
          /^UnsupportedAdapter$/u,
        ],
        [
          "adapterSelector changed to validate",
          { ...mandate, adapterSelector: adapterValidateSelector },
          /^WrongSelector$/u,
        ],
        [
          "actionHash changed",
          { ...mandate, actionHash: keccak256(mandate.actionHash) },
          /^InvalidRootSignature$/u,
        ],
        [
          "submitted by a non-executor",
          mandate,
          /^WrongExecutor$/u,
          stranger.address,
        ],
      ];
      const refusals: Record<string, string>[] = [];
      for (const [field, candidate, expected, from] of cases) {
        const reason = await refused(() => authorize(candidate, from));
        expect(reason, field).toMatch(expected);
        refusals.push({ field, refusal: reason });
      }
      evidence.authorizeRefusals = {
        control: `the exact mandate returns ${authorized.toLowerCase()} from eth_call`,
        refusals,
        note: "eth_call of MandateExecutor.authorize from the bound executor before the real authorization, never broadcast",
      };
    });

    it("authorizes and begins through the worker, then refuses every tampered perform and session call", async () => {
      await rootOperation(
        encodeAccountExecute({
          data: encodeFunctionData({
            abi: erc20Abi,
            args: [EXECUTOR, BigInt(mandate.maxInput)],
            functionName: "approve",
          }),
          target: WBNB,
          value: 0n,
        }),
      ).then((approval) => {
        evidence.rootApproval = approval;
      });
      wbnbBefore = await balanceOf(WBNB, account);
      cakeBefore = await balanceOf(CAKE, account);
      executorNonceBefore = await client.getTransactionCount({
        address: executorAccount.address,
      });

      transactions.authorize = await stage("journey-authorize", "AUTHORIZE");
      transactions.begin = await stage("journey-begin", "BEGIN");
      await awaitFinality(transactions.begin);
      const record = await onchainRecord(mandateHash);
      expect(MANDATE_STATUS[record.status]).toBe("EXECUTING");
      const allowance = await client.readContract({
        abi: erc20Abi,
        address: WBNB,
        args: [account, EXECUTOR],
        functionName: "allowance",
      });
      expect(allowance).toBe(BigInt(mandate.maxInput));

      const expiresAt = BigInt(mandate.expiresAt);
      const windowEnd =
        BigInt(record.executionStartedAt) + deployment.executionWindowSeconds;
      const proofFor = async (signer = executorAccount): Promise<Proof> => {
        const proof = executionProofSchema.parse({
          account,
          executor: executorAccount.address,
          mandateHash,
          validUntil: String(windowEnd < expiresAt ? windowEnd : expiresAt),
        });
        return {
          proof,
          signature: await signer.signTypedData(
            getExecutionProofTypedData(proof, domain),
          ),
        };
      };
      const proof = await proofFor();
      const perform = (candidate: TaskMandate, bytes: Hex, withProof = proof) =>
        client.call({
          account,
          data: performData(candidate, bytes, withProof),
          to: EXECUTOR,
        });
      const control = await perform(mandate, action);
      const outcome = decodeFunctionResult({
        abi: mandateExecutorAbi,
        data: control.data ?? "0x",
        functionName: "perform",
      });
      expect(MANDATE_STATUS[outcome]).toBe("SUCCEEDED");

      const swapAction = (changes: Record<string, string>) =>
        encodeSwapAction({ ...swapFields, ...changes });
      const cases: [string, () => Promise<unknown>, RegExp][] = [
        [
          "mandate maxInput raised (excess spend)",
          () =>
            perform({ ...mandate, maxInput: bump(mandate.maxInput) }, action),
          /^InvalidTransition$/u,
        ],
        [
          "mandate minOutput lowered",
          () =>
            perform(
              { ...mandate, minOutput: lower(mandate.minOutput) },
              action,
            ),
          /^InvalidTransition$/u,
        ],
        [
          "mandate recipient changed",
          () => perform({ ...mandate, recipient: OTHER }, action),
          /^InvalidTransition$/u,
        ],
        [
          "mandate adapter changed to the pinned stake adapter",
          () =>
            perform(
              {
                ...mandate,
                adapter: deployment.adapters.STAKE.adapter.address,
              },
              action,
            ),
          /^InvalidTransition$/u,
        ],
        [
          "action amountIn raised (excess spend)",
          () =>
            perform(
              mandate,
              swapAction({ amountIn: bump(swapFields.amountIn ?? "0") }),
            ),
          /^ActionHashMismatch$/u,
        ],
        [
          "action minAmountOut lowered",
          () =>
            perform(
              mandate,
              swapAction({
                minAmountOut: lower(swapFields.minAmountOut ?? "1"),
              }),
            ),
          /^ActionHashMismatch$/u,
        ],
        [
          "action recipient changed",
          () => perform(mandate, swapAction({ recipient: OTHER })),
          /^ActionHashMismatch$/u,
        ],
        [
          "action pool fee changed",
          () => perform(mandate, swapAction({ poolFee: "2500" })),
          /^ActionHashMismatch$/u,
        ],
        [
          "executor proof signed by another key",
          async () => perform(mandate, action, await proofFor(stranger)),
          /^InvalidExecutorProof$/u,
        ],
      ];
      const performRefusals: Record<string, string>[] = [];
      for (const [field, run, expected] of cases) {
        const reason = await refused(run);
        expect(reason, field).toMatch(expected);
        performRefusals.push({ field, refusal: reason });
      }

      const valid = await sessionOperation(
        wrapExecuteUserOp(
          encodeAccountExecute({
            data: performData(mandate, action, proof),
            target: EXECUTOR,
            value: 0n,
          }),
        ),
      );
      const sessionCases: [string, () => Promise<unknown>][] = [
        [
          "session calls MandateExecutor.revoke, a selector outside its allowlist",
          async () =>
            handleOpsCall(
              await sessionOperation(
                wrapExecuteUserOp(
                  encodeAccountExecute({
                    data: encodeFunctionData({
                      abi: mandateExecutorAbi,
                      args: [mandateHash],
                      functionName: "revoke",
                    }),
                    target: EXECUTOR,
                    value: 0n,
                  }),
                ),
              ),
            ),
        ],
        [
          "session calls perform on another MandateExecutor (the production instance)",
          async () =>
            handleOpsCall(
              await sessionOperation(
                wrapExecuteUserOp(
                  encodeAccountExecute({
                    data: performData(mandate, action, proof),
                    target: production.mandateExecutor.address,
                    value: 0n,
                  }),
                ),
              ),
            ),
        ],
        [
          "session calls WBNB.transfer instead of perform",
          async () =>
            handleOpsCall(
              await sessionOperation(
                wrapExecuteUserOp(
                  encodeAccountExecute({
                    data: encodeFunctionData({
                      abi: erc20Abi,
                      args: [executorAccount.address, BigInt(mandate.maxInput)],
                      functionName: "transfer",
                    }),
                    target: WBNB,
                    value: 0n,
                  }),
                ),
              ),
            ),
        ],
        [
          "signed perform UserOperation with its action bytes changed after signing",
          () =>
            handleOpsCall({
              ...valid,
              callData: wrapExecuteUserOp(
                encodeAccountExecute({
                  data: performData(
                    mandate,
                    swapAction({ recipient: OTHER }),
                    proof,
                  ),
                  target: EXECUTOR,
                  value: 0n,
                }),
              ),
            }),
        ],
      ];
      const sessionRefusals: Record<string, string>[] = [];
      for (const [field, run] of sessionCases) {
        const reason = await refused(run);
        expect(reason, field).toMatch(/^FailedOp/u);
        sessionRefusals.push({ field, refusal: reason });
      }

      evidence.execution = {
        authorize: {
          transactionHash: transactions.authorize,
          explorer: explorer(transactions.authorize),
        },
        begin: {
          transactionHash: transactions.begin,
          explorer: explorer(transactions.begin),
        },
        executionStartedAt: record.executionStartedAt.toString(),
        exactAllowanceBeforePerform: allowance.toString(),
      };
      evidence.performRefusals = {
        control: `the exact mandate, action, and proof return ${MANDATE_STATUS[outcome]} from eth_call`,
        refusals: performRefusals,
        note: "eth_call of MandateExecutor.perform from the smart account while the mandate was EXECUTING, never broadcast",
      };
      evidence.sessionRefusals = {
        refusals: sessionRefusals,
        note: "session-signed UserOperations evaluated with eth_call of EntryPoint.handleOps from the executor; each fails account validation before any call",
      };
    });

    it("performs through the worker and records a verified receipt with the measured output delta", async () => {
      transactions.perform = await stage("journey-perform", "PERFORM");
      const finish = await executor.step("journey-finish");
      expect(submitted(finish)).toEqual([]);

      const row = await execution(mandateHash);
      expect(row.status).toBe("TERMINAL");
      expect(row.mandate_status).toBe("SUCCEEDED");
      expect(row.submission_attempts).toBe(3);
      expect(asHex(row.authorize_tx_hash)).toBe(transactions.authorize);
      expect(asHex(row.begin_tx_hash)).toBe(transactions.begin);
      expect(asHex(row.execute_tx_hash)).toBe(transactions.perform);
      const record = await onchainRecord(mandateHash);
      expect(MANDATE_STATUS[record.status]).toBe("SUCCEEDED");

      const logs: Log[] = [];
      for (const hash of [
        transactions.authorize,
        transactions.begin,
        transactions.perform,
      ]) {
        const receipt = await client.getTransactionReceipt({
          hash: hash as Hash,
        });
        expect(receipt.status).toBe("success");
        logs.push(...receipt.logs);
      }
      const lifecycle = parseEventLogs({
        abi: mandateExecutorAbi,
        logs,
      }).filter(
        (log) =>
          log.address.toLowerCase() === EXECUTOR.toLowerCase() &&
          "mandateHash" in log.args &&
          log.args.mandateHash?.toLowerCase() === mandateHash,
      );
      expect(lifecycle.map((log) => log.eventName)).toEqual([
        "MandateAuthorized",
        "ExecutionBegun",
        "ExecutionReceiptRecorded",
      ]);
      const [userOperation] = parseEventLogs({
        abi: entryPoint07Abi,
        eventName: "UserOperationEvent",
        logs,
      });
      expect(userOperation?.args.userOpHash).toBe(
        asHex(row.execute_user_operation_hash),
      );
      expect(userOperation?.args.sender.toLowerCase()).toBe(account);
      expect(userOperation?.args.success).toBe(true);

      const wbnbAfter = await balanceOf(WBNB, account);
      const cakeAfter = await balanceOf(CAKE, account);
      const allowanceAfter = await client.readContract({
        abi: erc20Abi,
        address: WBNB,
        args: [account, EXECUTOR],
        functionName: "allowance",
      });
      expect(wbnbBefore - wbnbAfter).toBe(BigInt(mandate.maxInput));
      expect(cakeAfter - cakeBefore).toBeGreaterThanOrEqual(
        BigInt(mandate.minOutput),
      );
      expect(allowanceAfter).toBe(0n);
      expect(await balanceOf(WBNB, EXECUTOR)).toBe(0n);
      expect(await balanceOf(CAKE, EXECUTOR)).toBe(0n);

      const [receipt] = await sql<
        {
          status: string;
          verification_hash: Buffer;
          execution_tx_hash: Buffer;
          authority_consumed: boolean;
        }[]
      >`
        select status, verification_hash, execution_tx_hash, authority_consumed from execution_receipts
        where mandate_hash = ${asBuffer(mandateHash)}
      `;
      expect(receipt?.status).toBe("SUCCEEDED");
      expect(receipt?.authority_consumed).toBe(true);
      expect(asHex(receipt?.verification_hash ?? null)).toBe(
        record.verificationHash.toLowerCase(),
      );
      expect(asHex(receipt?.execution_tx_hash ?? null)).toBe(
        transactions.perform,
      );

      evidence.perform = {
        transactionHash: transactions.perform,
        explorer: explorer(transactions.perform as Hash),
        userOperationHash: asHex(row.execute_user_operation_hash),
        userOperationSuccess: userOperation?.args.success,
        onchainEvents: lifecycle.map((log) => log.eventName),
        executorTransactions:
          (await client.getTransactionCount({
            address: executorAccount.address,
          })) - executorNonceBefore,
      };
      evidence.outcome = {
        wbnbSpent: (wbnbBefore - wbnbAfter).toString(),
        maxInput: mandate.maxInput,
        cakeReceived: (cakeAfter - cakeBefore).toString(),
        minOutput: mandate.minOutput,
        allowanceAfter: allowanceAfter.toString(),
        mandateExecutorResidualWbnb: "0",
        mandateExecutorResidualCake: "0",
      };
      evidence.receipt = {
        status: receipt?.status,
        authorityConsumed: receipt?.authority_consumed,
        verificationHash: asHex(receipt?.verification_hash ?? null),
        onchainVerificationHash: record.verificationHash.toLowerCase(),
        execution: {
          status: row.status,
          mandateStatus: row.mandate_status,
          submissionAttempts: row.submission_attempts,
        },
      };
    });

    it("rejects every replay of the consumed mandate and never acts on a redelivery", async () => {
      const replays: Record<string, string>[] = [];
      for (const [kind, expected] of [
        ["authorize", /^NonceAlreadyUsed$/u],
        ["begin", /^InvalidTransition$/u],
        ["perform", /^FailedOp.*AA25/u],
      ] as const) {
        const hash = transactions[kind];
        if (!hash) throw new Error(`no ${kind} transaction was recorded`);
        const sent = await client.getTransaction({ hash });
        const reason = await refused(() =>
          client.call({
            account: sent.from,
            data: sent.input,
            to: sent.to ?? undefined,
          }),
        );
        expect(reason, kind).toMatch(expected);
        replays.push({
          replayed: `exact ${kind} transaction input`,
          transactionHash: hash,
          refusal: reason,
        });
      }
      const direct = await refused(async () => {
        const record = await onchainRecord(mandateHash);
        const proof = executionProofSchema.parse({
          account,
          executor: executorAccount.address,
          mandateHash,
          validUntil: String(
            BigInt(record.executionStartedAt) +
              deployment.executionWindowSeconds,
          ),
        });
        const signature = await executorAccount.signTypedData(
          getExecutionProofTypedData(proof, domain),
        );
        return client.call({
          account,
          data: performData(mandate, action, { proof, signature }),
          to: EXECUTOR,
        });
      });
      expect(direct).toMatch(/^InvalidTransition$/u);
      replays.push({
        replayed: "fresh perform call from the account with a new proof",
        refusal: direct,
      });

      const resubmitted = await api(acceptedBody, `/tasks/${taskId}/mandate`, {
        signature: rootSignature,
      });
      expect(resubmitted.body.mandateHash).toBe(mandateHash);
      const [count] = await sql<{ executions: number }[]>`
        select count(*)::int as executions from executions where mandate_hash = ${asBuffer(mandateHash)}
      `;
      expect(count?.executions).toBe(1);
      const nonceBefore = await client.getTransactionCount({
        address: executorAccount.address,
      });
      const idle = executor.start("journey-redelivery", "loop");
      await delay(settings.idleSeconds * 1_000); // Gives a live worker several lease polls against a finished queue.
      idle.child.kill("SIGTERM");
      await idle.exited;
      expect(idle.lines.some((line) => line.includes('"job.leased"'))).toBe(
        false,
      );
      expect(
        await client.getTransactionCount({ address: executorAccount.address }),
      ).toBe(nonceBefore);

      evidence.replay = {
        refusals: replays,
        apiResubmission: {
          status: resubmitted.status,
          mandateHash: resubmitted.body.mandateHash,
          executionsForMandate: count?.executions,
        },
        redelivery: `a live loop worker found nothing to lease for ${settings.idleSeconds} s; the executor nonce did not move`,
      };
    });

    it("keeps the executor key and worker token out of every log line", async () => {
      expect(executorLog.length).toBeGreaterThan(0);
      for (const line of executorLog) {
        expect(() => JSON.parse(line), line).not.toThrow();
        expect(line.toLowerCase()).not.toContain(
          executorKey.slice(2).toLowerCase(),
        );
        expect(line).not.toContain(workerToken);
      }
      evidence.logging = {
        lines: executorLog.length,
        check:
          "every executor stdout/stderr line is one JSON object and contains neither the executor key (with or without 0x) nor the worker token",
      };
      evidence.observedAt = new Date().toISOString();
      await writeFile(
        EVIDENCE_PATH,
        `${JSON.stringify(evidence, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
      );
    });
  });
}
