"use client";

import { deriveSemiModularAccountAddress } from "@perago/sdk";
import { useQuery } from "@tanstack/react-query";
import type { EIP1193Provider } from "viem";
import { type Connector, useConnection } from "wagmi";
import { getConnection, getPublicClient } from "wagmi/actions";
import {
  ACCOUNT_IMPLEMENTATION_SLOT,
  AccountCodeMismatchError,
  assertPinnedAccountCode,
} from "./account-code";
import { CHAIN_ID, wagmiConfig } from "./wagmi";

/*
 * The console reads through its own RPC but writes through the wallet's.
 * A wallet pointed at another chain, or at chain 97 through a different
 * history (live testnet versus a local fork), would sign and send against
 * state the screen never showed. So before any write is offered, the wallet
 * must return the console's current block hash. A fresh comparison is also
 * required immediately before a signature or owner-paid transaction.
 */

export type Venue =
  | { status: "disconnected" }
  | { status: "checking" }
  | { status: "wrong-chain"; chainId: number | null }
  | { status: "mismatch" }
  | { status: "ok" };

type RpcBlock = { hash: string | null } | null;

/** Compare the state the console just read, not a shared ancestor of two diverging chains. */
export async function probeMatchingHead(input: {
  readHead: () => Promise<{ number: bigint; hash: string }>;
  readWalletBlock: (number: bigint) => Promise<RpcBlock>;
}): Promise<boolean> {
  const ours = await input.readHead();
  const theirs = await input.readWalletBlock(ours.number);
  return Boolean(
    ours.hash && theirs?.hash?.toLowerCase() === ours.hash.toLowerCase(),
  );
}

export class VenueMismatchError extends Error {
  constructor() {
    super(
      "Your wallet and this console cannot prove the same current chain state. Check the wallet network and try again.",
    );
    this.name = "VenueMismatchError";
  }
}

async function matchesConnector(connector: Connector): Promise<boolean> {
  const provider = (await connector.getProvider()) as EIP1193Provider;
  const chainId = await provider.request({ method: "eth_chainId" });
  if (BigInt(chainId as string) !== BigInt(CHAIN_ID)) return false;
  const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
  if (!client) return false;
  return probeMatchingHead({
    readHead: () => client.getBlock({ blockTag: "latest" }),
    readWalletBlock: (number) =>
      provider.request({
        method: "eth_getBlockByNumber",
        params: [`0x${number.toString(16)}`, false],
      }) as Promise<RpcBlock>,
  });
}

/** Fresh read before every wallet signature or broadcast; the UI's cached gate is insufficient. */
export async function assertWalletVenue(): Promise<void> {
  const connection = getConnection(wagmiConfig);
  if (connection.status !== "connected" || !connection.connector)
    throw new VenueMismatchError();
  try {
    if (!(await matchesConnector(connection.connector)))
      throw new VenueMismatchError();
    const owner = connection.addresses[0];
    const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
    if (!owner || !client) throw new VenueMismatchError();
    const account = deriveSemiModularAccountAddress({ owner });
    const code = await client.getCode({ address: account });
    if (code && code !== "0x") {
      const implementation = await client.getStorageAt({
        address: account,
        slot: ACCOUNT_IMPLEMENTATION_SLOT,
      });
      assertPinnedAccountCode({ owner, code, implementation });
    }
  } catch (error) {
    if (error instanceof AccountCodeMismatchError) throw error;
    throw new VenueMismatchError();
  }
}

export function useVenue(): Venue {
  const { connector, status, chainId } = useConnection();
  const connected = status === "connected" && connector !== undefined;
  const onChain = chainId === CHAIN_ID;
  const probe = useQuery({
    queryKey: ["venue", connector?.uid, chainId],
    enabled: connected && onChain,
    refetchInterval: 20_000,
    retry: 1,
    queryFn: async () => {
      if (!connector) throw new VenueMismatchError();
      return matchesConnector(connector);
    },
  });

  if (!connected) return { status: "disconnected" };
  if (!onChain) return { status: "wrong-chain", chainId: chainId ?? null };
  if (probe.isError) return { status: "mismatch" };
  if (probe.data === undefined) return { status: "checking" };
  return probe.data ? { status: "ok" } : { status: "mismatch" };
}
