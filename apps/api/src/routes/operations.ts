import {
  estimateUserOperationRequestSchema,
  hashSchema,
  submitUserOperationRequestSchema,
} from "@perago/sdk";
import { Hono } from "hono";
import type { Sql } from "postgres";

import {
  requireWalletSession,
  type WalletRouteBindings,
} from "../auth/middleware.js";
import type { WalletAuthConfig } from "../auth/wallet-auth.js";
import type { SponsorshipService } from "../services/sponsorship.js";

/**
 * Sponsored root operations for the signed-in wallet's own smart account. The
 * sender always comes from the wallet session, never from the body, and a
 * refusal is a `409` reason code the console answers with the owner-paid path.
 */
export function createOperationRoutes(input: {
  authConfig: WalletAuthConfig;
  sponsorship: SponsorshipService;
  sql: Sql;
}) {
  const routes = new Hono<WalletRouteBindings>();
  routes.use("*", requireWalletSession(input.sql, input.authConfig));

  routes.post("/estimate", async (context) => {
    const request = estimateUserOperationRequestSchema.parse(
      await context.req.json(),
    );
    return context.json(
      await input.sponsorship.estimate({
        account: context.get("wallet").account,
        callData: request.callData,
        nonce: BigInt(request.nonce),
      }),
    );
  });
  routes.post("/", async (context) => {
    const userOperation = submitUserOperationRequestSchema.parse(
      await context.req.json(),
    );
    return context.json(
      await input.sponsorship.submit({
        account: context.get("wallet").account,
        userOperation,
      }),
      202,
    );
  });
  routes.get("/:userOperationHash", async (context) =>
    context.json(
      await input.sponsorship.status(
        hashSchema.parse(context.req.param("userOperationHash")),
      ),
    ),
  );
  return routes;
}
