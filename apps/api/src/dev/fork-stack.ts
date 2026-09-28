import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createTestClient, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import { forkTransport, resetDatabase, startAnvil } from "../smoke/fork.js";

const API_URL = "http://127.0.0.1:8787";
const RPC_URL = "http://127.0.0.1:8545";
const EXECUTOR_DIR = fileURLToPath(
  new URL("../../../executor/", import.meta.url),
);
const MANIFEST = "deployments/bsc-testnet.demo.perago.json";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for dev:fork`);
  return value;
}

export function requireForkDatabase(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.search ||
    url.hash
  )
    throw new Error("dev:fork requires a local PostgreSQL server");
  if (url.pathname !== "/perago_dev")
    throw new Error("dev:fork requires the disposable perago_dev database");
  return databaseUrl;
}

function apiEnvironment(input: {
  databaseUrl: string;
  executorAddress: string;
  faucetKey: `0x${string}`;
  ipSalt: string;
  workerToken: string;
}): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !name.startsWith("PERAGO_") && !name.includes("DATABASE"),
    ),
  );
  return {
    ...inherited,
    PERAGO_API_PORT: "8787",
    PERAGO_BSC_TESTNET_RPC: RPC_URL,
    PERAGO_FAUCET_KEY: input.faucetKey,
    PERAGO_FAUCET_IP_SALT: input.ipSalt,
    PERAGO_API_RPC: RPC_URL,
    PERAGO_API_VENUE: "fork",
    PERAGO_DATABASE_URL: input.databaseUrl,
    PERAGO_DEPLOYMENT_MANIFEST: MANIFEST,
    PERAGO_EXECUTOR_ADDRESS: input.executorAddress,
    PERAGO_GEMINI_API_KEY: required("PERAGO_GEMINI_API_KEY"),
    PERAGO_INTENT_ENCRYPTION_KEY: required("PERAGO_INTENT_ENCRYPTION_KEY"),
    PERAGO_WEB_ORIGIN: process.env.PERAGO_WEB_ORIGIN ?? "http://localhost:3000",
    PERAGO_WORKER_TOKEN: input.workerToken,
  };
}

async function waitForApi(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${API_URL}/health`)).status === 200) return;
    } catch {
      // The child has not bound the local port yet.
    }
    await delay(250);
  }
  throw new Error("API did not become ready on port 8787");
}

async function main(): Promise<void> {
  const databaseUrl = requireForkDatabase(required("PERAGO_DEV_DATABASE_URL"));
  const executorKey = generatePrivateKey();
  const executor = privateKeyToAccount(executorKey);
  const faucetKey = generatePrivateKey();
  const faucet = privateKeyToAccount(faucetKey);
  const ipSalt = randomBytes(32).toString("hex");
  const workerToken = randomBytes(32).toString("base64url");
  const sql = postgres(databaseUrl, { onnotice: () => {} });
  const children: ChildProcess[] = [];
  let stopping = false;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
    await sql.end();
    process.exitCode = code;
  };
  try {
    const anvil = await startAnvil({
      anvil: process.env.ANVIL_BIN || "anvil",
      blockTime: 1,
      port: 8545,
      rpc: required("PERAGO_BSC_TESTNET_RPC"),
      slotsInAnEpoch: 1,
    });
    children.push(anvil);
    await resetDatabase(sql);
    const testClient = createTestClient({
      chain: bscTestnet,
      mode: "anvil",
      transport: forkTransport(RPC_URL),
    });
    await testClient.setBalance({
      address: executor.address,
      value: parseEther("0.05"),
    });
    await testClient.setBalance({
      address: faucet.address,
      value: parseEther("0.5"),
    });
    // Diverge before exposing the fork API: a live wallet must never share the probed head.
    await testClient.mine({ blocks: 1 });

    const api = spawn(process.env.BUN_BIN || "bun", ["src/main.ts"], {
      cwd: process.cwd(),
      env: apiEnvironment({
        databaseUrl,
        executorAddress: executor.address,
        workerToken,
        faucetKey,
        ipSalt,
      }),
      stdio: "ignore",
    });
    children.push(api);
    await waitForApi();
    const worker = spawn(process.execPath, ["src/main.ts"], {
      cwd: EXECUTOR_DIR,
      env: {
        PERAGO_API_URL: API_URL,
        PERAGO_DEPLOYMENT_MANIFEST: MANIFEST,
        PERAGO_EXECUTOR_DEFER_SECONDS: "2",
        PERAGO_EXECUTOR_KEY: executorKey,
        PERAGO_EXECUTOR_POLL_MS:
          process.env.PERAGO_FORK_WORKER_POLL_MS ?? "400",
        PERAGO_EXECUTOR_RPC: RPC_URL,
        PERAGO_WORKER_TOKEN: workerToken,
      },
      stdio: "ignore",
    });
    children.push(worker);
    const stopped = new Promise<void>((resolve) => {
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, resolve);
      }
    });
    console.log(
      JSON.stringify({
        event: "dev_fork.ready",
        apiUrl: API_URL,
        executorAddress: executor.address,
        rpcUrl: RPC_URL,
      }),
    );
    await stopped;
    await stop();
  } catch {
    await stop(1);
    console.error(JSON.stringify({ event: "dev_fork.startup_failed" }));
  }
}

if (import.meta.main) void main();
