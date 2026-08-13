import { Hono } from "hono";
import { ErrorCodes } from "@beecode/protocol";
import type { BackendAppServices, BackendEnv } from "../app-context.js";
import { sendApiError } from "../middleware/error-handler.js";

export function createCliAuthRoutes(services: BackendAppServices): Hono<BackendEnv> {
  const routes = new Hono<BackendEnv>();

  routes.post("/v1/auth/dev-token", async (context) => {
    if (
      services.config.devLoginSecret &&
      context.req.header("x-beecode-dev-secret") !== services.config.devLoginSecret
    ) {
      return sendApiError(
        context,
        403,
        ErrorCodes.FORBIDDEN,
        "Invalid development login secret",
      );
    }

    await validateOptionalJsonBody(context.req.raw);
    const account = services.store.createAccount(services.config.quotaLimitTokens);
    await services.store.flush();
    return context.json({
      token: account.token,
      accountId: account.accountId,
      quotaLimitTokens: account.quotaLimitTokens,
    });
  });

  return routes;
}

async function validateOptionalJsonBody(request: Request): Promise<void> {
  const raw = await request.text();
  if (raw.length === 0) return;
  try {
    JSON.parse(raw);
  } catch {
    throw new TypeError("Request body must contain valid JSON");
  }
}

