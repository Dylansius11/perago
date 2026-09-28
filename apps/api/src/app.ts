import { type PublicConfig, REASON_MESSAGES } from "@perago/sdk";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Sql } from "postgres";
import { ZodError } from "zod";

import { createAuthRoutes } from "./auth/routes.js";
import type { WalletAuthConfig } from "./auth/wallet-auth.js";
import { ReasonError } from "./errors.js";
import type { Planner } from "./planner/provider.js";
import { createExecutionRoutes } from "./routes/executions.js";
import { createFaucetRoutes, type FaucetRouteConfig } from "./routes/faucet.js";

import { createPolicyRoutes } from "./routes/policies.js";
import { createReceiptRoutes } from "./routes/receipts.js";
import { createTaskRoutes } from "./routes/tasks.js";
import type { ExecutionServiceConfig } from "./services/executions.js";
import type { MandateServiceConfig } from "./services/mandates.js";
import type {
  PolicyChainVerifier,
  PolicyServiceConfig,
} from "./services/policies.js";
import type { TaskServiceConfig } from "./services/tasks.js";
import { isTransportError } from "./simulation/user-operation.js";

export function createApiApp(input: {
  authConfig: WalletAuthConfig;
  corsOrigin?: string;
  faucet?: FaucetRouteConfig;
  mandateConfig: MandateServiceConfig;
  planner: Planner;
  executionConfig: ExecutionServiceConfig;
  policyConfig: PolicyServiceConfig;
  policyVerifier: PolicyChainVerifier;
  publicConfig?: PublicConfig;
  sql: Sql;
  taskConfig: TaskServiceConfig;
}) {
  const app = new Hono();
  app.use(
    "*",
    cors({
      allowHeaders: ["authorization", "content-type"],
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      origin: input.corsOrigin ?? "http://localhost:3000",
    }),
  );
  app.get("/health", (context) => context.json({ status: "ok" }));
  if (input.publicConfig) {
    app.get("/config", (context) => context.json(input.publicConfig));
  }
  app.route("/auth", createAuthRoutes(input.sql, input.authConfig));
  app.route(
    "/policies",
    createPolicyRoutes({
      authConfig: input.authConfig,
      policyConfig: input.policyConfig,
      policyVerifier: input.policyVerifier,
      sql: input.sql,
    }),
  );
  app.route(
    "/tasks",
    createTaskRoutes({
      authConfig: input.authConfig,
      mandateConfig: input.mandateConfig,
      planner: input.planner,
      sql: input.sql,
      taskConfig: input.taskConfig,
    }),
  );
  if (input.faucet) {
    app.route(
      "/faucet",
      createFaucetRoutes({
        authConfig: input.authConfig,
        ...input.faucet,
        sql: input.sql,
      }),
    );
  }
  app.route(
    "/internal/executions",
    createExecutionRoutes({ config: input.executionConfig, sql: input.sql }),
  );
  app.route("/receipts", createReceiptRoutes(input.sql, input.executionConfig));

  app.onError((error, context) => {
    if (error instanceof ReasonError) {
      return context.json(
        {
          error: {
            code: error.code,
            detail: error.detail,
            message: error.message,
          },
        },
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
    if (error.message.includes("was not found")) {
      return context.json(
        { error: { code: "NOT_FOUND", message: error.message } },
        404,
      );
    }
    if (
      error instanceof RangeError ||
      error.message.includes("does not match") ||
      error.message.includes("must be") ||
      error.message.includes("stale") ||
      error.message.includes("broader") ||
      error.message.includes("cannot") ||
      error.message.includes("only") ||
      error.message.includes("expired") ||
      error.message.includes("invalid")
    ) {
      return context.json(
        { error: { code: "REQUEST_CONFLICT", message: error.message } },
        409,
      );
    }
    return context.json(
      { error: { code: "INTERNAL_ERROR", message: "request failed" } },
      500,
    );
  });

  return app;
}
