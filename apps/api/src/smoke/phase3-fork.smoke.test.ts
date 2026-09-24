import type { ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  ADAPTER_EXECUTE_SELECTOR,
  type Address,
  CAKE_POOL_ID,
  deriveSemiModularAccountAddress,
  encodeSemiModularAccountFactoryData,
  encodeSetAccountPolicy,
  encodeStakeAction,
  encodeSwapAction,
  getAccountPolicyTypedData,
  getTaskMandateTypedData,
  type Hash,
  hashStakePostcondition,
  hashSwapPostcondition,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  mandateExecutorAbi,
  type SimulationResult,
  type TaskMandate,
  taskMandateFromSimulation,
} from "@perago/sdk";
import postgres from "postgres";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  type Hex,
  hashTypedData,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  parseEther,
  stringToHex,
  toFunctionSelector,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApiApp } from "../app.js";
import { loadBscTestnetCatalog } from "../compiler/catalog.js";
import { loadDeployment, type PeragoDeployment } from "../deployment.js";
import { createGroqPlanner } from "../planner/provider.js";
import {
  type MandateServiceConfig,
  registerDeploymentAdapters,
} from "../services/mandates.js";
import type { PolicyChainVerifier } from "../services/policies.js";
import { pinBlock } from "../simulation/context.js";
import { minimumAfterSlippage, quoteSwap } from "../simulation/swap.js";
import { runExactPath } from "../simulation/user-operation.js";
import {
  ANVIL_KEY,
  deployUnboundExecutor,
  manifestDeployer,
  requiredEnv,
  resetDatabase,
  startAnvil,
  forkTransport as transportFor,
} from "./fork.js";

/**
 * P3-004 and the Phase 3 smoke. Everything runs through the real HTTP app,
 * a real PostgreSQL database, and the real Groq planner, against a local fork
 * of BSC Testnet at the latest block: real PancakeSwap and CAKE Pool state,
 * the production adapters and verifiers, and a MandateExecutor deployed on the
 * fork over those adapters with unbound ERC-8183 jobs allowed - the production
 * executor requires a job, which cannot exist before Phase 6. The fork executor
 * is labelled as such everywhere it appears. Nothing is broadcast to chain 97;
 * the last case reads chain 97 itself to run the exact path against the
 * production executor.
 */

const required = (name: string) => requiredEnv(name, "Phase 3");
const RPC = required("PERAGO_BSC_TESTNET_RPC");
const DATABASE_URL = required("TEST_DATABASE_URL");
const GROQ_KEY = required("PERAGO_GROQ_API_KEY");
const ANVIL = process.env.ANVIL_BIN || "anvil";
const FORGE = process.env.FORGE_BIN || "forge";
const PORT = 8548;
const FORK_URL = `http://127.0.0.1:${PORT}`;
const forkTransport = () => transportFor(FORK_URL);
const QUOTE_TTL_SECONDS = 120;
const EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../../../docs/evidence/bsc-testnet.fork.phase3-smoke.json",
    import.meta.url,
  ),
);

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
const swapPoolFee = () => {
  const adapter = catalog.adapters.find((entry) => entry.kind === "SWAP");
  const route = adapter?.kind === "SWAP" ? adapter.routes[0] : undefined;
  if (!route) throw new Error("catalog has no swap route");
  return route.poolFee;
};
const CAKE = token("Cake");

const wbnbAbi = parseAbi(["function deposit() payable"]);
const routerAbi = parseAbi([
  "function factory() view returns (address)",
  "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
]);
const poolAbi = parseAbi([
  "function getPool(address,address,uint24) view returns (address)",
  "function slot0() view returns (uint160 sqrtPriceX96,int24,uint16,uint16,uint16,uint32,bool)",
]);
const performSelector = toFunctionSelector(
  getAbiItem({ abi: mandateExecutorAbi, name: "perform" }),
);

/** Smoke assertions read the API's JSON exactly as a client would. */
// biome-ignore lint/suspicious/noExplicitAny: untyped JSON response bodies
type ApiBody = Record<string, any>;

