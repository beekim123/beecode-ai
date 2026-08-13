import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { BEECODE_CSRF_HEADER_NAME, ErrorCodes } from "@beecode/protocol";
import type { BackendAppServices, BackendEnv } from "../app-context.js";
import { createOAuthConsentToken, secretsMatch } from "../auth/crypto.js";
import { BROWSER_SESSION_COOKIE, requireBrowserAccount } from "../middleware/auth.js";
import { sendApiError } from "../middleware/error-handler.js";
import { isAllowedBrowserWriteRequest } from "../middleware/origin.js";

export function createOAuthRoutes(services: BackendAppServices): Hono<BackendEnv> {
  const routes = new Hono<BackendEnv>();
  routes.get("/oauth/authorize", (context) => {
    const requestUrl = new URL(context.req.url);
    const browserToken = getCookie(context, BROWSER_SESSION_COOKIE);
    const account = browserToken ? services.auth.getBrowserAccount(browserToken) : undefined;
    if (!browserToken || !account) {
      const loginUrl = new URL("/login", services.config.webOrigin);
      loginUrl.searchParams.set("returnTo", `${requestUrl.pathname}${requestUrl.search}`);
      return context.redirect(loginUrl.toString());
    }
    context.set("account", account);
    const input = readAuthorizationQuery(context.req.url);
    const client = services.oauthClients.validateAuthorizationRequest(
      input.clientId,
      input.redirectUri,
      input.challenge,
    );
    return context.html(renderConsent(input, client, createOAuthConsentToken(browserToken, input)));
  });

  routes.post(
    "/oauth/authorize",
    requireBrowserAccount(services.auth),
    async (context) => {
      const form = await context.req.parseBody();
      const input = readAuthorizationForm(form);
      const browserToken = getCookie(context, BROWSER_SESSION_COOKIE);
      const consentToken = optionalFormString(form, "consent_token");
      const isAllowedWriteRequest = isAllowedBrowserWriteRequest({
        csrfHeader: context.req.header(BEECODE_CSRF_HEADER_NAME),
        origin: context.req.header("origin"),
        webOrigin: services.config.webOrigin,
        requestUrl: context.req.url,
      });
      const hasValidConsentToken =
        browserToken !== undefined &&
        consentToken !== undefined &&
        secretsMatch(consentToken, createOAuthConsentToken(browserToken, input));
      if (!isAllowedWriteRequest && !hasValidConsentToken) {
        return sendApiError(context, 403, ErrorCodes.FORBIDDEN, "Request origin is not allowed");
      }
      services.oauthClients.validateAuthorizationRequest(
        input.clientId,
        input.redirectUri,
        input.challenge,
      );
      const redirect = new URL(input.redirectUri);
      redirect.searchParams.set("state", input.state);
      if (input.decision !== "allow") {
        redirect.searchParams.set("error", "access_denied");
        return context.redirect(redirect.toString());
      }
      const code = await services.tokens.createAuthorizationCode({
        accountId: context.get("account").accountId,
        clientId: input.clientId,
        redirectUri: input.redirectUri,
        challenge: input.challenge,
      });
      redirect.searchParams.set("code", code);
      return context.redirect(redirect.toString());
    },
  );
  routes.post("/oauth/token", async (context) => {
    const form = await context.req.parseBody();
    const grantType = requiredFormString(form, "grant_type");
    if (grantType === "authorization_code") {
      const tokens = await services.tokens.exchangeAuthorizationCode({
        code: requiredFormString(form, "code"),
        clientId: requiredFormString(form, "client_id"),
        redirectUri: requiredFormString(form, "redirect_uri"),
        verifier: requiredFormString(form, "code_verifier"),
      });
      return context.json(toOAuthResponse(tokens));
    }
    if (grantType === "refresh_token") {
      const tokens = await services.tokens.refresh(
        requiredFormString(form, "refresh_token"),
        requiredFormString(form, "client_id"),
      );
      return context.json(toOAuthResponse(tokens));
    }
    throw new TypeError("Unsupported OAuth grant_type");
  });

  routes.post("/oauth/revoke", async (context) => {
    const form = await context.req.parseBody();
    await services.tokens.revoke(
      requiredFormString(form, "token"),
      requiredFormString(form, "client_id"),
    );
    return context.body(null, 204);
  });

  return routes;
}

interface AuthorizationInput {
  clientId: string;
  redirectUri: string;
  challenge: string;
  state: string;
}

function readAuthorizationQuery(requestUrl: string): AuthorizationInput {
  const url = new URL(requestUrl);
  if (url.searchParams.get("response_type") !== "code") {
    throw new TypeError("OAuth response_type must be code");
  }
  if (url.searchParams.get("code_challenge_method") !== "S256") {
    throw new TypeError("OAuth code_challenge_method must be S256");
  }
  return {
    clientId: requiredSearchParam(url, "client_id"),
    redirectUri: requiredSearchParam(url, "redirect_uri"),
    challenge: requiredSearchParam(url, "code_challenge"),
    state: requiredSearchParam(url, "state"),
  };
}

function readAuthorizationForm(form: Record<string, string | File>): AuthorizationInput & { decision: string } {
  return {
    clientId: requiredFormString(form, "client_id"),
    redirectUri: requiredFormString(form, "redirect_uri"),
    challenge: requiredFormString(form, "code_challenge"),
    state: requiredFormString(form, "state"),
    decision: requiredFormString(form, "decision"),
  };
}

function optionalFormString(form: Record<string, string | File>, name: string): string | undefined {
  const value = form[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function renderConsent(
  input: AuthorizationInput,
  client: { displayName: string; consentTitle: string; consentDescription: string },
  consentToken: string,
): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权 ${escapeHtml(client.displayName)}</title><style>body{font-family:system-ui;background:#11151a;color:#eef2f5;display:grid;place-items:center;min-height:100vh;margin:0}.panel{width:min(28rem,calc(100% - 2rem));border:1px solid #34404b;background:#192027;padding:2rem;border-radius:10px}button{border:0;border-radius:6px;padding:.75rem 1rem;font-weight:650;cursor:pointer}.allow{background:#55d6a6;color:#07130f}.deny{background:#2b343d;color:#eef2f5;margin-left:.5rem}code{font-family:ui-monospace,monospace;color:#8edfc3}</style></head><body><main class="panel"><p><code>${escapeHtml(input.clientId)}</code></p><h1>${escapeHtml(client.consentTitle)}</h1><p>${escapeHtml(client.consentDescription)}</p><form method="post" action="/oauth/authorize">${hidden("client_id", input.clientId)}${hidden("redirect_uri", input.redirectUri)}${hidden("code_challenge", input.challenge)}${hidden("state", input.state)}${hidden("consent_token", consentToken)}<button class="allow" name="decision" value="allow">授权</button><button class="deny" name="decision" value="deny">拒绝</button></form></main></body></html>`;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function requiredSearchParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new TypeError(`OAuth ${name} is required`);
  return value;
}

function requiredFormString(form: Record<string, string | File>, name: string): string {
  const value = form[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`OAuth ${name} is required`);
  }
  return value;
}

function toOAuthResponse(tokens: {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  accountId: string;
}) {
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    token_type: tokens.tokenType,
    expires_in: tokens.expiresIn,
    account_id: tokens.accountId,
  };
}
