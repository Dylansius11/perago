import { describe, expect, it } from "vitest";

import { createLogger, describeError } from "./log.ts";

const key = `0x${"ab".repeat(32)}`;
const rpcUrl = "https://bnb-testnet.g.alchemy.com/v2/secret-provider-key";

function capture() {
  const lines: string[] = [];
  const logger = createLogger(
    [key, rpcUrl, "worker-token-worker-token-worker-token"],
    (line) => lines.push(line),
  );
  return { lines, logger };
}

describe("logger", () => {
  it("redacts the executor key in any case, with or without its prefix", () => {
    const { lines, logger } = capture();
    logger.error("leak", {
      bare: key.slice(2).toUpperCase(),
      nested: { prefixed: key },
    });
    expect(lines.join("\n")).not.toMatch(/abab/iu);
    expect(lines[0]).toContain("[REDACTED]");
  });

  it("redacts an RPC URL and token carried inside an error message", () => {
    const { lines, logger } = capture();
    logger.warn(
      "rpc",
      describeError(
        new Error(
          `request to ${rpcUrl} failed with Bearer worker-token-worker-token-worker-token`,
        ),
      ),
    );
    expect(lines[0]).not.toContain("secret-provider-key");
    expect(lines[0]).not.toContain("worker-token");
  });

  it("serializes chain integers without losing precision", () => {
    const { lines, logger } = capture();
    logger.info("nonce", { nonce: 2n ** 200n });
    expect(JSON.parse(lines[0] ?? "{}").nonce).toBe((2n ** 200n).toString());
  });
});
