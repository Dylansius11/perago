import { Hono } from "hono";
import type { Sql } from "postgres";

import {
  authenticateWalletSession,
  type WalletAuthConfig,
  type WalletIdentity,
} from "../auth/wallet-auth.js";
import {
  confirmPolicyActivation,
  confirmPolicyRevocation,
  createWalletPolicy,
  type PolicyChainVerifier,
  type PolicyServiceConfig,
  preparePolicyActivation,
  preparePolicyRevocation,
} from "../services/policies.js";

type PolicyRouteBindings = {
  Variables: {
    wallet: WalletIdentity;
  };
};

export function createPolicyRoutes(input: {
  authConfig: WalletAuthConfig;
  policyConfig: PolicyServiceConfig;
  policyVerifier: PolicyChainVerifier;
  sql: Sql;
}) {
  const routes = new Hono<PolicyRouteBindings>();

  routes.use("*", async (context, next) => {
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
        await authenticateWalletSession(
          input.sql,
          match[1],
          input.authConfig.now(),
        ),
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
