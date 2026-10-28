import { type ExecutionReceipt, type Hash, hashSchema } from "@perago/sdk";
import { Hono } from "hono";
import type { Sql } from "postgres";

import type { ExecutionServiceConfig } from "../services/executions.js";
import { indexFinalizedReceipt } from "../services/receipt-index.js";
import {
  assertReceiptCommitments,
  getPublicReceipt,
} from "../services/receipts.js";

export function createReceiptRoutes(sql: Sql, config: ExecutionServiceConfig) {
  const routes = new Hono();
  // The unauthenticated reader caches only validated terminal public responses.
  // A 15-second TTL and 64-entry FIFO cap bound per-process RPC cost and memory.
  const cache = new Map<
    Hash,
    { expiresAt: number; receipt: ExecutionReceipt }
  >();
  routes.get("/:mandateHash", async (context) => {
    const mandateHash = hashSchema.parse(context.req.param("mandateHash"));
    const cached = cache.get(mandateHash);
    if (cached && cached.expiresAt > Date.now()) {
      return context.json(cached.receipt);
    }
    cache.delete(mandateHash);
    const indexed = await indexFinalizedReceipt(sql, config, mandateHash);
    if (!indexed) {
      return context.json(
        { error: { code: "NOT_FOUND", message: "mandate was not found" } },
        404,
      );
    }
    const receipt = await getPublicReceipt(sql, mandateHash, indexed.commerce);
    if (!receipt) {
      return context.json(
        {
          error: {
            code: "NOT_FOUND",
            message: "finalized receipt was not found",
          },
        },
        404,
      );
    }
    assertReceiptCommitments(receipt, indexed);
    if (cache.size >= 64) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(mandateHash, { receipt, expiresAt: Date.now() + 15_000 });
    return context.json(receipt);
  });
  return routes;
}