let anvil: ChildProcess | undefined;
let sql: postgres.Sql;
let fork: PublicClient;
let app: ReturnType<typeof createApiApp>;
let deployment: PeragoDeployment;
let authorization = "";
let account: Address;
let policyTransition: Record<string, unknown>;
let accountPolicy: Parameters<typeof getAccountPolicyTypedData>[0] & {
  policyHash: Hash;
};
const rootOwner = privateKeyToAccount(generatePrivateKey());
const session = privateKeyToAccount(generatePrivateKey());
const testClient = createTestClient({
  chain: bscTestnet,
  mode: "anvil",
  transport: forkTransport(),
});
const wallet = createWalletClient({
  chain: bscTestnet,
  transport: forkTransport(),
});
const funder = privateKeyToAccount(ANVIL_KEY);
const evidence: Record<string, unknown> = {};

/** Sends a transaction as `from` on the fork and waits for its receipt. */
async function sendAs(
  from: Address,
  request: { to: Address; data?: Hex; value?: bigint },
) {
  await testClient.impersonateAccount({ address: from });
  const hash = await wallet.sendTransaction({
    account: from,
    chain: bscTestnet,
    ...request,
  });
  const receipt = await fork.waitForTransactionReceipt({ hash });
  expect(receipt.status).toBe("success");
  return receipt;
}

async function setAccountPolicyOnFork(
  signer: ReturnType<typeof privateKeyToAccount>,
  policy: Parameters<typeof getAccountPolicyTypedData>[0],
) {
  const signature = await signer.signTypedData(
    getAccountPolicyTypedData(policy, {
      chainId: "97",
      verifyingContract: deployment.mandateExecutor.address,
    }),
  );
  const receipt = await sendAs(account, {
    to: deployment.mandateExecutor.address,
    data: encodeSetAccountPolicy(policy, signature),
  });
  return { receipt, signature };
}

async function api(path: string, body: unknown) {
  const response = await app.request(path, {
    body: JSON.stringify(body),
    headers: { authorization, "content-type": "application/json" },
    method: "POST",
  });
  return {
    body: (await response.json()) as ApiBody,
    status: response.status,
  };
}

async function compile(clientRequestId: string, goal: string) {
  const response = await api("/tasks", {
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
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  expect(response.body.status).toBe("READY_TO_SIMULATE");
  return response.body;
}

const simulate = (taskId: string) => api(`/tasks/${taskId}/simulations`, {});
const prepare = (taskId: string) => api(`/tasks/${taskId}/mandate/prepare`, {});
const submit = (taskId: string, signature: Hex) =>
  api(`/tasks/${taskId}/mandate`, { signature });

function signMandate(
  mandate: TaskMandate,
  domain: { chainId: string; verifyingContract: Address },
) {
  return rootOwner.signTypedData(getTaskMandateTypedData(mandate, domain));
}

function revertName(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (cause) => cause instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? "reverted";
    }
  }
  throw error;
}

/** Contract-level answer to `authorize` from the bound executor, never broadcast. */
async function authorizeCall(
  mandate: TaskMandate,
  signature: Hex,
  executor: Address,
) {
  const typed = getTaskMandateTypedData(
    { ...mandate, chainId: "97" },
    { chainId: "97", verifyingContract: deployment.mandateExecutor.address },
  );
  try {
    const { result } = await fork.simulateContract({
      abi: mandateExecutorAbi,
      account: executor,
      address: deployment.mandateExecutor.address,
      args: [{ ...typed.message, chainId: BigInt(mandate.chainId) }, signature],
      functionName: "authorize",
    });
    return { authorized: result };
  } catch (error) {
    return { rejected: revertName(error) };
  }
}

