import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";

import { assertFaucetChain, createViemFaucetTransport } from "./faucet.js";

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const processes: ChildProcess[] = [];

async function startAnvil(chainId: number, port: number) {
  const anvil = spawn(process.env.ANVIL_BIN || "anvil", [
    "--chain-id",
    String(chainId),
    "--port",
    String(port),
    "--silent",
  ]);
  processes.push(anvil);
  const client = createPublicClient({
    transport: http(`http://127.0.0.1:${port}`),
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await client.getChainId()) === chainId) return client;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`anvil did not start on port ${port}`);
}

afterAll(() => {
  for (const process of processes) process.kill();
});

describe("P7-003 faucet transport", () => {
  it("transfers on a non-fork chain-97 Anvil and rejects a non-97 RPC", async () => {
    const client97 = await startAnvil(97, 8657);
    await assertFaucetChain(() => client97.getChainId());
    const recipient = privateKeyToAccount(
      "0x59c6995e998f97a5a0044966f0945385dc9e86dae88c7a8412d2a642f19013d0",
    ).address;
    const transport = createViemFaucetTransport({
      key: ANVIL_KEY,
      rpcUrl: "http://127.0.0.1:8657",
    });
    const value = 20_000_000_000_000_000n;
    const before = await transport.balanceOf(recipient);
    const hash = await transport.send({ to: recipient, value });
    await client97.waitForTransactionReceipt({ hash });
    expect(await transport.balanceOf(recipient)).toBe(before + value);

    const client31337 = await startAnvil(31337, 8658);
    await expect(
      assertFaucetChain(() => client31337.getChainId()),
    ).rejects.toThrow("chain 97");
  });
});
