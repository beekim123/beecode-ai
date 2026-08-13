import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BEECODE_CSRF_HEADER_NAME,
  BEECODE_CSRF_HEADER_VALUE,
  ErrorCodes,
} from "@beecode/protocol";
import { createBackendApp } from "../src/app.js";
import { FakeProviderAdapter } from "../src/provider/fake.js";
import { InMemoryBackendStore } from "../src/store.js";

function createHarness() {
  const store = new InMemoryBackendStore();
  const app = createBackendApp(store, new FakeProviderAdapter(), {
    quotaLimitTokens: 10_000,
    webOrigin: "http://web.test",
    publicBaseUrl: "http://api.test",
  });
  return { app, store };
}

async function browserLogin(app: ReturnType<typeof createBackendApp>, loginHint: string) {
  const started = await app.request(
    `http://api.test/v1/auth/login/development?returnTo=%2Fapp&loginHint=${encodeURIComponent(loginHint)}`,
  );
  expect(started.status).toBe(302);
  const callbackUrl = started.headers.get("location");
  if (!callbackUrl) throw new Error("Expected identity callback redirect");
  const callback = await app.request(callbackUrl);
  expect(callback.status).toBe(302);
  const setCookie = callback.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected browser session cookie");
  return setCookie.split(";", 1)[0] ?? "";
}

