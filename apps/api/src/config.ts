import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  addressSchema,
  peragoDeploymentManifestSchema,
} from "@perago/sdk";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MANIFEST = "deployments/bsc-testnet.demo.perago.json";
const DEFAULT_AUTH_URI = "http://127.0.0.1:8787";
const DEFAULT_WEB_ORIGIN = "http://localhost:3000";

export type ApiConfig = {
  authUri: string;
  /** Listen address. Loopback by default; a container sets `0.0.0.0`. */
  host: string;
  databaseUrl: string;
  executorAddress: Address;
  openRouterApiKey: string;
  intentKey: Buffer;
  manifestPath: string;
  port: number;
  rpcUrl: string;
  venue: "fork" | "testnet";
  /** Alchemy bundler sponsorship for root operations; null keeps the owner-paid path only. */
  sponsorship: { bundlerRpc: string; policyId: string } | null;
  webOrigin: string;
  workerTokenHash: Buffer;
};

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port`);
  }
  return value;
}

function validUrl(value: string, name: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
}

/** Both sponsorship values or neither: half a configuration is a deployment mistake. */
function sponsorship(env: NodeJS.ProcessEnv): ApiConfig["sponsorship"] {
  const bundlerRpc = env.PERAGO_ALCHEMY_BUNDLER_RPC || undefined;
  const policyId = env.PERAGO_ALCHEMY_GAS_MANAGER_POLICY_ID || undefined;
  if (!bundlerRpc && !policyId) return null;
  if (!bundlerRpc || !policyId) {
    throw new Error(
      "PERAGO_ALCHEMY_BUNDLER_RPC and PERAGO_ALCHEMY_GAS_MANAGER_POLICY_ID must be set together",
    );
  }
  return {
    bundlerRpc: validUrl(bundlerRpc, "PERAGO_ALCHEMY_BUNDLER_RPC"),
    policyId,
  };
}

function manifestPath(value: string): string {
  const path = isAbsolute(value) ? value : resolve(REPOSITORY_ROOT, value);
  const manifest = peragoDeploymentManifestSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  if (manifest.chainId !== 97) throw new Error("the API runs only on chain 97");
  return path;
}

/** Validates API runtime inputs without exposing secret values in errors. */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const intentKey = required(env, "PERAGO_INTENT_ENCRYPTION_KEY");
  if (!/^[0-9a-fA-F]{64}$/u.test(intentKey)) {
    throw new Error("PERAGO_INTENT_ENCRYPTION_KEY must be a 32-byte hex key");
  }
  const workerToken = required(env, "PERAGO_WORKER_TOKEN");
  if (workerToken.length < 32) {
    throw new Error("PERAGO_WORKER_TOKEN must be at least 32 characters");
  }
  const venue = env.PERAGO_API_VENUE ?? "testnet";
  if (venue !== "fork" && venue !== "testnet") {
    throw new Error("PERAGO_API_VENUE must be fork or testnet");
  }
  const authUri = validUrl(
    env.PERAGO_AUTH_URI ?? DEFAULT_AUTH_URI,
    "PERAGO_AUTH_URI",
  );
  const webOrigin = new URL(
    validUrl(env.PERAGO_WEB_ORIGIN ?? DEFAULT_WEB_ORIGIN, "PERAGO_WEB_ORIGIN"),
  ).origin;
  return {
    authUri,
    host: env.PERAGO_API_HOST || "127.0.0.1",
    databaseUrl: required(env, "PERAGO_DATABASE_URL"),
    executorAddress: addressSchema.parse(
      required(env, "PERAGO_EXECUTOR_ADDRESS"),
    ),
    openRouterApiKey: required(env, "PERAGO_OPENROUTER_API_KEY"),
    intentKey: Buffer.from(intentKey, "hex"),
    manifestPath: manifestPath(
      env.PERAGO_DEPLOYMENT_MANIFEST ?? DEFAULT_MANIFEST,
    ),
    port: positiveInteger(env, "PERAGO_API_PORT", 8787),
    rpcUrl: validUrl(
      env.PERAGO_API_RPC ?? required(env, "PERAGO_BSC_TESTNET_RPC"),
      "PERAGO_API_RPC",
    ),
    venue,
    sponsorship: sponsorship(env),
    webOrigin,
    workerTokenHash: createHash("sha256").update(workerToken, "utf8").digest(),
  };
}

export function apiAuthDomain(authUri: string): string {
  return new URL(authUri).host;
}
