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
});

export type PeragoDeploymentManifest = z.infer<
  typeof peragoDeploymentManifestSchema
>;
