import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { BackendAppServices, BackendEnv } from "../app-context.js";
import { BROWSER_SESSION_COOKIE, requireBrowserAccount } from "../middleware/auth.js";
import { requireAllowedOrigin } from "../middleware/origin.js";

export function createBrowserAuthRoutes(services: BackendAppServices): Hono<BackendEnv> {
  const routes = new Hono<BackendEnv>();

  routes.get("/v1/auth/login/:provider", async (context) => {
    const provider = context.req.param("provider");
    const callbackUrl = new URL(
      `/v1/auth/callback/${encodeURIComponent(provider)}`,
      services.config.publicBaseUrl,
    );
    const authorizationUrl = services.auth.beginBrowserLogin({
      provider,
      callbackUrl: callbackUrl.toString(),
      returnTo: context.req.query("returnTo") ?? "/app",
      loginHint: context.req.query("loginHint"),
    });
    await services.store.flush();
    return context.redirect(authorizationUrl);
  });

  routes.get("/v1/auth/callback/:provider", async (context) => {
    const code = context.req.query("code");
    const state = context.req.query("state");
    if (!code || !state) throw new TypeError("Identity callback requires code and state");
    const result = await services.auth.completeBrowserLogin({
      provider: context.req.param("provider"),
      code,
      state,
    });
    setCookie(context, BROWSER_SESSION_COOKIE, result.browserSessionToken, {
      httpOnly: true,
      secure: services.config.cookieSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: services.config.browserSessionTtlSeconds,
    });
    return context.redirect(new URL(result.returnTo, services.config.webOrigin).toString());
  });

  routes.post(
    "/v1/auth/logout",
    requireBrowserAccount(services.auth),
    requireAllowedOrigin(services.config.webOrigin),
    async (context) => {
      const token = getCookie(context, BROWSER_SESSION_COOKIE);
      if (token) await services.auth.logout(token);
      deleteCookie(context, BROWSER_SESSION_COOKIE, {
        path: "/",
        secure: services.config.cookieSecure,
      });
      return context.body(null, 204);
    },
  );

  return routes;
}
