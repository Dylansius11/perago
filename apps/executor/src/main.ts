import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import { createExecutionApi } from "./api-client.ts";
import { loadExecutorConfig } from "./config.ts";
import { checkReadiness, startHealthServer } from "./health.ts";
import { createLogger, describeError } from "./log.ts";
import { runWorker, type WorkerMode } from "./worker.ts";

const config = loadExecutorConfig();
const logger = createLogger([
  config.executorKey,
  config.workerToken,
  config.rpcUrl,
]);
const mode: WorkerMode = process.argv.includes("--once") ? "once" : "loop";

if (config.deployment.chainId !== bscTestnet.id) {
  throw new Error(`the executor runs only on chain ${bscTestnet.id}`);
}
const chain = defineChain({
  ...bscTestnet,
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
const transport = http(config.rpcUrl, { retryCount: 1, timeout: 30_000 });
const client = createPublicClient({ chain, transport });
const wallet = createWalletClient({
  account: privateKeyToAccount(config.executorKey),
  chain,
  transport,
});

const controller = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    logger.info("worker.stopping", { signal });
    controller.abort();
  });
}

const readiness = () =>
  checkReadiness({
    apiUrl: config.apiUrl,
    client,
    deployment: config.deployment,
    executor: wallet.account.address,
  });
const health =
  config.healthPort === null
    ? null
    : startHealthServer({
        port: config.healthPort,
        readiness,
        workerId: config.workerId,
      });

const startup = await readiness();
if (!startup.checks.chain || !startup.checks.mandateExecutorCode) {
  logger.error("worker.not_ready", { checks: startup.checks });
  process.exit(1);
}
logger.info("worker.started", {
  deployment: config.deployment.label,
  executor: wallet.account.address,
  mandateExecutor: config.deployment.mandateExecutor,
  mode,
  workerId: config.workerId,
});

try {
  await runWorker(
    {
      api: createExecutionApi({
        apiUrl: config.apiUrl,
        workerId: config.workerId,
        workerToken: config.workerToken,
      }),
      client,
      deferSeconds: config.deferSeconds,
      deployment: config.deployment,
      logger,
      pollIntervalMs: config.pollIntervalMs,
      wallet,
    },
    mode,
    controller.signal,
  );
} catch (error) {
  logger.error("worker.crashed", describeError(error));
  process.exitCode = 1;
} finally {
  health?.close();
}
