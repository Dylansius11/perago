import { readFileSync } from "node:fs";
import { type ProtocolCatalog, protocolCatalogSchema } from "@perago/sdk";

type ProtocolManifest = {
  chainId: number;
  contracts: Record<string, { address: string }>;
  tokens: Record<string, { decimals: number; symbol: string }>;
  plannerCatalog: {
    tokens: string[];
    adapters: Record<
      string,
      | {
          kind: "SWAP";
          routes: { poolFee: string; tokens: [string, string] }[];
        }
      | { kind: "STAKE"; asset: string }
    >;
  };
};

/**
 * Resolves the BSC Testnet manifest's `plannerCatalog` keys to the pinned
 * contract addresses and token metadata of the same manifest, then validates
 * the result. A key without a pinned entry fails closed.
 */
export function loadBscTestnetCatalog(): ProtocolCatalog {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../../../../deployments/bsc-testnet.protocols.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as ProtocolManifest;
  const address = (key: string) => {
    const entry = manifest.contracts[key];
    if (!entry) throw new Error(`catalog key ${key} has no pinned contract`);
    return entry.address;
  };
  return protocolCatalogSchema.parse({
    chainId: String(manifest.chainId),
    tokens: manifest.plannerCatalog.tokens.map((key) => {
      const token = manifest.tokens[key];
      if (!token) throw new Error(`catalog key ${key} has no token metadata`);
      return {
        symbol: token.symbol,
        address: address(key),
        decimals: token.decimals,
      };
    }),
    adapters: Object.entries(manifest.plannerCatalog.adapters).map(
      ([id, adapter]) =>
        adapter.kind === "SWAP"
          ? {
              id,
              kind: "SWAP",
              routes: adapter.routes.map((route) => ({
                tokens: route.tokens.map(address),
                poolFee: route.poolFee,
              })),
            }
          : { id, kind: "STAKE", asset: address(adapter.asset) },
    ),
  });
}
