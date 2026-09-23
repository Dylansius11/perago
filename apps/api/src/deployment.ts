import { readFileSync } from "node:fs";
import {
  type Address,
  addressSchema,
  type Hash,
  hashSchema,
  type ProtocolCatalog,
} from "@perago/sdk";

export type DeployedContract = { address: Address; codeHash: Hash };

export type AdapterDeployment = {
  /** The catalog id a plan names; one adapter per kind in a deployment. */
  id: string;
  adapter: DeployedContract;
  verifier: DeployedContract;
  protocol: string;
  /** The protocol contract the adapter calls: the swap router or the CAKE Pool. */
  protocolTarget: DeployedContract;
  sourceUrl: string;
};

/**
 * One MandateExecutor deployment and everything simulation pins against it.
 * Addresses and code hashes come only from reviewed manifests; a fork smoke
 * builds its own value for the executor it deploys and labels it as such.
 */
export type PeragoDeployment = {
  chainId: string;
  label: string;
  mandateExecutor: DeployedContract;
  allowUnboundCommerceJobs: boolean;
  quoter: Address;
  adapters: { SWAP: AdapterDeployment; STAKE: AdapterDeployment };
};

type ManifestContract = { address: string; codeHash: string };

type PeragoManifest = {
  chainId: number;
  label: string;
  constructor: { allowUnboundCommerceJobs: boolean };
  contracts: Record<string, ManifestContract>;
};

type ProtocolManifest = {
  chainId: number;
  sources: Record<string, string>;
  contracts: Record<string, ManifestContract>;
};

function readManifest<T>(file: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../deployments/${file}`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function contract(
  entries: Record<string, ManifestContract>,
  key: string,
): DeployedContract {
  const entry = entries[key];
  if (!entry) throw new Error(`manifest has no pinned contract ${key}`);
  return {
    address: addressSchema.parse(entry.address),
    codeHash: hashSchema.parse(entry.codeHash),
  };
}

function catalogId(catalog: ProtocolCatalog, kind: "SWAP" | "STAKE"): string {
  const matches = catalog.adapters.filter((adapter) => adapter.kind === kind);
  const [only] = matches;
  if (!only || matches.length !== 1) {
    throw new Error(`the catalog must name exactly one ${kind} adapter`);
  }
  return only.id;
}

/**
 * The reviewed production deployment on BSC Testnet: the executor and
 * adapter/verifier pairs from `bsc-testnet.perago.json`, the protocol targets
 * from the manifest they were deployed against.
 */
export function loadBscTestnetDeployment(
  catalog: ProtocolCatalog,
): PeragoDeployment {
  const perago = readManifest<PeragoManifest>("bsc-testnet.perago.json");
  const protocols = readManifest<ProtocolManifest>(
    "bsc-testnet.protocols.json",
  );
  if (
    String(perago.chainId) !== catalog.chainId ||
    String(protocols.chainId) !== catalog.chainId
  ) {
    throw new Error("deployment manifests and catalog name different chains");
  }
  const source = (key: string) => {
    const url = protocols.sources[key];
    if (!url) throw new Error(`protocol manifest has no source ${key}`);
    return url;
  };
  return {
    chainId: catalog.chainId,
    label: perago.label,
    mandateExecutor: contract(perago.contracts, "mandateExecutor"),
    allowUnboundCommerceJobs: perago.constructor.allowUnboundCommerceJobs,
    quoter: contract(protocols.contracts, "pancakeV3QuoterV2").address,
    adapters: {
      SWAP: {
        id: catalogId(catalog, "SWAP"),
        adapter: contract(perago.contracts, "swapAdapter"),
        verifier: contract(perago.contracts, "swapVerifier"),
        protocol: "PancakeSwap V3",
        protocolTarget: contract(protocols.contracts, "pancakeV3SwapRouter"),
        sourceUrl: source("pancakeV3"),
      },
      STAKE: {
        id: catalogId(catalog, "STAKE"),
        adapter: contract(perago.contracts, "stakeAdapter"),
        verifier: contract(perago.contracts, "stakeVerifier"),
        protocol: "PancakeSwap CAKE Pool",
        protocolTarget: contract(protocols.contracts, "cakePool"),
        sourceUrl: source("cakePool"),
      },
    },
  };
}
