import { bscTestnet } from "viem/chains";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { RPC_URL } from "./env";

/*
 * One chain, one connector family. Perago supports BSC Testnet (97) only, and
 * the owner is always an external self-custodial wallet: EIP-6963 discovery
 * lists every injected wallet the browser exposes, and no embedded wallet,
 * relay, or WalletConnect bridge ever holds a key.
 *
 * Reads go through `RPC_URL` (a local chain-97 fork during development);
 * writes go through the wallet's own RPC. `useVenueCheck` proves the two see
 * the same chain before any write is offered.
 */
export const CHAIN = bscTestnet;
export const CHAIN_ID = bscTestnet.id;

export const wagmiConfig = createConfig({
  chains: [bscTestnet],
  connectors: [injected()],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports: { [bscTestnet.id]: http(RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
