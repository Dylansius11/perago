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
 * account and owner come from the wallet session, never from body fields, and
 * a refusal is a `409` reason code answered by the console's owner-paid path.
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
        owner: context.get("wallet").rootOwner,
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
        owner: context.get("wallet").rootOwner,
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
