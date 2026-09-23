import {
  type Address,
  type Hash,
  mandateExecutorAbi,
  peragoAdapterAbi,
  peragoVerifierAbi,
} from "@perago/sdk";
import { getAddress, keccak256, type PublicClient, slice } from "viem";

import type { AdapterDeployment, PeragoDeployment } from "../deployment.js";

/** ERC-1967 implementation slot: an account upgrade changes it, not the proxy code. */
const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

export type SimulationBlockTag = "finalized" | "latest";

export type PinnedBlock = { number: bigint; hash: Hash; timestamp: bigint };

/**
 * Every chain fact a simulation commits to and freshness later re-reads, all
 * taken at one pinned block.
 */
export type ChainSnapshot = {
  block: PinnedBlock;
  codeHashes: {
    account: Hash;
    adapter: Hash;
    mandateExecutor: Hash;
    protocolTarget: Hash;
    verifier: Hash;
  };
  accountImplementation: Address;
  accountConfig: {
    activePolicyHash: Hash;
    ownerEpoch: string;
    permissionHash: Hash;
    rootOwner: Address;
  };
  allowUnboundCommerceJobs: boolean;
};

const lower = (value: string) => value.toLowerCase() as `0x${string}`;

export async function pinBlock(
  client: PublicClient,
  tag: SimulationBlockTag,
): Promise<PinnedBlock> {
  const block = await client.getBlock({ blockTag: tag });
  if (block.number === null || block.hash === null) {
    throw new Error(`the ${tag} block is not sealed`);
  }
  return {
    number: block.number,
    hash: lower(block.hash),
    timestamp: block.timestamp,
  };
}

/** The canonical hash at `number` now, or null when the chain has not reached it. */
export async function canonicalHashAt(
  client: PublicClient,
  number: bigint,
): Promise<Hash | null> {
  const block = await client
    .getBlock({ blockNumber: number })
    .catch(() => null);
  return block?.hash ? lower(block.hash) : null;
}

async function codeHashAt(
  client: PublicClient,
  address: Address,
  blockNumber: bigint,
): Promise<Hash> {
  const code = await client.getCode({ address, blockNumber });
  return keccak256(code ?? "0x");
}

export type DeploymentState = {
  allowUnboundCommerceJobs: boolean;
  block: PinnedBlock;
  codeHashes: Omit<ChainSnapshot["codeHashes"], "account">;
};

/** Code hashes and commerce mode of one adapter's deployment at one block. */
export async function readDeploymentState(input: {
  adapter: AdapterDeployment;
  block: PinnedBlock;
  client: PublicClient;
  deployment: PeragoDeployment;
}): Promise<DeploymentState> {
  const { adapter, block, client, deployment } = input;
  const blockNumber = block.number;
  const executor = deployment.mandateExecutor.address;
  const [adapterCode, executorCode, targetCode, verifierCode, allowUnbound] =
    await Promise.all([
      codeHashAt(client, adapter.adapter.address, blockNumber),
      codeHashAt(client, executor, blockNumber),
      codeHashAt(client, adapter.protocolTarget.address, blockNumber),
      codeHashAt(client, adapter.verifier.address, blockNumber),
      client.readContract({
        abi: mandateExecutorAbi,
        address: executor,
        blockNumber,
        functionName: "allowUnboundCommerceJobs",
      }),
    ]);
  return {
    allowUnboundCommerceJobs: allowUnbound,
    block,
    codeHashes: {
      adapter: adapterCode,
      mandateExecutor: executorCode,
      protocolTarget: targetCode,
      verifier: verifierCode,
    },
  };
}

export async function readChainSnapshot(input: {
  account: Address;
  adapter: AdapterDeployment;
  block: PinnedBlock;
  client: PublicClient;
  deployment: PeragoDeployment;
}): Promise<ChainSnapshot> {
  const { account, block, client, deployment } = input;
  const blockNumber = block.number;
  const [state, accountCode, implementationWord, config] = await Promise.all([
    readDeploymentState(input),
    codeHashAt(client, account, blockNumber),
    client.getStorageAt({
      address: account,
      blockNumber,
      slot: ERC1967_IMPLEMENTATION_SLOT,
    }),
    client.readContract({
      abi: mandateExecutorAbi,
      address: deployment.mandateExecutor.address,
      args: [account],
      blockNumber,
      functionName: "accountConfig",
    }),
  ]);
  return {
    block,
    codeHashes: { ...state.codeHashes, account: accountCode },
    accountImplementation: lower(
      getAddress(slice(implementationWord ?? `0x${"0".repeat(64)}`, 12)),
    ),
    accountConfig: {
      activePolicyHash: lower(config.activePolicyHash),
      ownerEpoch: config.ownerEpoch.toString(),
      permissionHash: lower(config.permissionHash),
      rootOwner: lower(config.rootOwner),
    },
    allowUnboundCommerceJobs: state.allowUnboundCommerceJobs,
  };
}

/**
 * The deployment wiring a simulation relies on, read from chain: the executor
 * pins this adapter, the adapter names this verifier, and every code hash
 * matches the reviewed manifest. Returns the verifier's id.
 */
export async function verifyDeploymentWiring(input: {
  adapter: AdapterDeployment;
  client: PublicClient;
  deployment: PeragoDeployment;
  kind: "SWAP" | "STAKE";
  snapshot: DeploymentState;
}): Promise<{ problems: string[]; verifierId: Hash }> {
  const { adapter, client, deployment, kind, snapshot } = input;
  const blockNumber = snapshot.block.number;
  const executor = deployment.mandateExecutor.address;
  const [pinnedAdapter, pinnedVerifier, adapterVerifier, verifierId] =
    await Promise.all([
      client.readContract({
        abi: mandateExecutorAbi,
        address: executor,
        blockNumber,
        functionName: kind === "SWAP" ? "swapAdapter" : "stakeAdapter",
      }),
      client.readContract({
        abi: mandateExecutorAbi,
        address: executor,
        blockNumber,
        functionName: kind === "SWAP" ? "swapVerifier" : "stakeVerifier",
      }),
      client.readContract({
        abi: peragoAdapterAbi,
        address: adapter.adapter.address,
        blockNumber,
        functionName: "verifier",
      }),
      client.readContract({
        abi: peragoVerifierAbi,
        address: adapter.verifier.address,
        blockNumber,
        functionName: "verifierId",
      }),
    ]);
  const problems: string[] = [];
  const expect = (label: string, observed: string, pinned: string) => {
    if (lower(observed) !== lower(pinned)) {
      problems.push(
        `${label} is ${lower(observed)}, manifest pins ${lower(pinned)}`,
      );
    }
  };
  expect("executor adapter", pinnedAdapter, adapter.adapter.address);
  expect("executor verifier", pinnedVerifier, adapter.verifier.address);
  expect("adapter verifier", adapterVerifier, adapter.verifier.address);
  expect(
    "executor code hash",
    snapshot.codeHashes.mandateExecutor,
    deployment.mandateExecutor.codeHash,
  );
  expect(
    "adapter code hash",
    snapshot.codeHashes.adapter,
    adapter.adapter.codeHash,
  );
  expect(
    "verifier code hash",
    snapshot.codeHashes.verifier,
    adapter.verifier.codeHash,
  );
  expect(
    "protocol code hash",
    snapshot.codeHashes.protocolTarget,
    adapter.protocolTarget.codeHash,
  );
  if (
    snapshot.allowUnboundCommerceJobs !== deployment.allowUnboundCommerceJobs
  ) {
    problems.push("executor commerce-binding mode differs from the manifest");
  }
  return { problems, verifierId: lower(verifierId) };
}
