import { Hono } from "hono";
import type { Sql } from "postgres";

import {
  requireWalletSession,
  type WalletRouteBindings,
} from "../auth/middleware.js";
import type { WalletAuthConfig } from "../auth/wallet-auth.js";
import {
  confirmPolicyActivation,
  confirmPolicyRevocation,
  createWalletPolicy,
  type PolicyChainVerifier,
  type PolicyServiceConfig,
  preparePolicyActivation,
  preparePolicyRevocation,
} from "../services/policies.js";
import { listPolicies } from "../services/views.js";

export function createPolicyRoutes(input: {
  authConfig: WalletAuthConfig;
  policyConfig: PolicyServiceConfig;
  policyVerifier: PolicyChainVerifier;
  sql: Sql;
}) {
  const routes = new Hono<WalletRouteBindings>();

  routes.use("*", requireWalletSession(input.sql, input.authConfig));

  routes.get("/", async (context) =>
    context.json(await listPolicies(input.sql, context.get("wallet"))),
  );

  routes.post("/", async (context) => {
    const created = await createWalletPolicy(
      input.sql,
      context.get("wallet"),
      await context.req.json(),
    );
    return context.json(created, 201);
  });

  routes.post("/:policyId/activation/prepare", async (context) => {
    const prepared = await preparePolicyActivation(
      input.sql,
      context.get("wallet"),
      context.req.param("policyId"),
      await context.req.json(),
      input.policyConfig,
    );
    return context.json({
      accountPolicy: prepared.accountPolicy,
      permissionCallData: prepared.permissionCallData,
      permissionHash: prepared.permissionHash,
      policyHash: prepared.policyHash,
    });
  });

  routes.put("/:policyId/activation", async (context) => {
    const result = await confirmPolicyActivation(
      input.sql,
      context.get("wallet"),
      context.req.param("policyId"),
      await context.req.json(),
      input.policyConfig,
      input.policyVerifier,
    );
    return context.json(result);
  });

  routes.post("/:policyId/revocation/prepare", async (context) => {
    const prepared = await preparePolicyRevocation(
      input.sql,
      context.get("wallet"),
      context.req.param("policyId"),
      await context.req.json(),
      input.policyConfig,
    );
    return context.json({
      accountPolicy: prepared.accountPolicy,
      permissionCallData: prepared.permissionCallData,
      permissionHash: prepared.permissionHash,
      revocationHash: prepared.revocationHash,
    });
  });

  routes.put("/:policyId/revocation", async (context) => {
    const result = await confirmPolicyRevocation(
      input.sql,
      context.get("wallet"),
      context.req.param("policyId"),
      await context.req.json(),
      input.policyConfig,
      input.policyVerifier,
    );
    return context.json(result);
  });

  return routes;
}
