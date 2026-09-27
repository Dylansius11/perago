import { z } from "zod";

import {
  addressSchema,
  hashSchema,
  uint48StringSchema,
} from "./domain/primitives.js";

const pinnedContractSchema = z.object({
  address: addressSchema,
  codeHash: hashSchema,
});

/**
 * A `deployments/*.perago.json` manifest: the only source of Perago contract
 * addresses and code hashes. Provenance fields (transactions, blocks, sources)
 * may accompany these, but every field a process relies on is validated here.
 */
export const peragoDeploymentManifestSchema = z.object({
  schemaVersion: z.literal(1),
  chainId: z.number().int().positive(),
  label: z.string().min(1),
  /** Repository-relative path of the protocol manifest these contracts were deployed against. */
  protocolManifest: z.string().regex(/^deployments\/[\w.-]+\.json$/u),
  constructor: z.object({
    executionWindowSeconds: uint48StringSchema,
    allowUnboundCommerceJobs: z.boolean(),
  }),
  contracts: z.object({
    mandateExecutor: pinnedContractSchema,
    swapAdapter: pinnedContractSchema,
    swapVerifier: pinnedContractSchema,
    stakeAdapter: pinnedContractSchema,
    stakeVerifier: pinnedContractSchema,
  }),
  /** Absent until the immutable evaluator is actually deployed and pinned. */
  settlement: z
    .strictObject({
      evaluator: pinnedContractSchema,
      provider: addressSchema.refine(
        (value) => value !== "0x0000000000000000000000000000000000000000",
        "settlement provider must not be zero",
      ),
    })
    .optional(),
});

export type PeragoDeploymentManifest = z.infer<
  typeof peragoDeploymentManifestSchema
>;
const liveAddress = addressSchema.refine(
  (value) => value !== "0x0000000000000000000000000000000000000000",
  "a deployed contract must not be zero",
);
const liveContract = pinnedContractSchema.extend({ address: liveAddress });
const proxy = liveContract.extend({
  erc1967Implementation: liveAddress,
  implementationCodeHash: hashSchema,
});
const settlementProtocolManifestSchema = z.object({
  chainId: z.number().int().positive(),
  contracts: z.object({
    apexKernel: proxy,
    apexPaymentToken: proxy,
    peragoAcpHook: liveContract,
  }),
});

/** Explicit deployment pins only; absence never enables commerce-bound work. */
export function resolveSettlementDeployment(
  perago: PeragoDeploymentManifest,
  protocolManifest: unknown,
): SettlementDeployment | null {
  if (!perago.settlement) return null;
  const protocol = settlementProtocolManifestSchema.parse(protocolManifest);
  if (protocol.chainId !== perago.chainId) {
    throw new Error("settlement protocol manifest names another chain");
  }
  const { apexKernel, apexPaymentToken, peragoAcpHook } = protocol.contracts;
  return {
    evaluator: perago.settlement.evaluator,
    provider: perago.settlement.provider,
    commerce: {
      address: apexKernel.address,
      codeHash: apexKernel.codeHash,
      implementation: apexKernel.erc1967Implementation,
      implementationCodeHash: apexKernel.implementationCodeHash,
    },
    paymentToken: {
      address: apexPaymentToken.address,
      codeHash: apexPaymentToken.codeHash,
      implementation: apexPaymentToken.erc1967Implementation,
      implementationCodeHash: apexPaymentToken.implementationCodeHash,
    },
    hook: peragoAcpHook,
  };
}

export type SettlementDeployment = {
  evaluator: z.infer<typeof pinnedContractSchema>;
  provider: z.infer<typeof addressSchema>;
  commerce: {
    address: z.infer<typeof addressSchema>;
    codeHash: z.infer<typeof hashSchema>;
    implementation: z.infer<typeof addressSchema>;
    implementationCodeHash: z.infer<typeof hashSchema>;
  };
  paymentToken: {
    address: z.infer<typeof addressSchema>;
    codeHash: z.infer<typeof hashSchema>;
    implementation: z.infer<typeof addressSchema>;
    implementationCodeHash: z.infer<typeof hashSchema>;
  };
  hook: z.infer<typeof pinnedContractSchema>;
};
