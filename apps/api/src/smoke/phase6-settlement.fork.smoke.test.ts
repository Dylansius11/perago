import type { ChildProcess } from "node:child_process";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import {
  type AccountPolicy,
  type Address,
  buildUserOperation,
  buildUserOperationNonceKey,
  deriveSemiModularAccountAddress,
  encodeAccountExecute,
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
  type SettlementDeployment,
  type TaskMandate,
  type TaskMandateDomain,
} from "@perago/sdk";
import postgres from "postgres";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAbiItem,
  type Hex,
  keccak256,
  type LocalAccount,
  type PublicClient,
  parseAbi,
  parseEther,
  parseEventLogs,
  stringToHex,
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
import { createViemPolicyChainVerifier } from "../services/policy-chain.js";
import {
  createExecutorProcesses,
  submitted,
  type WorkerRun,
} from "./executor-process.js";
import {
  ANVIL_KEY,
  CONTRACTS_DIR,
  forkTransport,
  requiredEnv,
  resetDatabase,
  startAnvil,
} from "./fork.js";

/**
 * P6-003 proof. Every state-changing call runs on a local Anvil fork of chain
 * 97. It uses the immutable production MandateExecutor, reviewed APEX proxies
 * and payment token, a locally deployed evaluator, real root UserOperations,
 * and the real API/executor process. No key or write reaches chain 97.
 */
const SMOKE = "Phase 6 settlement";
const RPC = requiredEnv("PERAGO_BSC_TESTNET_RPC", SMOKE);
const DATABASE_URL = requiredEnv("TEST_DATABASE_URL", SMOKE);
const OPENROUTER_KEY = requiredEnv("PERAGO_OPENROUTER_API_KEY", SMOKE);
const ANVIL = process.env.ANVIL_BIN || "anvil";
const FORGE = process.env.FORGE_BIN || "forge";
const PORT = 8551;
const FORK_URL = `http://127.0.0.1:${PORT}`;
const LEASE_SECONDS = 4;
const PAYMENT_SWAP_IN = parseEther("0.03");
const WBNB_FUNDING = parseEther("0.05");
const EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../../../docs/evidence/bsc-testnet.fork.phase6-settlement-smoke.json",
    import.meta.url,
  ),
);
const ENTRY_POINT = MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint;
const IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const kernelAbi = parseAbi([
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount, bytes optParams)",
  "function fund(uint256 jobId, uint256 expectedBudget, bytes optParams)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
  "function getJob(uint256 jobId) view returns ((uint256 id, address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, uint256 submittedAt, bytes32 deliverable))",
  "function jobCounter() view returns (uint256)",
]);
const evaluatorAbi = parseAbi([
  "function settle(uint256 jobId, bytes32 mandateHash)",
  "function settled(address commerceContract, uint256 jobId) view returns (bool)",
  "event CommerceJobSettled(address indexed commerceContract, uint256 indexed jobId, bytes32 indexed mandateHash)",
]);
const v2RouterAbi = parseAbi([
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])",
]);
const wbnbAbi = parseAbi(["function deposit() payable"]);
const PERFORM_SELECTOR = toFunctionSelector(
  getAbiItem({ abi: mandateExecutorAbi, name: "perform" }),
);

