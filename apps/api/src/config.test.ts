import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadApiConfig } from "./config.js";

const required = {
  PERAGO_API_RPC: "http://127.0.0.1:8545",
  PERAGO_DATABASE_URL:
    "postgres://perago:local@127.0.0.1:56432/perago_test_api",
  PERAGO_EXECUTOR_ADDRESS: "0x1111111111111111111111111111111111111111",
  PERAGO_GROQ_API_KEY: "test-key",
  PERAGO_INTENT_ENCRYPTION_KEY: "11".repeat(32),
  PERAGO_WORKER_TOKEN: "a".repeat(32),
} as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

describe("loadApiConfig", () => {
  it("rejects a missing database URL and malformed encryption key", () => {
    expect(() =>
      loadApiConfig({ ...required, PERAGO_DATABASE_URL: "" }),
    ).toThrow("PERAGO_DATABASE_URL is required");
    expect(() =>
      loadApiConfig({ ...required, PERAGO_INTENT_ENCRYPTION_KEY: "not-hex" }),
    ).toThrow("PERAGO_INTENT_ENCRYPTION_KEY must be a 32-byte hex key");
  });
  it("retains the browser origin without a URL path for CORS", () => {
    expect(loadApiConfig(required).webOrigin).toBe("http://localhost:3000");
  });

  it("refuses deployment manifests outside BSC Testnet", async () => {
    const directory = await mkdtemp(join(tmpdir(), "perago-api-config-"));
    const path = join(directory, "manifest.json");
    temporaryDirectories.push(directory);
    const manifest = JSON.parse(
      await readFile(
        new URL(
          "../../../deployments/bsc-testnet.demo.perago.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as Record<string, unknown>;
    await writeFile(path, JSON.stringify({ ...manifest, chainId: 56 }));
    expect(() =>
      loadApiConfig({ ...required, PERAGO_DEPLOYMENT_MANIFEST: path }),
    ).toThrow("the API runs only on chain 97");
  });
});
