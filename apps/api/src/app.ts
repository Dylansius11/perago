import { Hono } from "hono";
import type { Sql } from "postgres";
import { ZodError } from "zod";

import { createAuthRoutes } from "./auth/routes.js";
import type { WalletAuthConfig } from "./auth/wallet-auth.js";
import type { Planner } from "./planner/provider.js";
import { createPolicyRoutes } from "./routes/policies.js";
import { createTaskRoutes } from "./routes/tasks.js";
import type {
  PolicyChainVerifier,
  PolicyServiceConfig,
} from "./services/policies.js";
import type { TaskServiceConfig } from "./services/tasks.js";

export function createApiApp(input: {
  authConfig: WalletAuthConfig;
  planner: Planner;
  policyConfig: PolicyServiceConfig;
  policyVerifier: PolicyChainVerifier;
  sql: Sql;
  taskConfig: TaskServiceConfig;
}) {
  const app = new Hono();
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
      planner: input.planner,
      sql: input.sql,
      taskConfig: input.taskConfig,
    }),
  );

  app.onError((error, context) => {
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
