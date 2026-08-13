import { describe, expect, it } from "vitest";
import { ErrorCodes, type Page, type Session } from "@beecode/protocol";
import { createBackendApp } from "../src/app.js";
import { hashSecret, InMemoryBackendStore } from "../src/store.js";
import { FakeProviderAdapter } from "../src/provider/fake.js";

describe("iOS surface", () => {
  it("requires an iOS client token and isolates sessions from Web and CLI", async () => {
    const store = new InMemoryBackendStore();
    const app = createBackendApp(store, new FakeProviderAdapter(), {
      quotaLimitTokens: 10_000,
      webOrigin: "http://web.test",
      publicBaseUrl: "http://api.test",
    });
    const browserCookie = await browserLogin(app, "ios-surface@example.test");
    const me = await app.request("http://api.test/v1/me", {
      headers: { cookie: browserCookie },
    });
    const { accountId } = (await me.json()) as { accountId: string };
    const iosToken = "bca_ios-surface-token";
    store.putAccessToken({
      accountId,
      clientId: "beecode-ios",
      tokenHash: hashSecret(iosToken),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const cliToken = "bca_cli-surface-token";
    store.putAccessToken({
      accountId,
      clientId: "beecode-cli",
      tokenHash: hashSecret(cliToken),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const denied = await jsonRequest(app, "/v1/ios/sessions", cliToken, {
      method: "POST",
      body: JSON.stringify({ title: "must not exist" }),
    });
    expect(denied.status).toBe(401);

    const createdResponse = await jsonRequest(app, "/v1/ios/sessions", iosToken, {
      method: "POST",
      body: JSON.stringify({ title: "On device", surface: "web" }),
    });
    const created = (await createdResponse.json()) as Session;
    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({ accountId, surface: "ios", title: "On device" });

    const listed = await jsonRequest(app, "/v1/ios/sessions", iosToken);
    expect(((await listed.json()) as Page<Session>).items.map((session) => session.id)).toEqual([
      created.id,
    ]);

    const cliRead = await jsonRequest(app, `/v1/cli/sessions/${created.id}`, cliToken);
    expect(cliRead.status).toBe(404);
    expect(((await cliRead.json()) as { error: { code: string } }).error.code).toBe(
      ErrorCodes.SESSION_NOT_FOUND,
    );

    const iosCannotUseCli = await jsonRequest(app, "/v1/cli/sessions", iosToken);
    expect(iosCannotUseCli.status).toBe(401);
    const iosCannotUseModelGateway = await jsonRequest(app, "/v1/model/stream", iosToken, {
      method: "POST",
      body: JSON.stringify({ messages: [], tools: [] }),
    });
    expect(iosCannotUseModelGateway.status).toBe(401);

    const webRead = await app.request(`http://api.test/v1/web/sessions/${created.id}`, {
      headers: { cookie: browserCookie },
    });
    expect(webRead.status).toBe(404);
  });

  it("publishes iOS capabilities with backend runtime ownership", async () => {
    const store = new InMemoryBackendStore();
    const account = store.createAccount(10_000);
    const iosToken = "bca_ios-capability-token";
    store.putAccessToken({
      accountId: account.accountId,
      clientId: "beecode-ios",
      tokenHash: hashSecret(iosToken),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const app = createBackendApp(store, new FakeProviderAdapter(), { quotaLimitTokens: 10_000 });

    const response = await jsonRequest(app, "/v1/ios/capabilities", iosToken);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ surface: "ios", runtimeLocation: "backend" });
  });
});

async function browserLogin(app: ReturnType<typeof createBackendApp>, subject: string): Promise<string> {
  const started = await app.request(
    `http://api.test/v1/auth/login/development?loginHint=${encodeURIComponent(subject)}`,
  );
  const callback = await app.request(started.headers.get("location") ?? "");
  return callback.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

function jsonRequest(
  app: ReturnType<typeof createBackendApp>,
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("content-type", "application/json");
  return Promise.resolve(app.request(`http://api.test${path}`, { ...init, headers }));
}
