import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopAuthStatus } from "../../src/preload/api.js";
import type { DesktopTokens } from "../../src/main/credential-store.js";
import { AuthManager } from "../../src/main/auth-manager.js";

const NOW = new Date("2026-08-17T08:00:00.000Z");

describe("AuthManager token refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes before expiry and publishes the replacement access token", async () => {
    const credentials = new FakeCredentialStore(expiringTokens());
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse("replacement"));
    const auth = createAuth(credentials, fetchImpl);
    const notifications: Array<{ status: DesktopAuthStatus; accessToken?: string }> = [];
    auth.onStatus((status, accessToken) => notifications.push({ status, accessToken }));

    await auth.initialize();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await requestBody(fetchImpl)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh_initial",
      client_id: "beecode-desktop",
    });
    expect(credentials.saved?.accessToken).toBe("access_replacement");
    expect(notifications.at(-1)).toMatchObject({
      status: { state: "authenticated" },
      accessToken: "access_replacement",
    });
  });

  it("deduplicates concurrent refresh requests", async () => {
    const credentials = new FakeCredentialStore(expiringTokens());
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(() => new Promise((resolve) => {
      resolveResponse = resolve;
    }));
    const auth = createAuth(credentials, fetchImpl);

    await auth.initialize();
    vi.setSystemTime(NOW.getTime() + 1_000);
    const first = auth.getAccessToken();
    await vi.waitFor(() => expect(resolveResponse).toBeTypeOf("function"));
    const second = auth.getAccessToken();
    resolveResponse?.(tokenResponse("deduplicated"));

    await expect(Promise.all([first, second])).resolves.toEqual([
      "access_deduplicated",
      "access_deduplicated",
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("clears credentials and withholds the old token when refresh fails", async () => {
    const credentials = new FakeCredentialStore(expiringTokens());
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({
        error: {
          code: "TOKEN_REVOKED",
          message: "Refresh token was revoked",
          retryable: false,
        },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    ));
    const auth = createAuth(credentials, fetchImpl);
    const notifications: Array<{ status: DesktopAuthStatus; accessToken?: string }> = [];
    auth.onStatus((status, accessToken) => notifications.push({ status, accessToken }));

    await auth.initialize();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(credentials.cleared).toBe(true);
    expect(auth.getStatus()).toMatchObject({
      state: "error",
      error: { code: "TOKEN_REVOKED" },
    });
    expect(notifications.at(-1)?.accessToken).toBeUndefined();
    await expect(auth.getAccessToken()).resolves.toBeUndefined();
  });

  it("does not restore authentication when an in-flight refresh settles after logout", async () => {
    const credentials = new FakeCredentialStore({
      ...expiringTokens(),
      expiresAt: NOW.getTime(),
    });
    let resolveRefresh: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((input) => {
      if (String(input).endsWith("/oauth/revoke")) return Promise.resolve(new Response(null, { status: 204 }));
      return new Promise((resolve) => {
        resolveRefresh = resolve;
      });
    });
    const auth = createAuth(credentials, fetchImpl);

    const initialized = auth.initialize();
    await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf("function"));
    await auth.logout();
    resolveRefresh?.(tokenResponse("stale"));
    await initialized;

    expect(auth.getStatus().state).toBe("unauthenticated");
    expect(credentials.saved).toBeUndefined();
    await expect(auth.getAccessToken()).resolves.toBeUndefined();
  });
});

class FakeCredentialStore {
  readonly persistence = "encrypted" as const;
  saved: DesktopTokens | undefined;
  cleared = false;

  constructor(private tokens: DesktopTokens | undefined) {}

  load(): Promise<DesktopTokens | undefined> {
    return Promise.resolve(this.tokens ? structuredClone(this.tokens) : undefined);
  }

  save(tokens: DesktopTokens): Promise<void> {
    this.tokens = structuredClone(tokens);
    this.saved = structuredClone(tokens);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.tokens = undefined;
    this.cleared = true;
    return Promise.resolve();
  }
}

function createAuth(credentials: FakeCredentialStore, fetchImpl: typeof fetch): AuthManager {
  return new AuthManager({
    backendUrl: "http://backend.test",
    credentials,
    fetchImpl,
    openExternal: () => Promise.resolve(),
  });
}

function expiringTokens(): DesktopTokens {
  return {
    accessToken: "access_initial",
    refreshToken: "refresh_initial",
    expiresAt: NOW.getTime() + 61_000,
    accountId: "account_desktop",
  };
}

function tokenResponse(suffix: string): Response {
  return new Response(JSON.stringify({
    access_token: `access_${suffix}`,
    refresh_token: `refresh_${suffix}`,
    expires_in: 900,
    account_id: "account_desktop",
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function requestBody(fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>): Promise<Record<string, string>> {
  const init = fetchImpl.mock.calls[0]?.[1];
  if (!(init?.body instanceof URLSearchParams)) throw new TypeError("Expected URLSearchParams");
  return Object.fromEntries(init.body.entries());
}
