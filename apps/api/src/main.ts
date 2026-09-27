import { readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import {
  addressSchema,
  hashSchema,
  MODULAR_ACCOUNT_V2_ADDRESSES,
  mandateExecutorAbi,
} from "@perago/sdk";
import postgres from "postgres";
import {
  createPublicClient,
  defineChain,
  getAbiItem,
  http,
  keccak256,
  type PublicClient,
  toFunctionSelector,
} from "viem";
import { bscTestnet } from "viem/chains";

import { createApiApp } from "./app.js";
import { loadBscTestnetCatalog } from "./compiler/catalog.js";
import { apiAuthDomain, loadApiConfig } from "./config.js";
import { loadDeployment } from "./deployment.js";
import { createGroqPlanner } from "./planner/provider.js";
import {
  assertFaucetChain,
  createViemFaucetTransport,
  faucetServiceConfig,
  loadFaucetConfig,
} from "./services/faucet.js";
import { registerDeploymentAdapters } from "./services/mandates.js";

import { createViemPolicyChainVerifier } from "./services/policy-chain.js";

type AccountManifest = {
  contracts: Record<string, { address: string; codeHash: string }>;
};

function accountDeployment(key: string) {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../../deployments/bsc-testnet.account.json", import.meta.url),
      "utf8",
    ),
  ) as AccountManifest;
  const entry = manifest.contracts[key];
  if (!entry) throw new Error(`account manifest has no pinned contract ${key}`);
  return {
    address: addressSchema.parse(entry.address),
    codeHash: hashSchema.parse(entry.codeHash),
  };
}

async function assertPinnedCode(
  client: PublicClient,
  input: { address: `0x${string}`; codeHash: `0x${string}` },
): Promise<void> {
  const code = await client.getCode({ address: input.address });
  if (!code || code === "0x" || keccak256(code) !== input.codeHash) {
    throw new Error(`pinned code mismatch at ${input.address}`);
  }
}

async function start(): Promise<void> {
  const catalog = loadBscTestnetCatalog();
  const deployment = loadDeployment(catalog, config.manifestPath);
  const chain = defineChain({
    ...bscTestnet,
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
  const client = createPublicClient({
    chain,
    transport: http(config.rpcUrl, { retryCount: 1, timeout: 30_000 }),
  });
  if ((await client.getChainId()) !== bscTestnet.id) {
    throw new Error("the configured RPC is not chain 97");
  }
  const faucetRuntime = process.env.PERAGO_FAUCET_KEY
    ? loadFaucetConfig()
    : null;
  const faucetTransport = faucetRuntime
    ? createViemFaucetTransport(faucetRuntime)
    : null;
  if (faucetRuntime) {
    await assertFaucetChain(() =>
      createPublicClient({
        transport: http(faucetRuntime.rpcUrl),
      }).getChainId(),
    );
  }

  const entryPoint = accountDeployment("entryPoint");
  const implementation = accountDeployment("semiModularAccountBytecode");
  await Promise.all([
    assertPinnedCode(client, entryPoint),
    assertPinnedCode(client, implementation),
    assertPinnedCode(client, deployment.mandateExecutor),
  ]);
  await registerDeploymentAdapters(sql, {
    blockTag: config.venue === "fork" ? "latest" : "finalized",
    client,
    deployment,
  });

  const performSelector = toFunctionSelector(
    getAbiItem({ abi: mandateExecutorAbi, name: "perform" }),
  );
  const app = createApiApp({
    authConfig: {
      challengeTtlMs: 300_000,
      domain: apiAuthDomain(config.authUri),
      now: () => new Date(),
      sessionTtlMs: 3_600_000,
      uri: config.authUri,
    },
    corsOrigin: config.webOrigin,
    ...(faucetRuntime && faucetTransport
      ? {
          faucet: {
            config: faucetServiceConfig(faucetRuntime, faucetTransport),
            trustProxy: faucetRuntime.trustProxy,
          },
        }
      : {}),
    executionConfig: {
      client,
      deployment,
      leaseSeconds: config.venue === "fork" ? 4 : 15,
      workerTokenHash: config.workerTokenHash,
    },
    mandateConfig: {
      blockTag: config.venue === "fork" ? "latest" : "finalized",
      catalog,
      client,
      deployment,
      now: () => new Date(),
      quoteTtlSeconds: 120,
    },
    planner: createGroqPlanner({
      apiKey: config.groqApiKey,
      model: "openai/gpt-oss-120b",
      timeoutMs: 60_000,
    }),
    policyConfig: {
      mandateExecutor: deployment.mandateExecutor.address,
      now: () => new Date(),
      performSelector,
    },
    policyVerifier: createViemPolicyChainVerifier({
      client,
      confirmationDepth: 3,
      entryPoint: MODULAR_ACCOUNT_V2_ADDRESSES.entryPoint,
      expectedCodeHashes: {
        [entryPoint.address]: entryPoint.codeHash,
        [implementation.address]: implementation.codeHash,
        [deployment.mandateExecutor.address]:
          deployment.mandateExecutor.codeHash,
      },
      implementation: implementation.address,
      mandateExecutor: deployment.mandateExecutor.address,
    }),
    publicConfig: {
      adapters: (["SWAP", "STAKE"] as const).map((kind) => ({
        adapter: deployment.adapters[kind].adapter.address,
        id: deployment.adapters[kind].id,
        kind,
        protocol: deployment.adapters[kind].protocol,
      })),
      chainId: "97",
      deploymentLabel: deployment.label,
      executionWindowSeconds: deployment.executionWindowSeconds.toString(),
      explorer:
        config.venue === "fork"
          ? null
          : {
              address: "https://testnet.bscscan.com/address/",
              transaction: "https://testnet.bscscan.com/tx/",
            },
      faucet: { enabled: faucetRuntime !== null },
      mandateExecutor: deployment.mandateExecutor.address,
      performSelector,
      quoteTtlSeconds: 120,
      sessionSigner: config.executorAddress,
      tokens: catalog.tokens,
      venue: config.venue,
    },
    sql,
    taskConfig: {
      catalog,
      compileLeaseSeconds: 120,
      intentKey: config.intentKey,
      now: () => new Date(),
    },
  });
  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: config.port,
  });
  const stop = () => {
    server.close();
    void sql.end();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log(
    JSON.stringify({
      event: "api.ready",
      port: config.port,
      venue: config.venue,
    }),
  );
}

const config = loadApiConfig();
const sql = postgres(config.databaseUrl, { onnotice: () => {} });

start().catch(() => {
  console.error(JSON.stringify({ event: "api.startup_failed" }));
  process.exitCode = 1;
  void sql.end();
});
