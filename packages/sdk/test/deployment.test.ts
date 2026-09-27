import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  peragoDeploymentManifestSchema,
  resolveSettlementDeployment,
} from "../src/index.js";

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

  it("accepts a reviewed evaluator binding and rejects an incomplete or zero-address recipient", () => {
    const production = peragoDeploymentManifestSchema.parse(
      manifest("bsc-testnet.perago.json"),
    );
    const settlement = {
      evaluator: {
        address: "0x1111111111111111111111111111111111111111",
        codeHash: `0x${"aa".repeat(32)}`,
      },
      provider: "0x2222222222222222222222222222222222222222",
    };
    expect(
      peragoDeploymentManifestSchema.parse({ ...production, settlement })
        .settlement?.provider,
    ).toBe(settlement.provider);
    expect(
      peragoDeploymentManifestSchema.safeParse({
        ...production,
        settlement: { evaluator: settlement.evaluator },
      }).success,
    ).toBe(false);
    expect(
      peragoDeploymentManifestSchema.safeParse({
        ...production,
        settlement: {
          ...settlement,
          provider: "0x0000000000000000000000000000000000000000",
        },
      }).success,
    ).toBe(false);
  });

  it("pins the evaluator and deployed proxy implementations or rejects drift", () => {
    const production = peragoDeploymentManifestSchema.parse(
      manifest("bsc-testnet.perago.json"),
    );
    const protocol = manifest("bsc-testnet.protocols.json") as {
      chainId: number;
      contracts: Record<string, Record<string, string>>;
    };
    const settlement = {
      evaluator: {
        address: "0x1111111111111111111111111111111111111111",
        codeHash: `0x${"aa".repeat(32)}`,
      },
      provider: "0x2222222222222222222222222222222222222222",
    };
    expect(resolveSettlementDeployment(production, protocol)).toBeNull();
    const configured = { ...production, settlement };
    const resolved = resolveSettlementDeployment(configured, protocol);
    expect(resolved?.commerce.address).toBe(
      protocol.contracts.apexKernel?.address.toLowerCase(),
    );
    expect(resolved?.commerce.implementation).toBe(
      protocol.contracts.apexKernel?.erc1967Implementation,
    );
    expect(resolved?.evaluator.address).toBe(settlement.evaluator.address);
    expect(() =>
      resolveSettlementDeployment(configured, {
        ...protocol,
        chainId: 56,
      }),
    ).toThrow();
    expect(() =>
      resolveSettlementDeployment(configured, {
        ...protocol,
        contracts: {
          ...protocol.contracts,
          apexKernel: {
            ...protocol.contracts.apexKernel,
            erc1967Implementation: "0x0000000000000000000000000000000000000000",
          },
        },
      }),
    ).toThrow();
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
