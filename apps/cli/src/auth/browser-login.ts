import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import type { Writable } from "node:stream";
import { createLoopbackCallback, type LoopbackCallback } from "./loopback-callback.js";
import type { CredentialStore } from "./credential-store.js";

const OAUTH_CLIENT_ID = "beecode-cli";

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  account_id: string;
}

export interface BrowserLoginOptions {
  backendUrl: string;
  credentialStore: CredentialStore;
  output: Writable;
  fetchImpl?: typeof fetch;
  openBrowser?: (url: string) => Promise<boolean>;
  createCallback?: typeof createLoopbackCallback;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function loginWithBrowser(options: BrowserLoginOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const verifier = randomBytes(48).toString("base64url");
  const challenge = await pkceChallenge(verifier);
  const state = randomBytes(32).toString("base64url");
  const callbackFactory = options.createCallback ?? createLoopbackCallback;
  const callback = await callbackFactory({
    state,
    timeoutMs: options.timeoutMs ?? 2 * 60 * 1_000,
    signal: options.signal,
  });

  try {
    const authorizationUrl = new URL("/oauth/authorize", options.backendUrl);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", OAUTH_CLIENT_ID);
    authorizationUrl.searchParams.set("redirect_uri", callback.redirectUri);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("state", state);
    const href = authorizationUrl.toString();
    const opened = await (options.openBrowser ?? openSystemBrowser)(href);
    options.output.write(opened ? "Opened your browser for authorization.\n" : `Open this URL to authorize:\n${href}\n`);

    const code = await callback.waitForCode();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: OAUTH_CLIENT_ID,
      redirect_uri: callback.redirectUri,
      code_verifier: verifier,
    });
    const response = await fetchImpl(new URL("/oauth/token", options.backendUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokens = await parseTokenResponse(response);
    await options.credentialStore.save({
      backendUrl: options.backendUrl.replace(/\/$/, ""),
      token: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accountId: tokens.account_id,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1_000).toISOString(),
    });
    options.output.write(`Logged in to ${options.backendUrl}\nAccount: ${tokens.account_id}\n`);
  } finally {
    await callback.close();
  }
}

export async function refreshAccessToken(options: {
  backendUrl: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<OAuthTokenResponse> {
  const response = await (options.fetchImpl ?? fetch)(new URL("/oauth/token", options.backendUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: options.refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }),
  });
  return parseTokenResponse(response);
}

export async function revokeRefreshToken(options: {
  backendUrl: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const response = await (options.fetchImpl ?? fetch)(new URL("/oauth/revoke", options.backendUrl), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: options.refreshToken, client_id: OAUTH_CLIENT_ID }),
  });
  if (!response.ok) throw new Error(`Token revocation failed (HTTP ${response.status})`);
}

export async function openSystemBrowser(url: string): Promise<boolean> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
  });
}

async function pkceChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("base64url");
}

async function parseTokenResponse(response: Response): Promise<OAuthTokenResponse> {
  if (!response.ok) throw new Error(`OAuth token request failed (HTTP ${response.status})`);
  const value: unknown = await response.json();
  if (!isRecord(value)) throw new Error("OAuth token response is invalid");
  if (
    typeof value.access_token !== "string" ||
    typeof value.refresh_token !== "string" ||
    value.token_type !== "Bearer" ||
    !Number.isInteger(value.expires_in) ||
    typeof value.account_id !== "string"
  ) {
    throw new Error("OAuth token response is invalid");
  }
  return value as unknown as OAuthTokenResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
