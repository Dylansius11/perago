import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { Address, Hash } from "@perago/sdk";
import type { Sql } from "postgres";
import { createPublicClient, createTestClient, http, keccak256 } from "viem";

import type { PeragoDeployment } from "../deployment.js";

/**
 * Local-fork plumbing shared by the phase smokes. Every write goes to a local
 * anvil fork of BSC Testnet; nothing here can reach chain 97.
 */

export const MIGRATIONS = [
  "0000_constrained_lifecycle.sql",
  "0001_wallet_auth_policy_lifecycle.sql",
  "0002_task_compilation.sql",
  "0003_mandate_signing.sql",
  "0004_execution_worker.sql",
  "0005_chain_event_reorg_versions.sql",
  "0006_commerce_settlement.sql",
  "0007_faucet_claims.sql",
] as const;

/** Anvil's first well-known development key: public, funded only on the local fork. */
export const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const CONTRACTS_DIR = fileURLToPath(
  new URL("../../../../packages/contracts/", import.meta.url),
);

export function requiredEnv(name: string, smoke: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the ${smoke} smoke`);
  return value;
}

/** A fork fetches untouched state from chain 97 on first use, so a deep call can take a while. */
export const forkTransport = (url: string) => http(url, { timeout: 180_000 });

const DEPLOYMENTS_DIR = new URL("../../../../deployments/", import.meta.url);

/** Every address any committed deployment manifest names. */
function manifestAddresses(): Address[] {
  const found = new Set<Address>();
  for (const name of readdirSync(DEPLOYMENTS_DIR)) {
    if (!name.endsWith(".json")) continue;
    const text = readFileSync(new URL(name, DEPLOYMENTS_DIR), "utf8");
    for (const [match] of text.matchAll(/0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/gu)) {
      found.add(match.toLowerCase() as Address);
    }
  }
  return [...found];
}

/**
 * Starts anvil forking chain 97. `blockTime` switches from automine to
 * interval mining, and `slotsInAnEpoch: 1` makes anvil's `finalized` tag trail
 * `latest` by two blocks, the depth chain 97 itself shows (SC-D-005).
 *
 * Interval mining starts only after every manifest account has been fetched
 * from chain 97 one at a time. Anvil (1.8.0-nightly and 1.8.3) deadlocks when
 * a block is mined while several cold accounts are fetched from the fork
 * upstream in parallel: the whole RPC server stops answering, even
 * `eth_blockNumber`. See `docs/LESSONS.md` (2026-09-24).
 */
export async function startAnvil(input: {
  anvil: string;
  rpc: string;
  port: number;
  blockTime?: number;
  slotsInAnEpoch?: number;
}): Promise<ChildProcess> {
  const args = [
    "--fork-url",
    input.rpc,
    "--chain-id",
    "97",
    "--port",
    String(input.port),
    "--silent",
  ];
  if (input.slotsInAnEpoch !== undefined) {
    args.push("--slots-in-an-epoch", String(input.slotsInAnEpoch));
  }
  const anvil = spawn(input.anvil, args, { stdio: "ignore" });
  const transport = forkTransport(`http://127.0.0.1:${input.port}`);
  const probe = createPublicClient({ transport });
  let ready = false;
  for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
    try {
      await probe.getChainId();
      ready = true;
    } catch {
      // Polls an external process we just spawned; there is no event to await.
      await delay(500);
    }
  }
  if (!ready) {
    anvil.kill();
    throw new Error("the local fork did not start");
  }
  if (input.blockTime !== undefined) {
    for (const address of manifestAddresses()) {
      await probe.getCode({ address });
    }
    await createTestClient({ mode: "anvil", transport }).setIntervalMining({
      interval: input.blockTime,
    });
  }
  return anvil;
}

/**
 * Deploys a MandateExecutor over the production adapters that allows unbound
 * ERC-8183 jobs. The production executor requires a job, which cannot exist
 * before Phase 6, so every fork deployment is labelled `fork-unbound`.
 */
export async function deployUnboundExecutor(input: {
  forge: string;
  forkUrl: string;
  production: PeragoDeployment;
  executionWindowSeconds: bigint;
}): Promise<{ deployment: PeragoDeployment; transactionHash: Hash }> {
  const created = spawnSync(
    input.forge,
    [
      "create",
      "src/MandateExecutor.sol:MandateExecutor",
      "--rpc-url",
      input.forkUrl,
      "--private-key",
      ANVIL_KEY,
      "--broadcast",
      "--json",
      "--constructor-args",
      input.production.adapters.SWAP.adapter.address,
      input.production.adapters.STAKE.adapter.address,
      input.executionWindowSeconds.toString(),
      "true",
    ],
    {
      cwd: CONTRACTS_DIR,
      encoding: "utf8",
      env: { ...process.env, FOUNDRY_DISABLE_NIGHTLY_WARNING: "1" },
    },
  );
  if (created.status !== 0)
    throw new Error(`forge create failed: ${created.stderr}`);
  const { deployedTo, transactionHash } = JSON.parse(
    /\{[\s\S]*\}\s*$/u.exec(created.stdout)?.[0] ?? "{}",
  ) as { deployedTo: Address; transactionHash: Hash };
  const client = createPublicClient({
    transport: forkTransport(input.forkUrl),
  });
  const code = await client.getCode({ address: deployedTo });
  const block = await client.getBlockNumber();
  return {
    deployment: {
      ...input.production,
      label: `fork-unbound: local fork of chain 97 at block ${block}`,
      allowUnboundCommerceJobs: true,
      executionWindowSeconds: input.executionWindowSeconds,
      mandateExecutor: {
        address: deployedTo.toLowerCase() as Address,
        codeHash: keccak256(code ?? "0x"),
      },
    },
    transactionHash,
  };
}

/** Drops the schema and applies every migration in order. */
export async function resetDatabase(sql: Sql): Promise<void> {
  await sql.unsafe("drop schema public cascade; create schema public");
  for (const migration of MIGRATIONS) {
    await sql.unsafe(
      await readFile(
        new URL(`../../drizzle/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  }
}

/** The disposable deployer that holds testnet CAKE (`bsc-testnet.perago.json`). */
export async function manifestDeployer(): Promise<Address> {
  const manifest = JSON.parse(
    await readFile(
      new URL(
        "../../../../deployments/bsc-testnet.perago.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as { deployer: Address };
  return manifest.deployer;
}
