import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { peragoDeploymentManifestSchema } from "../src/index.js";

const manifest = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../deployments/${name}`, import.meta.url),
      "utf8",
    ),
  );

describe("peragoDeploymentManifestSchema", () => {
  it.each([
    ["bsc-testnet.perago.json", "testnet-production", false],
    ["bsc-testnet.demo.perago.json", "testnet-demo", true],
  ])("accepts the reviewed %s", (name, label, unbound) => {
    const parsed = peragoDeploymentManifestSchema.parse(manifest(name));
    expect(parsed.label).toBe(label);
    expect(parsed.constructor.allowUnboundCommerceJobs).toBe(unbound);
    expect(parsed.protocolManifest).toBe(
      "deployments/bsc-testnet.protocols.json",
    );
  });

  // Loaders read the named protocol manifest from disk, so it must stay inside `deployments/`.
  it.each([
    "../.env",
    "../deployments/bsc-testnet.protocols.json",
    "deployments/bsc-testnet.protocols.json/../../.env",
    "deployments/../.env",
    "/etc/passwd",
    "deployments/nested/protocols.json",
    "deployments/protocols.js",
  ])("refuses a protocol manifest path %s", (protocolManifest) => {
    const production = peragoDeploymentManifestSchema.parse(
      manifest("bsc-testnet.perago.json"),
    );
    expect(
      peragoDeploymentManifestSchema.safeParse({
        ...production,
        protocolManifest,
      }).success,
    ).toBe(false);
  });
});
