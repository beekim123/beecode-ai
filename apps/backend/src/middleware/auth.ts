import { createMiddleware } from "hono/factory";
import { ErrorCodes } from "@beecode/protocol";
import type { BackendEnv } from "../app-context.js";
import type { BackendStore } from "../store.js";
import type { AuthService } from "../auth/auth-service.js";
import { getCookie } from "hono/cookie";
import { sendApiError } from "./error-handler.js";

export const BROWSER_SESSION_COOKIE = "beecode_session";

export function requireAccount(
  store: BackendStore,
  clientIds?: string | readonly string[],
) {
  return createMiddleware<BackendEnv>(async (context, next) => {
    const authorization = context.req.header("authorization");
    const allowedClientIds = typeof clientIds === "string" ? [clientIds] : clientIds;
    const account = authorization?.startsWith("Bearer ")
      ? allowedClientIds
        ? allowedClientIds
            .map((clientId) =>
              store.findAccountByClientToken(authorization.slice("Bearer ".length), clientId),
            )
            .find((candidate) => candidate !== undefined)
        : store.findAccountByToken(authorization.slice("Bearer ".length))
      : undefined;
    if (!account) {
      return sendApiError(
        context,
        401,
        ErrorCodes.UNAUTHENTICATED,
        allowedClientIds?.includes("beecode-ios")
          ? "Missing, expired, or non-iOS Beecode token"
          : "Missing or invalid Beecode token; run `beecode login`",
      );
    }

    context.set("account", account);
    await next();
  });
}

export function requireBrowserAccount(auth: AuthService) {
  return createMiddleware<BackendEnv>(async (context, next) => {
    const token = getCookie(context, BROWSER_SESSION_COOKIE);
    const account = token ? auth.getBrowserAccount(token) : undefined;
    if (!account) {
      return sendApiError(context, 401, ErrorCodes.UNAUTHENTICATED, "Browser session is missing or expired");
    }
    context.set("account", account);
    await next();
  });
}

export function requireAnyAccount(store: BackendStore, auth: AuthService) {
  return createMiddleware<BackendEnv>(async (context, next) => {
    const authorization = context.req.header("authorization");
    const bearerAccount = authorization?.startsWith("Bearer ")
      ? store.findAccountByToken(authorization.slice("Bearer ".length))
      : undefined;
    const browserToken = getCookie(context, BROWSER_SESSION_COOKIE);
    const account = bearerAccount ?? (browserToken ? auth.getBrowserAccount(browserToken) : undefined);
    if (!account) {
      return sendApiError(context, 401, ErrorCodes.UNAUTHENTICATED, "Authentication is required");
    }
    context.set("account", account);
    await next();
  });
}