describe("browser and CLI authorization", () => {
  it("restores a stable browser account and revokes the cookie on logout", async () => {
    const { app } = createHarness();
    const cookieA = await browserLogin(app, "same-user@example.test");
    const meA = await app.request("http://api.test/v1/me", { headers: { cookie: cookieA } });
    expect(meA.status).toBe(200);
    const accountA = (await meA.json()) as { accountId: string };

    const cookieB = await browserLogin(app, "same-user@example.test");
    const meB = await app.request("http://api.test/v1/me", { headers: { cookie: cookieB } });
    expect((await meB.json()) as { accountId: string }).toEqual(accountA);

    const logout = await app.request("http://api.test/v1/auth/logout", {
      method: "POST",
      headers: { cookie: cookieA, origin: "http://web.test" },
    });
    expect(logout.status).toBe(204);
    const denied = await app.request("http://api.test/v1/me", { headers: { cookie: cookieA } });
    expect(denied.status).toBe(401);
  });

  it("accepts an equivalent loopback origin when logging out in development", async () => {
    const store = new InMemoryBackendStore();
    const app = createBackendApp(store, new FakeProviderAdapter(), {
      quotaLimitTokens: 10_000,
      webOrigin: "http://localhost:5173",
      publicBaseUrl: "http://127.0.0.1:8787",
    });
    const cookie = await browserLogin(app, "loopback-user@example.test");

    const logout = await app.request("http://127.0.0.1:8787/v1/auth/logout", {
      method: "POST",
      headers: { cookie, origin: "http://127.0.0.1:5173" },
    });

    expect(logout.status).toBe(204);
  });

  it("accepts the explicit CSRF header when logout Origin is rewritten", async () => {
    const { app } = createHarness();
    const cookie = await browserLogin(app, "rewritten-origin@example.test");

    const logout = await app.request("http://api.test/v1/auth/logout", {
      method: "POST",
      headers: {
        cookie,
        origin: "chrome-extension://invalid",
        [BEECODE_CSRF_HEADER_NAME]: BEECODE_CSRF_HEADER_VALUE,
      },
    });

    expect(logout.status).toBe(204);
  });

  it("exchanges a one-time PKCE code and rotates refresh tokens", async () => {
    const { app } = createHarness();
    const cookie = await browserLogin(app, "cli-user@example.test");
    const verifier = "v".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUri = "http://127.0.0.1:49152/callback";
    const authorizeUrl = new URL("http://web.test/oauth/authorize");
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: "beecode-cli",
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "cli-state",
    }).toString();

    const signInRequired = await app.request(authorizeUrl);
    expect(signInRequired.status).toBe(302);
    const signInUrl = new URL(signInRequired.headers.get("location") ?? "");
    expect(signInUrl.origin).toBe("http://web.test");
    expect(signInUrl.pathname).toBe("/login");
    expect(signInUrl.searchParams.get("returnTo")).toBe(
      `${authorizeUrl.pathname}${authorizeUrl.search}`,
    );

    const consent = await app.request(authorizeUrl, { headers: { cookie } });
    expect(consent.status).toBe(200);
    expect(await consent.text()).toContain("授权此命令行客户端？");

    const directConsent = await app.request(authorizeUrl.toString().replace("http://web.test", "http://api.test"), {
      headers: { cookie },
    });
    expect(directConsent.status).toBe(200);
    expect(await directConsent.text()).toContain("授权此命令行客户端？");

    const accepted = await app.request("http://api.test/oauth/authorize", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://web.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "beecode-cli",
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state: "cli-state",
        decision: "allow",
      }),
    });
    expect(accepted.status).toBe(302);
    const callback = new URL(accepted.headers.get("location") ?? "");
    expect(callback.searchParams.get("state")).toBe("cli-state");
    const code = callback.searchParams.get("code");
    if (!code) throw new Error("Expected authorization code");

    const exchanged = await exchangeCode(app, { code, verifier, redirectUri });
    expect(exchanged.status).toBe(200);
    const firstTokens = (await exchanged.json()) as OAuthTokens;
    expect(firstTokens.access_token).toMatch(/^bca_/);

    const reusedCode = await exchangeCode(app, { code, verifier, redirectUri });
    expect(reusedCode.status).toBe(403);

    const refreshed = await app.request("http://api.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: firstTokens.refresh_token,
        client_id: "beecode-cli",
      }),
    });
    expect(refreshed.status).toBe(200);
    const secondTokens = (await refreshed.json()) as OAuthTokens;
    expect(secondTokens.refresh_token).not.toBe(firstTokens.refresh_token);

    const reuse = await app.request("http://api.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: firstTokens.refresh_token,
        client_id: "beecode-cli",
      }),
    });
    expect(reuse.status).toBe(401);
    expect(((await reuse.json()) as { error: { code: string } }).error.code).toBe(ErrorCodes.TOKEN_REVOKED);

    const familyRevoked = await app.request("http://api.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: secondTokens.refresh_token,
        client_id: "beecode-cli",
      }),
    });
    expect(familyRevoked.status).toBe(401);
  });

  it("rejects verifier and redirect mismatches", async () => {
    const { app } = createHarness();
    const cookie = await browserLogin(app, "pkce-errors@example.test");
    const verifier = "z".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const response = await app.request("http://api.test/oauth/authorize", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://web.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "beecode-cli",
        redirect_uri: "http://127.0.0.1:49153/callback",
        code_challenge: challenge,
        state: "error-state",
        decision: "allow",
      }),
    });
    const code = new URL(response.headers.get("location") ?? "").searchParams.get("code") ?? "";
    const invalid = await exchangeCode(app, {
      code,
      verifier: "wrong".repeat(16),
      redirectUri: "http://127.0.0.1:49153/callback",
    });
    expect(invalid.status).toBe(403);
  });

  it("accepts a rendered consent form when an intermediary rewrites Origin", async () => {
    const { app } = createHarness();
    const cookie = await browserLogin(app, "rewritten-consent@example.test");
    const verifier = "r".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUri = "http://127.0.0.1:49154/callback";
    const authorizeUrl = new URL("http://web.test/oauth/authorize");
    authorizeUrl.search = new URLSearchParams({
      response_type: "code",
      client_id: "beecode-cli",
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "rewritten-consent-state",
    }).toString();
    const consent = await app.request(authorizeUrl, { headers: { cookie } });
    expect(consent.status).toBe(200);
    const consentToken = extractHiddenInput(await consent.text(), "consent_token");

    const accepted = await app.request("http://api.test/oauth/authorize", {
      method: "POST",
      headers: {
        cookie,
        origin: "chrome-extension://rewritten",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "beecode-cli",
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state: "rewritten-consent-state",
        consent_token: consentToken,
        decision: "allow",
      }),
    });

    expect(accepted.status).toBe(302);

    const forged = await app.request("http://api.test/oauth/authorize", {
      method: "POST",
      headers: {
        cookie,
        origin: "chrome-extension://rewritten",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "beecode-cli",
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state: "rewritten-consent-state",
        consent_token: "forged",
        decision: "allow",
      }),
    });

    expect(forged.status).toBe(403);
  });

  it("issues iOS-bound tokens only for the exact registered callback", async () => {
    const { app } = createHarness();
    const cookie = await browserLogin(app, "ios-oauth@example.test");
    const verifier = "i".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirectUri = "ai.beecode.ios://oauth/callback";
    const accepted = await app.request("http://api.test/oauth/authorize", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://web.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "beecode-ios",
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state: "ios-state",
        decision: "allow",
      }),
    });
    expect(accepted.status).toBe(302);
    const callback = new URL(accepted.headers.get("location") ?? "");
    expect(callback.protocol).toBe("ai.beecode.ios:");
    const code = callback.searchParams.get("code") ?? "";
    const exchanged = await exchangeCode(app, {
      code,
      verifier,
      redirectUri,
      clientId: "beecode-ios",
    });
    expect(exchanged.status).toBe(200);
    const tokens = (await exchanged.json()) as OAuthTokens;

    const wrongClientRefresh = await app.request("http://api.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        client_id: "beecode-cli",
      }),
    });
    expect(wrongClientRefresh.status).toBe(403);

    const wrongRedirect = await app.request("http://api.test/oauth/authorize", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://web.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "beecode-ios",
        redirect_uri: "ai.beecode.ios://oauth/other",
        code_challenge: challenge,
        state: "wrong-redirect",
        decision: "allow",
      }),
    });
    expect(wrongRedirect.status).toBe(403);
  });
});

interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  account_id: string;
}

function extractHiddenInput(html: string, name: string): string {
  const match = new RegExp(`<input type="hidden" name="${name}" value="([^"]+)">`).exec(html);
  if (!match?.[1]) throw new Error(`Expected ${name} hidden input`);
  return match[1];
}

function exchangeCode(
  app: ReturnType<typeof createBackendApp>,
  input: { code: string; verifier: string; redirectUri: string; clientId?: string },
): Promise<Response> {
  return Promise.resolve(
    app.request("http://api.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: input.clientId ?? "beecode-cli",
        redirect_uri: input.redirectUri,
        code_verifier: input.verifier,
      }),
    }),
  );
}
