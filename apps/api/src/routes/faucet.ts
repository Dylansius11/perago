import { getConnInfo } from "@hono/node-server/conninfo";
import { createFaucetClaimRequestSchema } from "@perago/sdk";
import { type Context, Hono } from "hono";
import type { Sql } from "postgres";

import {
  requireWalletSession,
  type WalletRouteBindings,
} from "../auth/middleware.js";
import type { WalletAuthConfig } from "../auth/wallet-auth.js";
import { ReasonError } from "../errors.js";
import {
  claimFaucet,
  type FaucetServiceConfig,
  getFaucetStatus,
} from "../services/faucet.js";

export type FaucetRouteConfig = {
  config: FaucetServiceConfig;
  trustProxy: boolean;
};

function clientIp(context: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = context.req
      .header("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();
    if (forwarded) return forwarded;
  }
  return getConnInfo(context).remote.address ?? "unknown";
}

function refusal(context: Context, error: ReasonError) {
  return context.json(
    {
      error: {
        code: error.code,
        detail: error.detail,
        message: error.message,
      },
    },
    error.code === "FAUCET_RATE_LIMITED" ? 429 : 409,
  );
}

export function createFaucetRoutes(
  input: { authConfig: WalletAuthConfig; sql: Sql } & FaucetRouteConfig,
) {
  const routes = new Hono<WalletRouteBindings>();
  routes.use("*", requireWalletSession(input.sql, input.authConfig));

  routes.get("/", async (context) =>
    context.json(
      await getFaucetStatus(
        input.sql,
        context.get("wallet"),
        clientIp(context, input.trustProxy),
        input.config,
      ),
    ),
  );
  routes.post("/claims", async (context) => {
    createFaucetClaimRequestSchema.parse(await context.req.json());
    try {
      return context.json(
        await claimFaucet(
          input.sql,
          context.get("wallet"),
          clientIp(context, input.trustProxy),
          input.config,
        ),
        201,
      );
    } catch (error) {
      if (error instanceof ReasonError) return refusal(context, error);
      throw error;
    }
  });
  return routes;
}
