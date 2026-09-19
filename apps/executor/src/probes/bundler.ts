import { z } from "zod";

const BSC_TESTNET_CHAIN_ID = "0x61";
const ENTRY_POINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032";

const JsonRpcResponse = z.object({
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
    })
    .optional(),
});

async function callBundler(endpoint: string, method: string): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  });
  if (!response.ok) {
    throw new Error(`bundler returned HTTP ${response.status}`);
  }

  const { error, result } = JsonRpcResponse.parse(await response.json());
  if (error) {
    throw new Error(
      `bundler ${method} failed (${error.code}): ${error.message}`,
    );
  }
  if (result === undefined) {
    throw new Error(`bundler ${method} returned no result`);
  }

  return result;
}

async function main() {
  const endpoint = process.env.PERAGO_ALCHEMY_BUNDLER_RPC;
  if (!endpoint) {
    throw new Error("PERAGO_ALCHEMY_BUNDLER_RPC is required");
  }

  const [chainId, supportedEntryPoints] = await Promise.all([
    callBundler(endpoint, "eth_chainId"),
    callBundler(endpoint, "eth_supportedEntryPoints"),
  ]);
  if (chainId !== BSC_TESTNET_CHAIN_ID) {
    throw new Error(
      `expected BSC Testnet chain ${BSC_TESTNET_CHAIN_ID}, received ${String(chainId)}`,
    );
  }
  if (
    !Array.isArray(supportedEntryPoints) ||
    !supportedEntryPoints.some(
      (entryPoint) =>
        typeof entryPoint === "string" &&
        entryPoint.toLowerCase() === ENTRY_POINT_V07,
    )
  ) {
    throw new Error("bundler does not support the pinned EntryPoint v0.7");
  }

  console.log(
    JSON.stringify(
      {
        chainId,
        entryPoint: ENTRY_POINT_V07,
        supportedEntryPoints,
      },
      null,
      2,
    ),
  );
}

void main();
