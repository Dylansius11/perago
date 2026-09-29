import { keccak256, type PublicClient } from "viem";
import { afterEach, expect, it, vi } from "vitest";

import type { ExecutorDeployment } from "./config.ts";
import { checkReadiness } from "./health.ts";

const executor = "0x3333333333333333333333333333333333333333" as const;
const deployment: ExecutorDeployment = {
  chainId: 97,
  label: "test",
  mandateExecutor: "0x9999999999999999999999999999999999999999",
  mandateExecutorCodeHash: keccak256("0x6000"),
  executionWindowSeconds: 600n,
};

afterEach(() => vi.unstubAllGlobals());

it("reports not ready while a positive gas balance still cannot cover execution", async () => {
  vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }));
  const client = {
    getChainId: async () => 97,
    getCode: async () => "0x6000",
    getBalance: async () => 2_834_071_000_000_000n,
    getGasPrice: async () => 1_000_000_000n,
  } as unknown as PublicClient;

  expect(
    await checkReadiness({
      apiUrl: new URL("http://127.0.0.1:8787/"),
      client,
      deployment,
      executor,
    }),
  ).toMatchObject({ ready: false, checks: { executorGas: false } });
});