beforeAll(async () => {
  anvil = await startAnvil({ anvil: ANVIL, port: PORT, rpc: RPC });
  fork = createPublicClient({ chain: bscTestnet, transport: forkTransport() });
  const forkBlock = await fork.getBlock();

  // A MandateExecutor over the production adapters that allows unbound jobs.
  const created = await deployUnboundExecutor({
    executionWindowSeconds: 600n,
    forge: FORGE,
    forkUrl: FORK_URL,
    production,
  });
  deployment = created.deployment;
  const { transactionHash } = created;

  // The root owner's real Modular Account V2, deployed through the pinned factory.
  account = deriveSemiModularAccountAddress({
    owner: rootOwner.address,
  }).toLowerCase() as Address;
  const factoryHash = await wallet.sendTransaction({
    account: funder,
    chain: bscTestnet,
    data: encodeSemiModularAccountFactoryData({ owner: rootOwner.address }),
    to: MODULAR_ACCOUNT_V2_ADDRESSES.factory,
  });
  const factoryReceipt = await fork.waitForTransactionReceipt({
    hash: factoryHash,
  });
  expect(factoryReceipt.status).toBe("success");
  expect(await fork.getCode({ address: account })).toMatch(/^0x[0-9a-f]{10,}/u);
  await testClient.setBalance({ address: account, value: parseEther("1") });
  await sendAs(account, {
    to: WBNB,
    data: encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }),
    value: parseEther("0.2"),
  });
  await sendAs(await manifestDeployer(), {
    to: CAKE,
    data: encodeFunctionData({
      abi: erc20Abi,
      args: [account, parseEther("10")],
      functionName: "transfer",
    }),
  });

  sql = postgres(DATABASE_URL, { max: 2, onnotice: () => {} });
  await resetDatabase(sql);

  /** Reads the confirmed policy straight from the fork; there is no bundler here. */
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
  const mandateConfig: MandateServiceConfig = {
    blockTag: "latest",
    catalog,
    client: fork,
    deployment,
    now: () => new Date(),
    quoteTtlSeconds: QUOTE_TTL_SECONDS,
  };
  await registerDeploymentAdapters(sql, {
    blockTag: "latest",
    client: fork,
    deployment,
  });
  app = createApiApp({
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
      leaseSeconds: 30,
      workerTokenHash: createHash("sha256").update(randomBytes(32)).digest(),
    },
    mandateConfig,
    planner: createGroqPlanner({
      apiKey: GROQ_KEY,
      model: "openai/gpt-oss-120b",
      timeoutMs: 60_000,
    }),
    policyConfig: {
      mandateExecutor: deployment.mandateExecutor.address,
      now: () => new Date(),
      performSelector,
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

  evidence.label =
    "fork: every write below is on a local anvil fork of BSC Testnet (chain 97); nothing was broadcast to chain 97";
  evidence.fork = {
    chainId: 97,
    forkedAtBlock: forkBlock.number.toString(),
    forkedAtBlockHash: forkBlock.hash,
    mandateExecutor: deployment.mandateExecutor,
    mandateExecutorDeployTransaction: transactionHash,
    mandateExecutorConstructor: {
      swapAdapter: production.adapters.SWAP.adapter.address,
      stakeAdapter: production.adapters.STAKE.adapter.address,
      executionWindowSeconds: 600,
      allowUnboundCommerceJobs: true,
    },
    productionAdaptersAndVerifiers: "deployments/bsc-testnet.perago.json",
    account,
    rootOwner: rootOwner.address.toLowerCase(),
    executorSession: session.address.toLowerCase(),
    keys: "root owner and session keys were generated for this run and never persisted",
  };
}, 300_000);

afterAll(async () => {
  anvil?.kill();
  await sql?.end();
});

