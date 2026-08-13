import type { CliConfig } from "../config.js";
import { refreshAccessToken } from "./browser-login.js";
import type { CredentialStore } from "./credential-store.js";

const EXPIRY_SKEW_MS = 30_000;

export async function ensureFreshCredentials(
  config: CliConfig,
  store: CredentialStore,
  fetchImpl: typeof fetch = fetch,
): Promise<CliConfig> {
  if (!config.refreshToken || !isNearExpiry(config.accessTokenExpiresAt)) return config;
  return rotateCredentials(config, store, fetchImpl);
}

export function createRefreshingFetch(
  initialConfig: CliConfig,
  store: CredentialStore,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  let currentConfig = initialConfig;
  let refreshInFlight: Promise<CliConfig> | undefined;

  const refreshingFetch: typeof fetch = async (input, init): Promise<Response> => {
    const original = new Request(input, init);
    const first = await fetchImpl(withAuthorization(original, currentConfig.token));
    if (first.status !== 401 || !currentConfig.refreshToken) return first;

    refreshInFlight ??= rotateCredentials(currentConfig, store, fetchImpl).finally(() => {
      refreshInFlight = undefined;
    });
    currentConfig = await refreshInFlight;
    return fetchImpl(withAuthorization(original, currentConfig.token));
  };
  return refreshingFetch;
}

async function rotateCredentials(
  config: CliConfig,
  store: CredentialStore,
  fetchImpl: typeof fetch,
): Promise<CliConfig> {
  if (!config.refreshToken) throw new Error("CLI login has no refresh token; run `beecode login` again");
  const tokens = await refreshAccessToken({
    backendUrl: config.backendUrl,
    refreshToken: config.refreshToken,
    fetchImpl,
  });
  const updated: CliConfig = {
    backendUrl: config.backendUrl,
    accountId: tokens.account_id,
    token: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1_000).toISOString(),
  };
  await store.save(updated);
  return updated;
}

function withAuthorization(request: Request, accessToken: string): Request {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  return new Request(request, { headers });
}

function isNearExpiry(expiresAt: string | undefined): boolean {
  return expiresAt !== undefined && Date.parse(expiresAt) <= Date.now() + EXPIRY_SKEW_MS;
}
