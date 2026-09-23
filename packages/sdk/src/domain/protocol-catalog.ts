import { z } from "zod";

import {
  adapterIdSchema,
  addressSchema,
  hasDuplicates,
  uint24StringSchema,
  uint256StringSchema,
} from "./primitives.js";

/**
 * The closed vocabulary the planner may name and the compiler may resolve:
 * tokens with pinned decimals, and adapters with their pinned routes. It is
 * built from a validated deployment manifest, never from model output.
 */
const catalogTokenSchema = z.strictObject({
  symbol: z.string().min(1).max(32),
  address: addressSchema,
  decimals: z.int().min(0).max(36),
});

const swapRouteSchema = z
  .strictObject({
    tokens: z.tuple([addressSchema, addressSchema]),
    poolFee: uint24StringSchema,
  })
  .refine(
    (route) => route.tokens[0] !== route.tokens[1],
    "a route needs two different tokens",
  );

const swapAdapterSchema = z.strictObject({
  id: adapterIdSchema,
  kind: z.literal("SWAP"),
  routes: z.array(swapRouteSchema).min(1),
});

const stakeAdapterSchema = z.strictObject({
  id: adapterIdSchema,
  kind: z.literal("STAKE"),
  asset: addressSchema,
});

export const protocolCatalogSchema = z
  .strictObject({
    chainId: uint256StringSchema,
    tokens: z.array(catalogTokenSchema).min(1),
    adapters: z
      .array(
        z.discriminatedUnion("kind", [swapAdapterSchema, stakeAdapterSchema]),
      )
      .min(1),
  })
  .superRefine((catalog, context) => {
    const issue = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (hasDuplicates(catalog.tokens.map((token) => token.symbol))) {
      issue("catalog token symbols must be unique");
    }
    if (hasDuplicates(catalog.tokens.map((token) => token.address))) {
      issue("catalog token addresses must be unique");
    }
    if (hasDuplicates(catalog.adapters.map((adapter) => adapter.id))) {
      issue("catalog adapter identifiers must be unique");
    }
    const known = new Set(catalog.tokens.map((token) => token.address));
    for (const adapter of catalog.adapters) {
      const used =
        adapter.kind === "SWAP"
          ? adapter.routes.flatMap((route) => route.tokens)
          : [adapter.asset];
      if (used.some((address) => !known.has(address))) {
        issue(`adapter ${adapter.id} names a token outside the catalog`);
      }
    }
  });

export type ProtocolCatalog = z.infer<typeof protocolCatalogSchema>;
export type CatalogToken = ProtocolCatalog["tokens"][number];
export type CatalogAdapter = ProtocolCatalog["adapters"][number];
