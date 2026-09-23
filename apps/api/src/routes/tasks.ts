import { Hono } from "hono";
import type { Sql } from "postgres";

import {
  requireWalletSession,
  type WalletRouteBindings,
} from "../auth/middleware.js";
import type { WalletAuthConfig } from "../auth/wallet-auth.js";
import type { Planner } from "../planner/provider.js";
import {
  createTask,
  type TaskServiceConfig,
  validateTaskConfig,
} from "../services/tasks.js";

const PLANNING_STATUS = {
  PLANNER_UNAVAILABLE: 503,
  PLANNER_OUTPUT_INVALID: 502,
  INTENT_NEEDS_CLARIFICATION: 422,
} as const;

export function createTaskRoutes(input: {
  authConfig: WalletAuthConfig;
  planner: Planner;
  sql: Sql;
  taskConfig: TaskServiceConfig;
}) {
  validateTaskConfig(input.taskConfig);
  const routes = new Hono<WalletRouteBindings>();

  routes.use("*", requireWalletSession(input.sql, input.authConfig));

  routes.post("/", async (context) => {
    const result = await createTask(
      input.sql,
      context.get("wallet"),
      await context.req.json(),
      input.taskConfig,
      input.planner,
    );
    if (result.kind === "COMPILED") return context.json(result.task, 200);
    if (result.kind === "IN_PROGRESS") {
      return context.json(
        {
          taskId: result.taskId,
          status: "COMPILING",
          error: {
            code: "TASK_COMPILING",
            message: "this request is already compiling; retry shortly",
          },
        },
        409,
      );
    }
    return context.json(
      {
        taskId: result.taskId,
        status: "DRAFT",
        error: { code: result.reasonCode, message: result.message },
        question: result.question,
      },
      PLANNING_STATUS[result.reasonCode],
    );
  });

  return routes;
}
