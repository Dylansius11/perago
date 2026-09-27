import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Address,
  type Hash,
  peragoDeploymentManifestSchema,
  resolveSettlementDeployment,
  type SettlementDeployment,
  workerIdSchema,
} from "@perago/sdk";
import type { Hex } from "viem";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DEFAULT_MANIFEST = "deployments/bsc-testnet.perago.json";

export type ExecutorDeployment = {
  chainId: number;
  label: string;
  mandateExecutor: Address;
  mandateExecutorCodeHash: Hash;
  executionWindowSeconds: bigint;
  allowUnboundCommerceJobs?: boolean;
  settlement?: SettlementDeployment | null;
};

export type ExecutorConfig = {
  apiUrl: URL;
  workerToken: string;
  /** The executor/session key. Held only in the deployment secret store. */
  executorKey: Hex;
  rpcUrl: string;
  deployment: ExecutorDeployment;
  workerId: string;
  pollIntervalMs: number;
  deferSeconds: number;
  healthPort: number | null;
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
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

/** Reads the one deployment manifest this worker executes against. */
export function loadDeployment(manifestPath: string): ExecutorDeployment {
  const path = isAbsolute(manifestPath)
    ? manifestPath
    : resolve(REPOSITORY_ROOT, manifestPath);
  const manifest = peragoDeploymentManifestSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  );
  return {
    chainId: manifest.chainId,
    label: manifest.label,
    mandateExecutor: manifest.contracts.mandateExecutor.address,
    mandateExecutorCodeHash: manifest.contracts.mandateExecutor.codeHash,
    executionWindowSeconds: BigInt(manifest.constructor.executionWindowSeconds),
    allowUnboundCommerceJobs: manifest.constructor.allowUnboundCommerceJobs,
    settlement: resolveSettlementDeployment(
      manifest,
      manifest.settlement
        ? JSON.parse(
            readFileSync(
              resolve(REPOSITORY_ROOT, manifest.protocolManifest),
              "utf8",
            ),
          )
        : null,
    ),
  };
}

/**
 * Worker configuration from the process environment. Secrets are validated
 * for shape only and never echoed; a malformed value names its variable.
 */
export function loadExecutorConfig(
  env: NodeJS.ProcessEnv = process.env,
): ExecutorConfig {
  const executorKey = required(env, "PERAGO_EXECUTOR_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/u.test(executorKey)) {
    throw new Error(
      "PERAGO_EXECUTOR_KEY must be a 0x-prefixed 32-byte hex key",
    );
  }
  const workerToken = required(env, "PERAGO_WORKER_TOKEN");
  if (workerToken.length < 32) {
    throw new Error("PERAGO_WORKER_TOKEN must be at least 32 characters");
  }
  const apiUrl = new URL(required(env, "PERAGO_API_URL"));
  const rpcUrl =
    env.PERAGO_EXECUTOR_RPC || required(env, "PERAGO_BSC_TESTNET_RPC");
  const healthPort = env.PERAGO_EXECUTOR_HEALTH_PORT
    ? positiveInteger(env, "PERAGO_EXECUTOR_HEALTH_PORT", 0)
    : null;

  return {
    apiUrl,
    workerToken,
    executorKey: executorKey.toLowerCase() as Hex,
    rpcUrl,
    deployment: loadDeployment(
      env.PERAGO_DEPLOYMENT_MANIFEST || DEFAULT_MANIFEST,
    ),
    workerId: workerIdSchema.parse(
      env.PERAGO_WORKER_ID ||
        `${hostname()
          .replace(/[^A-Za-z0-9._-]/gu, "-")
          .slice(0, 64)}:${process.pid}:${randomBytes(4).toString("hex")}`,
    ),
    pollIntervalMs: positiveInteger(env, "PERAGO_EXECUTOR_POLL_MS", 1_000),
    deferSeconds: positiveInteger(env, "PERAGO_EXECUTOR_DEFER_SECONDS", 15),
    healthPort,
  };
}
