import { createMiddleware } from "hono/factory";
import type { Sql } from "postgres";

import {
  authenticateWalletSession,
  type WalletAuthConfig,
  type WalletIdentity,
} from "./wallet-auth.js";

export type WalletRouteBindings = {
  Variables: {
    wallet: WalletIdentity;
  };
};

/** Resolves the bearer token to a wallet identity or answers 401. */
export function requireWalletSession(sql: Sql, authConfig: WalletAuthConfig) {
  return createMiddleware<WalletRouteBindings>(async (context, next) => {
    const authorization = context.req.header("authorization");
    const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/u.exec(authorization ?? "");
    if (!match?.[1]) {
      return context.json(
        {
          error: { code: "AUTH_REQUIRED", message: "wallet session required" },
        },
        401,
      );
    }
    try {
      context.set(
        "wallet",
        await authenticateWalletSession(sql, match[1], authConfig.now()),
      );
    } catch {
      return context.json(
        {
          error: { code: "AUTH_INVALID", message: "wallet session is invalid" },
        },
        401,
      );
    }
    await next();
  });
}
