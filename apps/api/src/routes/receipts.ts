import { hashSchema } from "@perago/sdk";
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
  routes.get("/:mandateHash", async (context) => {
    const mandateHash = hashSchema.parse(context.req.param("mandateHash"));
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
    return context.json(receipt);
  });
  return routes;
}
