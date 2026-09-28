import { Hono } from "hono";
import type { Sql } from "postgres";
import { sessionView } from "../services/views.js";
import {
  requireWalletSession,
  type WalletRouteBindings,
} from "./middleware.js";
import {
  createWalletChallenge,
  verifyWalletChallenge,
  type WalletAuthConfig,
} from "./wallet-auth.js";

export function createAuthRoutes(sql: Sql, config: WalletAuthConfig) {
  const routes = new Hono<WalletRouteBindings>();

  routes.post("/challenges", async (context) => {
    const challenge = await createWalletChallenge(
      sql,
      await context.req.json(),
      config,
    );
    return context.json(challenge, 201);
  });

  routes.post("/sessions", async (context) => {
    const session = await verifyWalletChallenge(
      sql,
      await context.req.json(),
      config,
    );
    return context.json(session, 201);
  });

  routes.get("/session", requireWalletSession(sql, config), (context) =>
    context.json(sessionView(context.get("wallet"))),
  );

  return routes;
}
