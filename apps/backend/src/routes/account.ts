import { Hono } from "hono";
import type { BackendEnv } from "../app-context.js";
import type { BackendAppServices } from "../app-context.js";

export function createAccountRoutes(services: BackendAppServices): Hono<BackendEnv> {
  const routes = new Hono<BackendEnv>();

  routes.get("/v1/me", (context) => {
    const account = context.get("account");
    return context.json({
      accountId: account.accountId,
      createdAt: account.createdAt,
    });
  });

  routes.get("/v1/quota", (context) => {
    const account = context.get("account");
    return context.json({
      accountId: account.accountId,
      quotaLimitTokens: account.quotaLimitTokens,
      quotaUsedTokens: account.quotaUsedTokens,
      quotaReservedTokens: services.modelGateway.getReservedTokens(account.accountId),
    });
  });

  return routes;
}