describe("Phase 3 smoke on a chain-97 fork", { timeout: 600_000 }, () => {
  it("activates a Wallet Policy registered in MandateExecutor", async () => {
    const challenge = await api("/auth/challenges", {
      account,
      chainId: "97",
      rootOwner: rootOwner.address,
    });
    expect(challenge.status).toBe(201);
    const signed = await rootOwner.signMessage({
      message: challenge.body.message,
    });
    const sessionResponse = await api("/auth/sessions", {
      challengeId: challenge.body.challengeId,
      signature: signed,
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
            rollingDailyCap: parseEther("0.08").toString(),
          },
          {
            token: CAKE,
            maxInputPerTask: parseEther("5").toString(),
            rollingDailyCap: parseEther("5").toString(),
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
    policyTransition = {
      ownerEpoch: "1",
      permission: {
        account,
        entityId: 1,
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
      policyTransition,
    );
    expect(prepared.status).toBe(200);
    accountPolicy = prepared.body.accountPolicy;
    const { receipt, signature } = await setAccountPolicyOnFork(
      rootOwner,
      accountPolicy,
    );

    const confirmed = await app.request(
      `/policies/${policy.body.policyId}/activation`,
      {
        body: JSON.stringify({
          ...policyTransition,
          rootSignature: signature,
          transactionHash: receipt.transactionHash,
          userOperationHash: keccak256(
            stringToHex(`fork-impersonation:${receipt.transactionHash}`),
          ),
        }),
        headers: { authorization, "content-type": "application/json" },
        method: "PUT",
      },
    );
    expect(confirmed.status).toBe(200);
    evidence.policy = {
      policyHash: policy.body.policyHash,
      accountPolicy: prepared.body.accountPolicy,
      setAccountPolicyTransaction: receipt.transactionHash,
      setAccountPolicyBlock: receipt.blockNumber.toString(),
      activation:
        "the impersonated account called setAccountPolicy on the fork, so MandateExecutor itself verified the root signature; the real ERC-4337 activation path is proven live in P3-002",
    };
  });

  let swapTaskId = "";
  let swapPrepared: ApiBody = {};

  it("compiles a natural-language swap, simulates the exact path, and prepares the digest", async () => {
    const task = await compile("p3-smoke-swap", "Swap 0.01 WBNB for CAKE");
    swapTaskId = task.taskId;
    expect(task.decision.outcome).toBe("PASS");

    const simulation = await simulate(swapTaskId);
    expect(simulation.status, JSON.stringify(simulation.body)).toBe(201);
    expect(simulation.body.status).toBe("PASSED");
    const result = simulation.body.result as SimulationResult;
    expect(result.contracts.mandateExecutor.address).toBe(
      deployment.mandateExecutor.address,
    );
    expect(
      BigInt(result.balances.outcome.expectedAfter) -
        BigInt(result.balances.outcome.before),
    ).toBeGreaterThanOrEqual(BigInt(result.minOutput));

    const prepared = await prepare(swapTaskId);
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
    swapPrepared = prepared.body;
    const rederived = taskMandateFromSimulation(
      prepared.body.simulation,
      prepared.body.simulationHash,
    );
    expect(rederived).toEqual(prepared.body.mandate);
    const sdkDigest = hashTypedData(
      getTaskMandateTypedData(rederived, prepared.body.domain),
    );
    const onchainDigest = await fork.readContract({
      abi: mandateExecutorAbi,
      address: deployment.mandateExecutor.address,
      args: [getTaskMandateTypedData(rederived, prepared.body.domain).message],
      functionName: "hashMandate",
    });
    expect(sdkDigest).toBe(prepared.body.mandateHash);
    expect(onchainDigest.toLowerCase()).toBe(sdkDigest);

    evidence.swap = {
      goal: "Swap 0.01 WBNB for CAKE",
      taskId: swapTaskId,
      planHash: task.planHash,
      decision: task.decision,
      simulationHash: simulation.body.simulationHash,
      simulation: result,
      mandate: prepared.body.mandate,
      digest: {
        api: prepared.body.mandateHash,
        sdk: sdkDigest,
        mandateExecutorHashMandate: onchainDigest,
      },
    };
  });

  it("rejects a signature over any mutated field, then accepts the exact digest once", async () => {
    const mandate = swapPrepared.mandate as TaskMandate;
    const domain = swapPrepared.domain as {
      chainId: string;
      verifyingContract: Address;
    };
    const other = "0x00000000000000000000000000000000000000a1" as Address;
    const bump = (value: string) => (BigInt(value) + 1n).toString();
    const flip = (value: Hash) => keccak256(value);
    const mutations: [
      keyof TaskMandate | "domain",
      TaskMandate,
      typeof domain,
    ][] = [
      ["account", { ...mandate, account: other }, domain],
      ["rootOwner", { ...mandate, rootOwner: other }, domain],
      [
        "ownerEpoch",
        { ...mandate, ownerEpoch: bump(mandate.ownerEpoch) },
        domain,
      ],
      ["executor", { ...mandate, executor: other }, domain],
      ["chainId", { ...mandate, chainId: "98" }, { ...domain, chainId: "98" }],
      ["nonce", { ...mandate, nonce: bump(mandate.nonce) }, domain],
      ["expiresAt", { ...mandate, expiresAt: bump(mandate.expiresAt) }, domain],
      [
        "policyHash",
        { ...mandate, policyHash: flip(mandate.policyHash) },
        domain,
      ],
      [
        "intentHash",
        { ...mandate, intentHash: flip(mandate.intentHash) },
        domain,
      ],
      ["planHash", { ...mandate, planHash: flip(mandate.planHash) }, domain],
      [
        "simulationHash",
        { ...mandate, simulationHash: flip(mandate.simulationHash) },
        domain,
      ],
      [
        "adapter",
        { ...mandate, adapter: production.adapters.STAKE.adapter.address },
        domain,
      ],
      [
        "adapterSelector",
        { ...mandate, adapterSelector: "0xdeadbeef" },
        domain,
      ],
      ["inputToken", { ...mandate, inputToken: CAKE }, domain],
      ["maxInput", { ...mandate, maxInput: bump(mandate.maxInput) }, domain],
      ["outputToken", { ...mandate, outputToken: WBNB }, domain],
      [
        "minOutput",
        { ...mandate, minOutput: (BigInt(mandate.minOutput) - 1n).toString() },
        domain,
      ],
      ["recipient", { ...mandate, recipient: other }, domain],
      [
        "actionHash",
        { ...mandate, actionHash: flip(mandate.actionHash) },
        domain,
      ],
      [
        "postconditionHash",
        { ...mandate, postconditionHash: flip(mandate.postconditionHash) },
        domain,
      ],
      ["commerceContract", { ...mandate, commerceContract: other }, domain],
      ["commerceJobId", { ...mandate, commerceJobId: "1" }, domain],
      [
        "domain",
        mandate,
        { ...domain, verifyingContract: production.mandateExecutor.address },
      ],
    ];
    const validSignature = await signMandate(mandate, domain);
    const rejections: Record<string, unknown>[] = [];
    for (const [field, mutated, mutatedDomain] of mutations) {
      const signature = await signMandate(mutated, mutatedDomain);
      const response = await submit(swapTaskId, signature);
      expect(response.status, field).toBe(409);
      expect(response.body.error.code, field).toBe("SIGNATURE_INVALID");
      // The contract, too, refuses the mutated mandate under the owner's real signature.
      const contract =
        field === "domain" || field === "chainId"
          ? await authorizeCall(mandate, signature, mandate.executor)
          : await authorizeCall(mutated, validSignature, mandate.executor);
      expect(contract.rejected, field).toBeTruthy();
      rejections.push({
        field,
        api: response.body.error.code,
        mandateExecutorAuthorize: contract.rejected,
      });
    }
    const stranger = privateKeyToAccount(generatePrivateKey());
    const strangerSignature = await stranger.signTypedData(
      getTaskMandateTypedData(mandate, domain),
    );
    const strangerResponse = await submit(swapTaskId, strangerSignature);
    expect(strangerResponse.body.error.code).toBe("SIGNATURE_INVALID");
    rejections.push({
      field: "signer",
      api: strangerResponse.body.error.code,
      mandateExecutorAuthorize: (
        await authorizeCall(mandate, strangerSignature, mandate.executor)
      ).rejected,
    });

    const accepted = await submit(swapTaskId, validSignature);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    expect(accepted.body).toMatchObject({
      mandateHash: swapPrepared.mandateHash,
      status: "SIGNED",
      executionStatus: "QUEUED",
    });
    const replay = await submit(swapTaskId, validSignature);
    expect(replay.body.mandateHash).toBe(swapPrepared.mandateHash);
    const [row] = await sql<
      { status: string; execution: string; typed_data: unknown }[]
    >`
      select m.status, e.status as execution, m.typed_data from mandates m
      join executions e on e.mandate_hash = m.mandate_hash
      where m.mandate_hash = ${Buffer.from(swapPrepared.mandateHash.slice(2), "hex")}
    `;
    expect(row).toMatchObject({ status: "SIGNED", execution: "QUEUED" });
    const authorized = await authorizeCall(
      mandate,
      validSignature,
      mandate.executor,
    );
    expect(authorized.authorized?.toLowerCase()).toBe(swapPrepared.mandateHash);
    evidence.signing = {
      rejections,
      accepted: accepted.body,
      idempotentReplay: replay.body,
      mandateExecutorAuthorizeCall: authorized.authorized,
      note: "authorize was evaluated with eth_call from the bound executor; P3-004 submits nothing onchain",
    };
  });

  it("carries a natural-language stake through simulation and signing", async () => {
    const task = await compile("p3-smoke-stake", "Stake 1 CAKE");
    const simulation = await simulate(task.taskId);
    expect(simulation.status, JSON.stringify(simulation.body)).toBe(201);
    expect(simulation.body.status).toBe("PASSED");
    const prepared = await prepare(task.taskId);
    expect(prepared.status).toBe(200);
    const signature = await signMandate(
      prepared.body.mandate,
      prepared.body.domain,
    );
    const accepted = await submit(task.taskId, signature);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    evidence.stake = {
      goal: "Stake 1 CAKE",
      taskId: task.taskId,
      decision: task.decision,
      simulationHash: simulation.body.simulationHash,
      simulation: simulation.body.result,
      mandateHash: accepted.body.mandateHash,
    };
  });

  let probeTaskId = "";

  it("re-runs the Wallet Policy at signing so the rolling daily cap holds", async () => {
    const first = await compile("p3-smoke-cap-a", "Swap 0.05 WBNB for CAKE");
    const second = await compile("p3-smoke-cap-b", "Swap 0.05 WBNB for CAKE");
    probeTaskId = (await compile("p3-smoke-stale", "Swap 0.01 WBNB for CAKE"))
      .taskId;
    const sign = async (taskId: string) => {
      expect((await simulate(taskId)).body.status).toBe("PASSED");
      const prepared = await prepare(taskId);
      return submit(
        taskId,
        await signMandate(prepared.body.mandate, prepared.body.domain),
      );
    };
    expect((await sign(first.taskId)).status).toBe(201);
    const overCap = await sign(second.taskId);
    expect(overCap.status).toBe(409);
    expect(overCap.body.error.code).toBe("DAILY_CAP_EXCEEDED");
    evidence.dailyCap = {
      policy: "WBNB 0.05 per task, 0.08 rolling daily cap",
      signedBefore: ["0.01 WBNB swap", "0.05 WBNB swap"],
      bothCompiledBeforeEitherSigned: true,
      rejectedAtSigning: overCap.body.error,
    };
  });

  it("invalidates signing on every stale fact", async () => {
    const stale: Record<string, unknown>[] = [];
    const record = (
      fact: string,
      response: { status: number; body: ApiBody },
    ) => {
      expect(response.status, fact).toBe(409);
      stale.push({
        fact,
        code: response.body.error.code,
        detail: response.body.error.detail,
      });
      return response.body.error.code as string;
    };
    const fresh = async () => {
      const simulation = await simulate(probeTaskId);
      expect(simulation.body.status, JSON.stringify(simulation.body)).toBe(
        "PASSED",
      );
      return simulation.body.result as SimulationResult;
    };

    await fresh();
    await testClient.increaseTime({ seconds: QUOTE_TTL_SECONDS + 1 });
    await testClient.mine({ blocks: 1 });
    expect(record("quote deadline passed", await prepare(probeTaskId))).toBe(
      "STALE_QUOTE",
    );
    const [task] = await sql<
      { status: string }[]
    >`select status from tasks where id = ${probeTaskId}`;
    expect(task?.status).toBe("READY_TO_SIMULATE");

    const snapshot = await testClient.snapshot();
    await testClient.mine({ blocks: 1 });
    await fresh();
    await testClient.revert({ id: snapshot });
    const parent = await fork.getBlock();
    await testClient.setNextBlockTimestamp({
      timestamp: parent.timestamp + 7n,
    });
    await testClient.mine({ blocks: 1 });
    expect(
      record("simulation block reorganized", await prepare(probeTaskId)),
    ).toBe("STALE_BLOCK");

    await fresh();
    await setAccountPolicyOnFork(rootOwner, {
      ...accountPolicy,
      policyHash: keccak256(stringToHex("another policy")),
    });
    expect(
      record("active policy changed onchain", await prepare(probeTaskId)),
    ).toBe("STALE_POLICY");
    await setAccountPolicyOnFork(rootOwner, accountPolicy);

    const nonceProbe = await fresh();
    await sendAs(account, {
      to: deployment.mandateExecutor.address,
      data: encodeFunctionData({
        abi: mandateExecutorAbi,
        args: [[BigInt(nonceProbe.mandate.nonce)]],
        functionName: "invalidateNonces",
      }),
    });
    expect(
      record("nonce invalidated by the account", await prepare(probeTaskId)),
    ).toBe("STALE_NONCE");

    await fresh();
    const router = production.adapters.SWAP.protocolTarget.address;
    const routerCode = await fork.getCode({ address: router });
    if (!routerCode) throw new Error("the pinned router has no code");
    await testClient.setCode({ address: router, bytecode: `${routerCode}00` });
    expect(record("protocol code changed", await prepare(probeTaskId))).toBe(
      "STALE_CODE",
    );
    await testClient.setCode({ address: router, bytecode: routerCode });

    await fresh();
    const prepared = await prepare(probeTaskId);
    expect(prepared.status).toBe(200);
    const whale = "0x00000000000000000000000000000000000fa1e5" as Address;
    await testClient.setBalance({ address: whale, value: parseEther("100") });
    await sendAs(whale, {
      to: WBNB,
      data: encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }),
      value: parseEther("50"),
    });
    await sendAs(whale, {
      to: WBNB,
      data: encodeFunctionData({
        abi: erc20Abi,
        args: [router, parseEther("50")],
        functionName: "approve",
      }),
    });
    // Without a price limit, 50 WBNB drains the thin testnet pool to the tick
    // bound, and the fork fetches every empty tick-bitmap word from chain 97.
    // A sqrt-price limit 10% away (a ~19% price move) is far beyond the signed
    // slippage and stops the swap after a handful of ticks.
    const fee = Number(swapPoolFee());
    const pool = await fork.readContract({
      address: await fork.readContract({
        address: await fork.readContract({
          abi: routerAbi,
          address: router,
          functionName: "factory",
        }),
        abi: poolAbi,
        args: [WBNB, CAKE, fee],
        functionName: "getPool",
      }),
      abi: poolAbi,
      functionName: "slot0",
    });
    const zeroForOne = WBNB.toLowerCase() < CAKE.toLowerCase();
    const sqrtPriceLimitX96 = zeroForOne
      ? (pool[0] * 9n) / 10n
      : (pool[0] * 10n) / 9n;
    await sendAs(whale, {
      to: router,
      data: encodeFunctionData({
        abi: routerAbi,
        args: [
          {
            tokenIn: WBNB,
            tokenOut: CAKE,
            fee,
            recipient: whale,
            deadline: (await fork.getBlock()).timestamp + 600n,
            amountIn: parseEther("50"),
            amountOutMinimum: 0n,
            sqrtPriceLimitX96,
          },
        ],
        functionName: "exactInputSingle",
      }),
    });
    const signature = await signMandate(
      prepared.body.mandate,
      prepared.body.domain,
    );
    expect(
      record(
        "price moved past the signed minimum",
        await submit(probeTaskId, signature),
      ),
    ).toBe("STALE_ACTION");

    await fresh();
    const newOwner = privateKeyToAccount(generatePrivateKey());
    await setAccountPolicyOnFork(newOwner, {
      ...accountPolicy,
      rootOwner: newOwner.address,
      ownerEpoch: "2",
    });
    const ownerChanged = record(
      "root owner changed onchain",
      await prepare(probeTaskId),
    );
    expect(ownerChanged).toBe("STALE_ACCOUNT");
    evidence.stale = stale;
  });

  it("runs the exact path on chain 97 itself against the production executor", async () => {
    const live = createPublicClient({
      chain: bscTestnet,
      transport: http(RPC),
    });
    const block = await pinBlock(live, "finalized");
    const holder = await manifestDeployer();
    const lower = holder.toLowerCase() as Address;
    const expiresAt = block.timestamp + 1_800n;
    const base = {
      account: lower,
      rootOwner: lower,
      ownerEpoch: "1",
      executor: session.address.toLowerCase() as Address,
      chainId: "97",
      nonce: "1",
      expiresAt: expiresAt.toString(),
      policyHash: keccak256(stringToHex("live-probe-policy")),
      intentHash: keccak256(stringToHex("live-probe-intent")),
      planHash: keccak256(stringToHex("live-probe-plan")),
      simulationHash: keccak256(stringToHex("live-probe-simulation")),
      adapterSelector: ADAPTER_EXECUTE_SELECTOR,
      recipient: lower,
      commerceContract: "0x0000000000000000000000000000000000000000" as Address,
      commerceJobId: "0",
    };
    const amount = parseEther("1").toString();

    const quote = await quoteSwap({
      blockNumber: block.number,
      client: live,
      plan: {
        kind: "SWAP",
        adapterId: "pancakeswap-v3",
        inputToken: CAKE,
        inputAmount: amount,
        outputToken: WBNB,
        poolFee: "500",
        maxSlippageBps: "100",
        recipient: lower,
      },
      quoter: production.quoter,
    });
    if (!("amountOut" in quote)) throw new Error(quote.failure);
    const minOut = minimumAfterSlippage(quote.amountOut, "100").toString();
    const swap = {
      tokenIn: CAKE,
      tokenOut: WBNB,
      poolFee: "500",
      amountIn: amount,
      minAmountOut: minOut,
      recipient: lower,
      deadline: expiresAt.toString(),
    };
    const swapOutcome = await runExactPath({
      action: encodeSwapAction(swap),
      block,
      client: live,
      executor: production.mandateExecutor.address,
      mandate: {
        ...base,
        adapter: production.adapters.SWAP.adapter.address,
        inputToken: CAKE,
        maxInput: amount,
        outputToken: WBNB,
        minOutput: minOut,
        actionHash: keccak256(encodeSwapAction(swap)),
        postconditionHash: hashSwapPostcondition(lower, WBNB, minOut),
      },
      verifier: production.adapters.SWAP.verifier.address,
    });

    const stake = {
      asset: CAKE,
      amount,
      minPositionOut: "1",
      recipient: lower,
      deadline: expiresAt.toString(),
      poolId: CAKE_POOL_ID,
    };
    const stakeOutcome = await runExactPath({
      action: encodeStakeAction(stake),
      block,
      client: live,
      executor: production.mandateExecutor.address,
      mandate: {
        ...base,
        adapter: production.adapters.STAKE.adapter.address,
        inputToken: CAKE,
        maxInput: amount,
        outputToken: CAKE,
        minOutput: "1",
        actionHash: keccak256(encodeStakeAction(stake)),
        postconditionHash: hashStakePostcondition(lower, CAKE_POOL_ID, "1"),
      },
      verifier: production.adapters.STAKE.verifier.address,
    });

    const printable = (outcome: typeof swapOutcome) =>
      outcome.kind === "OBSERVED"
        ? Object.fromEntries(
            Object.entries(outcome.observation).map(([key, value]) => [
              key,
              String(value),
            ]),
          )
        : outcome;
    for (const outcome of [swapOutcome, stakeOutcome]) {
      expect(outcome.kind, JSON.stringify(printable(outcome))).toBe("OBSERVED");
      if (outcome.kind === "OBSERVED") {
        expect(outcome.observation.status).toBe("SUCCEEDED");
        expect(outcome.observation.allowanceAfter).toBe(0n);
      }
    }
    evidence.chain97ExactPath = {
      label:
        "testnet, read-only eth_call on chain 97 with state overrides; nothing was broadcast",
      block: {
        number: block.number.toString(),
        hash: block.hash,
        timestamp: block.timestamp.toString(),
      },
      mandateExecutor: production.mandateExecutor.address,
      account: lower,
      accountNote:
        "the disposable deployer from bsc-testnet.perago.json, which holds testnet CAKE; its code is overridden only inside the call",
      swapCakeToWbnb: {
        quotedOut: quote.amountOut.toString(),
        minOut,
        observation: printable(swapOutcome),
      },
      stakeCake: { observation: printable(stakeOutcome) },
    };
    await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`);
  });
});