const catalog = loadBscTestnetCatalog();
const production = loadDeployment(
  catalog,
  "deployments/bsc-testnet.perago.json",
);
const protocol = JSON.parse(
  await readFile(
    new URL(
      "../../../../deployments/bsc-testnet.protocols.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  contracts: Record<
    string,
    {
      address: Address;
      codeHash: Hash;
      erc1967Implementation?: Address;
      implementationCodeHash?: Hash;
    }
  >;
};
const contract = (name: string) => {
  const found = protocol.contracts[name];
  if (!found) throw new Error(`protocol manifest has no ${name}`);
  return found;
};
const KERNEL = contract("apexKernel");
const PAYMENT = contract("apexPaymentToken");
const HOOK = contract("peragoAcpHook");
const WBNB = contract("wbnb").address;
const V2_ROUTER = contract("pancakeV2Router").address;

let anvil: ChildProcess | undefined;
let server: { close(): void } | undefined;
let sql: postgres.Sql;
let fork: PublicClient;
let deployment: PeragoDeployment;
let forkBlock: { number: bigint; hash: Hash };
let manifestPath = "";
let apiUrl = "";
let authorization = "";
let account: Address;
let providerAccount: Address;
let evaluator: Address;
let jobBudget: bigint;
const sessionEntityId = 1;
const rootOwner = privateKeyToAccount(generatePrivateKey());
const providerOwner = privateKeyToAccount(generatePrivateKey());
const executorKey = generatePrivateKey();
const executor = privateKeyToAccount(executorKey);
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
const workerLog: string[] = [];

const asBuffer = (value: Hex) => Buffer.from(value.slice(2), "hex");
const asHex = (value: Buffer | null) =>
  value ? (`0x${value.toString("hex")}` as Hex) : null;
const sameAddress = (left: Address, right: Address) =>
  left.toLowerCase() === right.toLowerCase();

async function awaitFinality(hash: Hash) {
  const receipt = await fork.waitForTransactionReceipt({ hash });
  while (
    (await fork.getBlock({ blockTag: "finalized" })).number <
    receipt.blockNumber
  ) {
    await delay(250);
  }
  return receipt;
}

/** A generated account's root-owner UserOperation, submitted by a separate local relayer. */
async function rootOperation(owner: LocalAccount, sender: Address, call: Hex) {
  const nonce = await fork.readContract({
    abi: entryPoint07Abi,
    address: ENTRY_POINT,
    args: [
      sender,
      buildUserOperationNonceKey({
        entityId: ROOT_OWNER_ENTITY_ID,
        isGlobalValidation: true,
      }),
    ],
    functionName: "getNonce",
  });
  const unsigned = buildUserOperation({ callData: call, nonce, sender });
  const actualHash = hashUserOperation(unsigned, 97);
  const signed = {
    ...unsigned,
    signature: packUserOperationSignature(
      await owner.signMessage({ message: { raw: actualHash } }),
    ),
  };
  const transactionHash = await wallet.sendTransaction({
    account: relayer,
    data: encodeHandleOps([signed], relayer.address),
    to: ENTRY_POINT,
  });
  const receipt = await fork.waitForTransactionReceipt({
    hash: transactionHash,
  });
  const [event] = parseEventLogs({
    abi: entryPoint07Abi,
    eventName: "UserOperationEvent",
    logs: receipt.logs,
  });
  expect(event?.args.userOpHash).toBe(actualHash);
  expect(event?.args.success).toBe(true);
  return { transactionHash, userOperationHash: actualHash };
}

const rootCall = (
  owner: LocalAccount,
  sender: Address,
  target: Address,
  data: Hex,
  value = 0n,
) =>
  rootOperation(owner, sender, encodeAccountExecute({ data, target, value }));

async function api<T extends object = Record<string, unknown>>(
  path: string,
  body: unknown,
  method = "POST",
) {
  const response = await fetch(new URL(path, apiUrl), {
    body: JSON.stringify(body),
    headers: { authorization, "content-type": "application/json" },
    method,
  });
  return {
    body: (await response.json()) as T,
    status: response.status,
  };
}

async function deployEvaluator(): Promise<{
  address: Address;
  transactionHash: Hash;
}> {
  const created = spawnSync(
    FORGE,
    [
      "create",
      "src/OutcomeEvaluator.sol:OutcomeEvaluator",
      "--rpc-url",
      FORK_URL,
      "--private-key",
      ANVIL_KEY,
      "--broadcast",
      "--json",
      "--constructor-args",
      production.mandateExecutor.address,
      KERNEL.address,
      providerAccount,
      HOOK.address,
      PAYMENT.address,
    ],
    {
      cwd: CONTRACTS_DIR,
      encoding: "utf8",
      env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" },
    },
  );
  if (created.status !== 0)
    throw new Error(`forge evaluator deploy failed: ${created.stderr}`);
  const result = JSON.parse(
    /\{[\s\S]*\}\s*$/u.exec(created.stdout)?.[0] ?? "{}",
  ) as {
    deployedTo: Address;
    transactionHash: Hash;
  };
  if (!result.deployedTo || !result.transactionHash)
    throw new Error("forge did not return evaluator deployment");
  await awaitFinality(result.transactionHash);
  return {
    address: result.deployedTo.toLowerCase() as Address,
    transactionHash: result.transactionHash,
  };
}

async function pinSettlement(
  evaluatorAddress: Address,
): Promise<SettlementDeployment> {
  const finalized = await fork.getBlock({ blockTag: "finalized" });
  const pinCode = async (
    name: string,
    expected: { address: Address; codeHash: Hash },
  ) => {
    const code = await fork.getCode({
      address: expected.address,
      blockNumber: finalized.number,
    });
    expect(keccak256(code ?? "0x"), `${name} code hash`).toBe(
      expected.codeHash,
    );
  };
  await Promise.all([
    pinCode("production MandateExecutor", production.mandateExecutor),
    pinCode("APEX kernel proxy", KERNEL),
    pinCode("APEX payment proxy", PAYMENT),
    pinCode("Perago hook", HOOK),
  ]);
  for (const [name, proxy] of [
    ["APEX kernel", KERNEL],
    ["APEX payment token", PAYMENT],
  ] as const) {
    if (!proxy.erc1967Implementation || !proxy.implementationCodeHash)
      throw new Error(`${name} proxy pin is incomplete`);
    const implementation = await fork.getStorageAt({
      address: proxy.address,
      slot: IMPLEMENTATION_SLOT,
      blockNumber: finalized.number,
    });
    expect(BigInt(implementation ?? "0x0"), `${name} implementation`).toBe(
      BigInt(proxy.erc1967Implementation),
    );
    const code = await fork.getCode({
      address: proxy.erc1967Implementation,
      blockNumber: finalized.number,
    });
    expect(keccak256(code ?? "0x"), `${name} implementation code`).toBe(
      proxy.implementationCodeHash,
    );
  }
  const evaluatorCode = await fork.getCode({
    address: evaluatorAddress,
    blockNumber: finalized.number,
  });
  if (!evaluatorCode)
    throw new Error("fork evaluator has no code at finalized block");
  return {
    commerce: {
      address: KERNEL.address,
      codeHash: KERNEL.codeHash,
      implementation: KERNEL.erc1967Implementation as Address,
      implementationCodeHash: KERNEL.implementationCodeHash as Hash,
    },
    evaluator: {
      address: evaluatorAddress,
      codeHash: keccak256(evaluatorCode),
    },
    hook: { address: HOOK.address, codeHash: HOOK.codeHash },
    paymentToken: {
      address: PAYMENT.address,
      codeHash: PAYMENT.codeHash,
      implementation: PAYMENT.erc1967Implementation as Address,
      implementationCodeHash: PAYMENT.implementationCodeHash as Hash,
    },
    provider: providerAccount,
  };
}

async function activatePolicy() {
  const challenge = await api<{ challengeId: string; message: string }>(
    "/auth/challenges",
    {
      account,
      chainId: "97",
      rootOwner: rootOwner.address,
    },
  );
  expect(challenge.status).toBe(201);
  const session = await api<{ token: string }>("/auth/sessions", {
    challengeId: challenge.body.challengeId,
    signature: await rootOwner.signMessage({ message: challenge.body.message }),
  });
  expect(session.status).toBe(201);
  authorization = `Bearer ${session.body.token}`;
  const policy = await api<{ policyId: string; policyHash: Hash }>(
    "/policies",
    {
      policy: {
        schemaVersion: "1",
        account,
        chainId: "97",
        version: "1",
        protectedAssets: [],
        activeAssets: [
          {
            token: WBNB,
            maxInputPerTask: parseEther("0.02").toString(),
            rollingDailyCap: parseEther("0.1").toString(),
          },
        ],
        services: ["SWAP"],
        approvedAdapterIds: ["pancakeswap-v3"],
        maxSlippageBps: "100",
        allowedRecipients: "SELF",
        maxTaskLifetimeSeconds: "3600",
      },
    },
  );
  expect(policy.status, JSON.stringify(policy.body)).toBe(201);
  const now = (await fork.getBlock()).timestamp;
  const validUntil = String(now + 7_200n);
  const performSelector = PERFORM_SELECTOR;
  const transition = {
    ownerEpoch: "1",
    permission: {
      account,
      entityId: sessionEntityId,
      nativeSpendLimit: "0",
      selectors: [performSelector],
      sessionSigner: executor.address,
      target: production.mandateExecutor.address,
      validAfter: String(now - 60n),
      validUntil,
    },
    validUntil,
  };
  const prepared = await api<{
    accountPolicy: AccountPolicy;
    allowances: { amount: string; token: Address }[];
    permissionCallData: Hex;
  }>(`/policies/${policy.body.policyId}/activation/prepare`, transition);
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
  const signature = await rootOwner.signTypedData(
    getAccountPolicyTypedData(prepared.body.accountPolicy, {
      chainId: "97",
      verifyingContract: production.mandateExecutor.address,
    }),
  );
  const activation = await rootOperation(
    rootOwner,
    account,
    encodeAccountPolicyTransition({
      account,
      allowances: prepared.body.allowances.map(
        (allowance: { amount: string; token: Address }) => ({
          amount: BigInt(allowance.amount),
          token: allowance.token,
        }),
      ),
      mandateExecutor: production.mandateExecutor.address,
      permissionCallData: prepared.body.permissionCallData,
      policy: prepared.body.accountPolicy,
      rootSignature: signature,
    }),
  );
  let confirmed = await api<{ status: string }>(
    `/policies/${policy.body.policyId}/activation`,
    {
      ...transition,
      rootSignature: signature,
      transactionHash: activation.transactionHash,
      userOperationHash: activation.userOperationHash,
    },
    "PUT",
  );
  for (
    let attempt = 0;
    attempt < 40 && confirmed.body.status === "PENDING";
    attempt += 1
  ) {
    await delay(500);
    confirmed = await api<{ status: string }>(
      `/policies/${policy.body.policyId}/activation`,
      {
        ...transition,
        rootSignature: signature,
        transactionHash: activation.transactionHash,
        userOperationHash: activation.userOperationHash,
      },
      "PUT",
    );
  }
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  evidence.policy = {
    activation,
    policyHash: policy.body.policyHash,
    session: transition.permission,
  };
}

async function createSubmittedJob(label: string) {
  const before = await fork.readContract({
    abi: kernelAbi,
    address: KERNEL.address,
    functionName: "jobCounter",
  });
  const expiresAt = (await fork.getBlock()).timestamp + 3_600n;
  const create = await rootCall(
    rootOwner,
    account,
    KERNEL.address,
    encodeFunctionData({
      abi: kernelAbi,
      args: [providerAccount, evaluator, expiresAt, label, HOOK.address],
      functionName: "createJob",
    }),
  );
  const after = await fork.readContract({
    abi: kernelAbi,
    address: KERNEL.address,
    functionName: "jobCounter",
  });
  let jobId: bigint | null = null;
  for (let candidate = after; candidate > before; candidate -= 1n) {
    const candidateJob = await fork.readContract({
      abi: kernelAbi,
      address: KERNEL.address,
      args: [candidate],
      functionName: "getJob",
    });
    if (
      sameAddress(candidateJob.client, account) &&
      candidateJob.description === label
    ) {
      jobId = candidate;
      break;
    }
  }
  if (jobId === null)
    throw new Error("created APEX job was not found by its onchain content");
  const setBudget = await rootCall(
    rootOwner,
    account,
    KERNEL.address,
    encodeFunctionData({
      abi: kernelAbi,
      args: [jobId, jobBudget, "0x"],
      functionName: "setBudget",
    }),
  );
  const approve = await rootCall(
    rootOwner,
    account,
    PAYMENT.address,
    encodeFunctionData({
      abi: erc20Abi,
      args: [KERNEL.address, jobBudget],
      functionName: "approve",
    }),
  );
  const fund = await rootCall(
    rootOwner,
    account,
    KERNEL.address,
    encodeFunctionData({
      abi: kernelAbi,
      args: [jobId, jobBudget, "0x"],
      functionName: "fund",
    }),
  );
  const submit = await rootCall(
    providerOwner,
    providerAccount,
    KERNEL.address,
    encodeFunctionData({
      abi: kernelAbi,
      args: [jobId, keccak256(stringToHex(`${label}: deliverable`)), "0x"],
      functionName: "submit",
    }),
  );
  const job = await fork.readContract({
    abi: kernelAbi,
    address: KERNEL.address,
    args: [jobId],
    functionName: "getJob",
  });
  expect(job.status).toBe(2);
  expect(
    await fork.readContract({
      abi: erc20Abi,
      address: PAYMENT.address,
      args: [account, KERNEL.address],
      functionName: "allowance",
    }),
  ).toBe(0n);
  return { jobId, operations: { approve, create, fund, setBudget, submit } };
}

async function queueBoundSwap(jobId: bigint, requestId: string) {
  const task = await api<{ taskId: string; decision: { outcome: string } }>(
    "/tasks",
    {
      clientRequestId: requestId,
      intent: {
        schemaVersion: "1",
        account,
        chainId: "97",
        recipient: account,
        goal: "Swap 0.01 WBNB for CAKE",
        requestedExpirySeconds: "1800",
      },
    },
  );
  expect(task.status, JSON.stringify(task.body)).toBe(200);
  expect(task.body.decision.outcome).toBe("PASS");
  const simulation = await api<{ status: string }>(
    `/tasks/${task.body.taskId}/simulations`,
    {
      commerceJobId: jobId.toString(),
    },
  );
  expect(simulation.status, JSON.stringify(simulation.body)).toBe(201);
  expect(simulation.body.status).toBe("PASSED");
  const prepared = await api<{
    mandate: TaskMandate;
    domain: TaskMandateDomain;
    mandateHash: Hash;
  }>(`/tasks/${task.body.taskId}/mandate/prepare`, {});
  expect(prepared.status, JSON.stringify(prepared.body)).toBe(200);
  expect(prepared.body.mandate.commerceContract.toLowerCase()).toBe(
    KERNEL.address.toLowerCase(),
  );
  expect(prepared.body.mandate.commerceJobId).toBe(jobId.toString());
  const signature = await rootOwner.signTypedData(
    getTaskMandateTypedData(prepared.body.mandate, prepared.body.domain),
  );
  const accepted = await api(`/tasks/${task.body.taskId}/mandate`, {
    signature,
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
  const approval = await rootCall(
    rootOwner,
    account,
    WBNB,
    encodeFunctionData({
      abi: erc20Abi,
      args: [
        production.mandateExecutor.address,
        BigInt(prepared.body.mandate.maxInput),
      ],
      functionName: "approve",
    }),
  );
  return {
    approval,
    mandate: prepared.body.mandate,
    mandateHash: prepared.body.mandateHash,
    taskId: task.body.taskId,
  };
}

const processes = (rpcUrl = FORK_URL) =>
  createExecutorProcesses({
    apiUrl,
    executorKey,
    log: workerLog,
    manifestPath,
    pollMs: 250,
    rpcUrl,
    workerToken,
  });

async function stage(name: string, kind: string): Promise<Hash> {
  const run: WorkerRun = await processes().step(name);
  const transactions = submitted(run);
  expect(
    transactions.map((item) => item.kind),
    run.lines.join("\n"),
  ).toEqual([kind]);
  const hash = transactions[0]?.transactionHash;
  if (!hash) throw new Error(`${name} did not log a transaction hash`);
  return hash;
}

async function executionRow(mandateHash: Hash) {
  const [row] = await sql<
    {
      mandate_status: string;
      settlement_tx_hash: Buffer | null;
      status: string;
    }[]
  >`
    select m.status as mandate_status, e.settlement_tx_hash, e.status
    from executions e join mandates m on m.mandate_hash = e.mandate_hash
    where e.mandate_hash = ${asBuffer(mandateHash)}
  `;
  if (!row) throw new Error(`no execution for ${mandateHash}`);
  return row;
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
  expect(await fork.getChainId()).toBe(97);
  const base = await fork.getBlock();
  forkBlock = { number: base.number, hash: base.hash };
  await testClient.setBalance({
    address: relayer.address,
    value: parseEther("100"),
  });
  account = deriveSemiModularAccountAddress({
    owner: rootOwner.address,
  }).toLowerCase() as Address;
  providerAccount = deriveSemiModularAccountAddress({
    owner: providerOwner.address,
  }).toLowerCase() as Address;
  for (const owner of [rootOwner, providerOwner]) {
    const hash = await wallet.sendTransaction({
      account: relayer,
      data: encodeSemiModularAccountFactoryData({ owner: owner.address }),
      to: MODULAR_ACCOUNT_V2_ADDRESSES.factory,
    });
    expect((await fork.waitForTransactionReceipt({ hash })).status).toBe(
      "success",
    );
  }
  await testClient.setBalance({ address: account, value: parseEther("5") });
  await testClient.setBalance({
    address: providerAccount,
    value: parseEther("1"),
  });
  await testClient.setBalance({
    address: executor.address,
    value: parseEther("5"),
  });
  const local = await deployEvaluator();
  evaluator = local.address;
  const settlement = await pinSettlement(evaluator);
  deployment = {
    ...production,
    label:
      "fork-bound-settlement: production executor/APEX pins on a local chain-97 fork",
    settlement,
  };
  manifestPath = join(
    await mkdtemp(join(tmpdir(), "perago-p6-")),
    "fork-bound.perago.json",
  );
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        chainId: 97,
        label: deployment.label,
        protocolManifest: "deployments/bsc-testnet.protocols.json",
        constructor: {
          executionWindowSeconds: production.executionWindowSeconds.toString(),
          allowUnboundCommerceJobs: false,
        },
        contracts: {
          mandateExecutor: production.mandateExecutor,
          swapAdapter: production.adapters.SWAP.adapter,
          swapVerifier: production.adapters.SWAP.verifier,
          stakeAdapter: production.adapters.STAKE.adapter,
          stakeVerifier: production.adapters.STAKE.verifier,
        },
        settlement: {
          evaluator: settlement.evaluator,
          provider: settlement.provider,
        },
      },
      null,
      2,
    )}\n`,
  );

  const swapQuote = await fork.readContract({
    abi: v2RouterAbi,
    address: V2_ROUTER,
    args: [PAYMENT_SWAP_IN, [WBNB, PAYMENT.address]],
    functionName: "getAmountsOut",
  });
  jobBudget = (swapQuote[1] as bigint) / 4n;
  expect(jobBudget).toBeGreaterThan(0n);
  const deadline = (await fork.getBlock()).timestamp + 600n;
  const paymentSwap = await rootCall(
    rootOwner,
    account,
    V2_ROUTER,
    encodeFunctionData({
      abi: v2RouterAbi,
      args: [
        ((swapQuote[1] as bigint) * 9n) / 10n,
        [WBNB, PAYMENT.address],
        account,
        deadline,
      ],
      functionName: "swapExactETHForTokens",
    }),
    PAYMENT_SWAP_IN,
  );
  const wrap = await rootCall(
    rootOwner,
    account,
    WBNB,
    encodeFunctionData({ abi: wbnbAbi, functionName: "deposit" }),
    WBNB_FUNDING,
  );
  expect(
    await fork.readContract({
      abi: erc20Abi,
      address: PAYMENT.address,
      args: [account],
      functionName: "balanceOf",
    }),
  ).toBeGreaterThanOrEqual(jobBudget * 2n);

  sql = postgres(DATABASE_URL, { max: 4, onnotice: () => {} });
  await resetDatabase(sql);
  await registerDeploymentAdapters(sql, {
    blockTag: "latest",
    client: fork,
    deployment,
  });
  const accountManifest = JSON.parse(
    await readFile(
      new URL(
        "../../../../deployments/bsc-testnet.account.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    contracts: Record<string, { address: Address; codeHash: Hash }>;
  };
  const implementation = accountManifest.contracts.semiModularAccountBytecode;
  if (!implementation)
    throw new Error("account manifest has no semi-modular implementation");
  const policyVerifier = createViemPolicyChainVerifier({
    client: fork,
    confirmationDepth: 3,
    entryPoint: ENTRY_POINT,
    expectedCodeHashes: {
      [ENTRY_POINT]: accountManifest.contracts.entryPoint?.codeHash as Hash,
      [implementation.address]: implementation.codeHash,
      [production.mandateExecutor.address]: production.mandateExecutor.codeHash,
    },
    implementation: implementation.address,
    mandateExecutor: production.mandateExecutor.address,
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
      mandateExecutor: production.mandateExecutor.address,
      now: () => new Date(),
      performSelector: PERFORM_SELECTOR,
      tokens: catalog.tokens.map((token) => token.address),
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
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
    started.resolve(info),
  );
  apiUrl = `http://127.0.0.1:${(await started.promise).port}/`;
  evidence.label =
    "fork evidence: all writes ran on a local Anvil fork of BNB Smart Chain Testnet (chain 97); the production MandateExecutor and reviewed APEX proxies were only forked, never written live";
  evidence.fork = {
    chainId: 97,
    sourceBlock: forkBlock.number.toString(),
    sourceBlockHash: forkBlock.hash,
    evaluator: {
      address: evaluator,
      deploymentTransaction: local.transactionHash,
      codeHash: settlement.evaluator.codeHash,
    },
    executor: production.mandateExecutor,
    paymentToken: settlement.paymentToken,
    apexKernel: settlement.commerce,
    provider: providerAccount,
    rootOwner: rootOwner.address,
    account,
    keys: "root owners, executor key, relayer, and worker token were generated for this run and never persisted",
    paymentAcquisition: {
      rootUserOperation: paymentSwap,
      route: "local fork V2 WBNB -> U swap",
      wrappedNative: wrap,
    },
  };
}, 300_000);

