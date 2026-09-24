import { createHash, timingSafeEqual } from "node:crypto";
import {
  REASON_MESSAGES,
  deferExecutionRequestSchema,
  executionJobResponseSchema,
  hashSchema,
  leaseExecutionResponseSchema,
  recordPendingTransactionRequestSchema,
  retireReplacedTransactionRequestSchema,
  workerRequestSchema,
} from "@perago/sdk";
import { Hono } from "hono";
import type { Sql } from "postgres";
import { BaseError } from "viem";
import { ZodError } from "zod";

import {
  deferExecution,
  ExecutionConflictError,
  type ExecutionServiceConfig,
  LeaseLostError,
  leaseExecution,
  reconcileExecution,
  recordPendingTransaction,
  releaseExecution,
  retireReplacedTransaction,
} from "../services/executions.js";
import { isTransportError } from "../simulation/user-operation.js";

export function createExecutionRoutes(input: {
  config: ExecutionServiceConfig;
  sql: Sql;
}) {
  const routes = new Hono();
  routes.use("*", async (context, next) => {
    const authorization = context.req.header("authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice(7)
      : null;
    const candidate =
      token === null ? null : createHash("sha256").update(token).digest();
    if (
      candidate === null ||
      candidate.length !== input.config.workerTokenHash.length ||
      !timingSafeEqual(candidate, input.config.workerTokenHash)
    ) {
      return context.json({ error: { code: "WORKER_AUTH_REQUIRED" } }, 401);
    }
    await next();
  });
  routes.post("/lease", async (context) => {
    const request = workerRequestSchema.parse(await context.req.json());
    return context.json(
      leaseExecutionResponseSchema.parse(
        await leaseExecution(input.sql, request.workerId, input.config),
      ),
    );
  });
  routes.post("/:mandateHash/reconcile", async (context) => {
    const mandateHash = hashSchema.parse(context.req.param("mandateHash"));
    const request = workerRequestSchema.parse(await context.req.json());
    return context.json(
      executionJobResponseSchema.parse(
        await reconcileExecution(
          input.sql,
          mandateHash,
          request.workerId,
          input.config,
        ),
      ),
    );
  });
  routes.post("/:mandateHash/pending", async (context) => {
    const mandateHash = hashSchema.parse(context.req.param("mandateHash"));
    const request = recordPendingTransactionRequestSchema.parse(
      await context.req.json(),
    );
    return context.json(
      executionJobResponseSchema.parse(
        await recordPendingTransaction(
          input.sql,
          mandateHash,
          request,
          input.config,
        ),
      ),
    );
  });
  routes.post("/:mandateHash/pending/retire", async (context) => {
    const mandateHash = hashSchema.parse(context.req.param("mandateHash"));
    const request = retireReplacedTransactionRequestSchema.parse(
      await context.req.json(),
    );
    return context.json(
      executionJobResponseSchema.parse(
        await retireReplacedTransaction(
          input.sql,
          mandateHash,
          request,
          input.config,
        ),
      ),
    );
  });
  routes.post("/:mandateHash/defer", async (context) => {
    const mandateHash = hashSchema.parse(context.req.param("mandateHash"));
    const request = deferExecutionRequestSchema.parse(await context.req.json());
    return context.json(
      executionJobResponseSchema.parse(
        await deferExecution(input.sql, mandateHash, request, input.config),
      ),
    );
  });
  routes.post("/:mandateHash/release", async (context) => {
    const mandateHash = hashSchema.parse(context.req.param("mandateHash"));
    const request = workerRequestSchema.parse(await context.req.json());
    return context.json(
      executionJobResponseSchema.parse(
        await releaseExecution(
          input.sql,
          mandateHash,
          request.workerId,
          input.config,
        ),
      ),
    );
  });
  routes.onError((error, context) => {
    if (error instanceof LeaseLostError)
      return context.json({ error: { code: "LEASE_LOST" } }, 409);
    if (error instanceof ExecutionConflictError) {
      return context.json(
        { error: { code: "EXECUTION_CONFLICT", message: error.message } },
        409,
      );
    }
    if (isTransportError(error)) {
      return context.json(
        {
          error: {
            code: "CHAIN_UNAVAILABLE",
            message: REASON_MESSAGES.CHAIN_UNAVAILABLE,
          },
        },
        503,
      );
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return context.json(
        { error: { code: "INVALID_REQUEST", message: "request is invalid" } },
        400,
      );
    }
    // Operators need the cause of an unexpected failure; the caller gets none of it. Viem's full
    // message embeds the RPC URL, which can carry a provider key, so only the short form is logged.
    const message =
      error instanceof BaseError ? error.shortMessage : error.message;
    console.error(
      JSON.stringify({
        event: "worker_route.failed",
        error: error.name,
        message: message
          .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/giu, "<url>")
          .slice(0, 300),
      }),
    );
    return context.json(
      { error: { code: "INTERNAL_ERROR", message: "request failed" } },
      500,
    );
  });
  return routes;
}
