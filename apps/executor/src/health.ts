import { createServer, type Server } from "node:http";
import type { Address } from "@perago/sdk";
import { keccak256, type PublicClient } from "viem";

import type { ExecutorDeployment } from "./config.ts";
import { EXECUTOR_GAS_RESERVE } from "./reconcile.ts";

export type Readiness = {
  ready: boolean;
  checks: Record<string, boolean>;
};

/**
 * Ready only when the RPC serves the manifest's chain, MandateExecutor's
 * deployed code matches the manifest code hash, the executor can pay for gas,
 * and the API answers HTTP. Liveness is the process answering at all.
 */
export async function checkReadiness(input: {
  apiUrl: URL;
  client: PublicClient;
  deployment: ExecutorDeployment;
  executor: Address;
}): Promise<Readiness> {
  const settle = async (check: () => Promise<boolean>) => {
    try {
      return await check();
    } catch {
      // A failed probe is a not-ready answer, never a crash of the health server.
      return false;
    }
  };
  const [chain, code, gas, api] = await Promise.all([
    settle(
      async () =>
        (await input.client.getChainId()) === input.deployment.chainId,
    ),
    settle(async () => {
      const bytecode = await input.client.getCode({
        address: input.deployment.mandateExecutor,
      });
      return (
        bytecode !== undefined &&
        keccak256(bytecode) === input.deployment.mandateExecutorCodeHash
      );
    }),
    settle(async () => {
      const [balance, gasPrice] = await Promise.all([
        input.client.getBalance({ address: input.executor }),
        input.client.getGasPrice(),
      ]);
      return balance >= EXECUTOR_GAS_RESERVE * gasPrice;
    }),
    settle(async () => {
      const response = await fetch(input.apiUrl, { method: "GET" });
      await response.body?.cancel();
      return response.status < 500;
    }),
  ]);
  const checks = { api, chain, executorGas: gas, mandateExecutorCode: code };
  return { checks, ready: Object.values(checks).every(Boolean) };
}

export function startHealthServer(input: {
  port: number;
  workerId: string;
  readiness: () => Promise<Readiness>;
}): Server {
  const server = createServer(async (request, response) => {
    if (request.url === "/healthz") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok", workerId: input.workerId }));
      return;
    }
    if (request.url === "/readyz") {
      const readiness = await input.readiness();
      response.writeHead(readiness.ready ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(readiness));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(input.port, "127.0.0.1");
  return server;
}