afterAll(async () => {
  server?.close();
  anvil?.kill();
  await sql?.end();
});

describe("Phase 6 settlement smoke on a chain-97 fork", {
  timeout: 900_000,
}, () => {
  it("keeps a successful mandate payment-pending during outage, then settles exactly once after restart", async () => {
    await activatePolicy();
    const job = await createSubmittedJob("P6 success settlement");
    const task = await queueBoundSwap(job.jobId, "p6-success");
    const authorize = await stage("p6-authorize", "AUTHORIZE");
    await awaitFinality(authorize);
    const begin = await stage("p6-begin", "BEGIN");
    await awaitFinality(begin);
    const perform = await stage("p6-perform", "PERFORM");
    await awaitFinality(perform);

    const providerBefore = await fork.readContract({
      abi: erc20Abi,
      address: PAYMENT.address,
      args: [providerAccount],
      functionName: "balanceOf",
    });
    const mismatchHash = keccak256(stringToHex("not the finalized mandate"));
    const mismatch = await wallet.sendTransaction({
      account: executor,
      data: encodeFunctionData({
        abi: evaluatorAbi,
        args: [job.jobId, mismatchHash],
        functionName: "settle",
      }),
      gas: 1_000_000n,
      to: evaluator,
    });
    expect(
      (await fork.waitForTransactionReceipt({ hash: mismatch })).status,
    ).toBe("reverted");
    expect(
      await fork.readContract({
        abi: erc20Abi,
        address: PAYMENT.address,
        args: [providerAccount],
        functionName: "balanceOf",
      }),
    ).toBe(providerBefore);

    const outage = processes("http://127.0.0.1:1").start(
      "p6-settlement-outage",
      "once",
    );
    const outageResult = await outage.exited;
    expect(outageResult.code).not.toBe(0);
    const pending = await fetch(
      new URL(`/receipts/${task.mandateHash}`, apiUrl),
    );
    expect(pending.status).toBe(200);
    expect((await pending.json()).settlement).toMatchObject({
      status: "PENDING",
      jobId: job.jobId.toString(),
    });
    expect((await executionRow(task.mandateHash)).mandate_status).toBe(
      "SUCCEEDED",
    );

    const settle = await stage("p6-settlement-restart", "SETTLE");
    await awaitFinality(settle);
    const finalized = await processes().step("p6-settlement-finalized");
    expect(submitted(finalized)).toEqual([]);
    const duplicateA = processes().start("p6-duplicate-a", "loop");
    const duplicateB = processes().start("p6-duplicate-b", "loop");
    await delay(2_000);
    duplicateA.child.kill("SIGTERM");
    duplicateB.child.kill("SIGTERM");
    const duplicateRuns = await Promise.all([
      duplicateA.exited,
      duplicateB.exited,
    ]);
    expect(
      duplicateRuns.flatMap(submitted).filter((line) => line.kind === "SETTLE"),
    ).toEqual([]);
    expect(
      await fork.readContract({
        abi: evaluatorAbi,
        address: evaluator,
        args: [KERNEL.address, job.jobId],
        functionName: "settled",
      }),
    ).toBe(true);
    expect(
      await fork.readContract({
        abi: erc20Abi,
        address: PAYMENT.address,
        args: [providerAccount],
        functionName: "balanceOf",
      }),
    ).toBe(providerBefore + jobBudget);
    const receipt = await fetch(
      new URL(`/receipts/${task.mandateHash}`, apiUrl),
    );
    expect(receipt.status).toBe(200);
    const publicReceipt = await receipt.json();
    expect(publicReceipt.settlement).toMatchObject({
      status: "CONFIRMED",
      jobId: job.jobId.toString(),
      paymentToken: PAYMENT.address.toLowerCase(),
      provider: providerAccount,
      transactionHash: settle,
      amount: jobBudget.toString(),
    });
    const row = await executionRow(task.mandateHash);
    expect(row.status).toBe("TERMINAL");
    expect(asHex(row.settlement_tx_hash)).toBe(settle);
    evidence.success = {
      job,
      task: { mandateHash: task.mandateHash, taskId: task.taskId },
      transactions: { authorize, begin, perform, mismatch, settlement: settle },
      outage: {
        workerExitCode: outageResult.code,
        receipt: "SUCCEEDED/PENDING before restart",
      },
      publicReceipt,
    };
  });

  it("withholds payment when the verifier cannot measure the recipient's output", async () => {
    const job = await createSubmittedJob("P6 verifier failure");
    const task = await queueBoundSwap(job.jobId, "p6-verifier-failure");
    const authorize = await stage("p6-verifier-authorize", "AUTHORIZE");
    await awaitFinality(authorize);
    const begin = await stage("p6-verifier-begin", "BEGIN");
    await awaitFinality(begin);
    const outputToken = task.mandate.outputToken;
    const originalCode = await fork.getCode({ address: outputToken });
    if (!originalCode)
      throw new Error("forked output token has no runtime code");
    const providerBefore = await fork.readContract({
      abi: erc20Abi,
      address: PAYMENT.address,
      args: [providerAccount],
      functionName: "balanceOf",
    });
    const clientBefore = await fork.readContract({
      abi: erc20Abi,
      address: PAYMENT.address,
      args: [account],
      functionName: "balanceOf",
    });
    let perform: Hash;
    try {
      // Fork-only fault injection: the pinned verifier's pre-state balanceOf reverts.
      await testClient.setCode({
        address: outputToken,
        bytecode: "0x60006000fd",
      });
      perform = await stage("p6-verifier-perform", "PERFORM");
      await awaitFinality(perform);
    } finally {
      await testClient.setCode({
        address: outputToken,
        bytecode: originalCode,
      });
    }
    const reject = await stage("p6-verifier-reject", "REJECT_JOB");
    await awaitFinality(reject);
    await processes().step("p6-verifier-finalize");
    expect((await executionRow(task.mandateHash)).mandate_status).toBe(
      "FAILED",
    );
    const chainJob = await fork.readContract({
      abi: kernelAbi,
      address: KERNEL.address,
      args: [job.jobId],
      functionName: "getJob",
    });
    expect(chainJob.status).toBe(4);
    expect(
      await fork.readContract({
        abi: erc20Abi,
        address: PAYMENT.address,
        args: [account],
        functionName: "balanceOf",
      }),
    ).toBe(clientBefore + jobBudget);
    expect(
      await fork.readContract({
        abi: erc20Abi,
        address: PAYMENT.address,
        args: [providerAccount],
        functionName: "balanceOf",
      }),
    ).toBe(providerBefore);
    const receipt = await fetch(
      new URL(`/receipts/${task.mandateHash}`, apiUrl),
    );
    expect(receipt.status).toBe(200);
    expect((await receipt.json()).settlement).toMatchObject({
      status: "INELIGIBLE",
      jobId: job.jobId.toString(),
    });
    evidence.verifierFailure = {
      label:
        "local fork fault injection of the output token's balanceOf; original code restored after execution",
      job,
      task: { mandateHash: task.mandateHash, taskId: task.taskId },
      transactions: { authorize, begin, perform, reject },
      providerPayout: "unchanged",
    };
  });

  it("records a real failed mandate, refunds its bound job, and never pays the provider", async () => {
    const job = await createSubmittedJob("P6 failed settlement");
    const task = await queueBoundSwap(job.jobId, "p6-failure");
    const authorize = await stage("p6-failure-authorize", "AUTHORIZE");
    await awaitFinality(authorize);
    const begin = await stage("p6-failure-begin", "BEGIN");
    await awaitFinality(begin);
    const wbnbBalance = await fork.readContract({
      abi: erc20Abi,
      address: WBNB,
      args: [account],
      functionName: "balanceOf",
    });
    expect(wbnbBalance).toBeGreaterThanOrEqual(BigInt(task.mandate.maxInput));
    const drain = await rootCall(
      rootOwner,
      account,
      WBNB,
      encodeFunctionData({
        abi: erc20Abi,
        args: [relayer.address, wbnbBalance],
        functionName: "transfer",
      }),
    );
    const providerBefore = await fork.readContract({
      abi: erc20Abi,
      address: PAYMENT.address,
      args: [providerAccount],
      functionName: "balanceOf",
    });
    const perform = await stage("p6-failure-perform", "PERFORM");
    await awaitFinality(perform);
    const reject = await stage("p6-failure-reject", "REJECT_JOB");
    await awaitFinality(reject);
    await processes().step("p6-failure-finalize");
    const chainJob = await fork.readContract({
      abi: kernelAbi,
      address: KERNEL.address,
      args: [job.jobId],
      functionName: "getJob",
    });
    expect(chainJob.status).toBe(4);
    expect(
      await fork.readContract({
        abi: erc20Abi,
        address: PAYMENT.address,
        args: [providerAccount],
        functionName: "balanceOf",
      }),
    ).toBe(providerBefore);
    const receipt = await fetch(
      new URL(`/receipts/${task.mandateHash}`, apiUrl),
    );
    expect(receipt.status).toBe(200);
    expect((await receipt.json()).settlement).toMatchObject({
      status: "INELIGIBLE",
      jobId: job.jobId.toString(),
    });
    expect((await executionRow(task.mandateHash)).mandate_status).toBe(
      "FAILED",
    );
    evidence.failure = {
      job,
      task: { mandateHash: task.mandateHash, taskId: task.taskId },
      transactions: { authorize, begin, drain, perform, reject },
      providerPayout:
        "unchanged; the kernel rejected and refunded the client escrow",
    };
  });

  it("writes labelled fork evidence without secrets", async () => {
    if (!evidence.success || !evidence.failure || !evidence.verifierFailure)
      throw new Error(
        "payout, verifier failure, and refund journeys must pass before writing evidence",
      );
    for (const line of workerLog) {
      expect(line).not.toContain(executorKey.slice(2));
      expect(line).not.toContain(workerToken);
    }
    evidence.logging = {
      lines: workerLog.length,
      check: "worker logs omit executor key and worker token",
    };
    await writeFile(
      EVIDENCE_PATH,
      `${JSON.stringify(evidence, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2)}\n`,
    );
  });
});
