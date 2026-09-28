"use client";

import type { Address, PublicConfig } from "@perago/sdk";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi } from "viem";
import { getPublicClient } from "wagmi/actions";
import {
  ACCOUNT_IMPLEMENTATION_SLOT,
  assertPinnedAccountCode,
} from "./account-code";
import { ApiError, api } from "./api";
import { useSession } from "./session";
import { CHAIN_ID, wagmiConfig } from "./wagmi";

/*
 * Server state. API reads are keyed under ["session", owner, ...] so signing
 * out drops them together; a 401 from any of them ends the session instead of
 * rendering a stale screen. Chain reads go straight to the RPC: the chain,
 * not the API cache, is the authority for balances and code.
 */

export const TERMINAL_TASK = new Set([
  "SUCCEEDED",
  "FAILED",
  "REVOKED",
  "EXPIRED",
]);

export function usePublicConfig() {
  return useQuery({
    queryKey: ["config"],
    queryFn: api.config,
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
  });
}
type Interval<T> = number | false | ((data: T | undefined) => number | false);

function useAuthedQuery<T>(
  name: string,
  fn: (token: string) => Promise<T>,
  options: { enabled?: boolean; refetchInterval: Interval<T> },
) {
  const { owner, session, expire } = useSession();
  const interval = options.refetchInterval;
  return useQuery({
    queryKey: ["session", owner, name],
    enabled: session !== null && (options.enabled ?? true),
    queryFn: async () => {
      if (!session) throw new Error("not signed in");
      try {
        return await fn(session.token);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) expire();
        throw error;
      }
    },
    refetchInterval:
      typeof interval === "function"
        ? (query) => interval(query.state.data)
        : interval,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status < 500) && count < 2,
  });
}

export const usePolicies = () =>
  useAuthedQuery("policies", api.policies, { refetchInterval: 15_000 });

export const useTasks = () =>
  useAuthedQuery("tasks", api.tasks, { refetchInterval: 8_000 });

export const useFaucet = (enabled: boolean) =>
  useAuthedQuery("faucet", api.faucet, {
    enabled,
    refetchInterval: (data) =>
      data?.lastClaim?.status === "BROADCAST" ||
      data?.lastClaim?.status === "PENDING"
        ? 2_000
        : 20_000,
  });

export function useTask(taskId: string) {
  return useAuthedQuery(`task:${taskId}`, (token) => api.task(token, taskId), {
    refetchInterval: (task) => {
      if (!task) return 3_000;
      if (task.receipt || TERMINAL_TASK.has(task.mandate?.status ?? ""))
        return 10_000;
      return task.mandate ? 2_000 : 6_000;
    },
  });
}

export type Holdings = {
  deployed: boolean;
  ownerNative: bigint;
  accountNative: bigint;
  tokens: Record<
    string,
    { address: Address; decimals: number; balance: bigint; allowance: bigint }
  >;
};

/** Account code, native balances, and every catalog token's balance and allowance to MandateExecutor. */
export function useHoldings(config: PublicConfig | undefined) {
  const { owner, account } = useSession();
  return useQuery({
    queryKey: ["chain", "holdings", owner, account, config?.mandateExecutor],
    enabled: Boolean(owner && account && config),
    refetchInterval: 5_000,
    queryFn: async (): Promise<Holdings> => {
      if (!owner || !account || !config) throw new Error("not ready");
      const client = getPublicClient(wagmiConfig, { chainId: CHAIN_ID });
      const [code, ownerNative, accountNative, reads] = await Promise.all([
        client.getCode({ address: account }),
        client.getBalance({ address: owner }),
        client.getBalance({ address: account }),
        Promise.all(
          config.tokens.map(async (token) => {
            const [balance, allowance] = await Promise.all([
              client.readContract({
                abi: erc20Abi,
                address: token.address,
                functionName: "balanceOf",
                args: [account],
              }),
              client.readContract({
                abi: erc20Abi,
                address: token.address,
                functionName: "allowance",
                args: [account, config.mandateExecutor],
              }),
            ]);
            return [
              token.symbol,
              {
                address: token.address,
                decimals: token.decimals,
                balance,
                allowance,
              },
            ] as const;
          }),
        ),
      ]);
      const deployed = code !== undefined && code !== "0x";
      if (deployed) {
        const implementation = await client.getStorageAt({
          address: account,
          slot: ACCOUNT_IMPLEMENTATION_SLOT,
        });
        assertPinnedAccountCode({ owner, code, implementation });
      }
      return {
        deployed,
        ownerNative,
        accountNative,
        tokens: Object.fromEntries(reads),
      };
    },
  });
}
