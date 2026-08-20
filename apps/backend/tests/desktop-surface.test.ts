import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ErrorCodes,
  type Message,
  type Page,
  type Session,
  type SessionSnapshot,
  type Turn,
} from "@beecode/protocol";
import { createBackendApp } from "../src/app.js";
import { FakeProviderAdapter } from "../src/provider/fake.js";
import { hashSecret, InMemoryBackendStore } from "../src/store.js";

const desktopRedirectUri = "ai.beecode.desktop://oauth/callback";

describe("Desktop OAuth client", () => {
  it("issues Desktop-bound tokens only for the exact registered callback", async () => {
    const store = new InMemoryBackendStore();
    const app = createBackendApp(store, new FakeProviderAdapter(), {
      quotaLimitTokens: 10_000,
      webOrigin: "http://web.test",
      publicBaseUrl: "http://api.test",
      desktopOAuthRedirectUri: desktopRedirectUri,
    });
    const cookie = await browserLogin(app, "desktop-oauth@example.test");
    const verifier = "d".repeat(64);
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    const accepted = await authorizeDesktop(app, cookie, challenge, desktopRedirectUri);
    expect(accepted.status).toBe(302);
    const callback = new URL(accepted.headers.get("location") ?? "");
    expect(`${callback.protocol}//${callback.host}${callback.pathname}`).toBe(desktopRedirectUri);

    const exchanged = await app.request("http://api.test/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code") ?? "",
        client_id: "beecode-desktop",
        redirect_uri: desktopRedirectUri,
        code_verifier: verifier,
      }),
    });
    expect(exchanged.status).toBe(200);
    const tokens = (await exchanged.json()) as { access_token: string; refresh_token: string };

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

    for (const invalidRedirect of [
      "ai.beecode.desktop://oauth/other",
      "ai.beecode.desktop://other/callback",
      "ai.beecode.desktop://oauth/callback?next=web",
      "https://oauth/callback",
    ]) {
      const denied = await authorizeDesktop(app, cookie, challenge, invalidRedirect);
      expect(denied.status).toBe(403);
    }
  });
});

describe("Desktop surface", () => {
  it("fixes the server-owned surface and isolates accounts and clients", async () => {
    const store = new InMemoryBackendStore();
    const accountA = store.createAccount(10_000);
    const accountB = store.createAccount(10_000);
    const desktopTokenA = putClientToken(store, accountA.accountId, "beecode-desktop", "desktop-a");
    const desktopTokenB = putClientToken(store, accountB.accountId, "beecode-desktop", "desktop-b");
    const iosToken = putClientToken(store, accountA.accountId, "beecode-ios", "ios-a");
    const app = createBackendApp(store, new FakeProviderAdapter(), { quotaLimitTokens: 10_000 });

    const deniedClient = await jsonRequest(app, "/v1/desktop/sessions", iosToken);
    expect(deniedClient.status).toBe(401);

    const createdResponse = await jsonRequest(app, "/v1/desktop/sessions", desktopTokenA, {
      method: "POST",
      body: JSON.stringify({ title: "Desktop", surface: "web", accountId: accountB.accountId }),
    });
    const created = (await createdResponse.json()) as Session;
    expect(createdResponse.status).toBe(201);
    expect(created).toMatchObject({
      title: "Desktop",
      surface: "desktop",
      accountId: accountA.accountId,
    });

    const listed = await jsonRequest(app, "/v1/desktop/sessions", desktopTokenA);
    expect(((await listed.json()) as Page<Session>).items.map((session) => session.id)).toEqual([
      created.id,
    ]);

    const otherAccountRead = await jsonRequest(
      app,
      `/v1/desktop/sessions/${created.id}`,
      desktopTokenB,
    );
    expect(otherAccountRead.status).toBe(404);
    expect(((await otherAccountRead.json()) as { error: { code: string } }).error.code).toBe(
      ErrorCodes.SESSION_NOT_FOUND,
    );

    const cliRead = await jsonRequest(app, `/v1/cli/sessions/${created.id}`, accountA.token);
    expect(cliRead.status).toBe(404);
    const desktopCannotUseCli = await jsonRequest(app, "/v1/cli/sessions", desktopTokenA);
    expect(desktopCannotUseCli.status).toBe(401);

    const modelResponse = await jsonRequest(app, "/v1/model/stream", desktopTokenA, {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "1+1" }], tools: [] }),
    });
    expect(modelResponse.status).toBe(200);

    const capabilities = await jsonRequest(app, "/v1/desktop/capabilities", desktopTokenA);
    expect(await capabilities.json()).toMatchObject({
      surface: "desktop",
      allowedTools: ["calculator", "read_file"],
      allowedFeatures: { localWorkspace: true },
    });
  });

  it("enforces versioned snapshot ownership and interrupted recovery", async () => {
    const store = new InMemoryBackendStore();
    const account = store.createAccount(10_000);
    const desktopToken = putClientToken(store, account.accountId, "beecode-desktop", "snapshot");
    const app = createBackendApp(store, new FakeProviderAdapter(), { quotaLimitTokens: 10_000 });
    const createdResponse = await jsonRequest(app, "/v1/desktop/sessions", desktopToken, {
      method: "POST",
      body: JSON.stringify({ title: "Recovery" }),
    });
    const session = (await createdResponse.json()) as Session;
    const queued = createQueuedSnapshot(session);

    const saved = await replaceSnapshot(app, desktopToken, session, "runtime_1", queued);
    expect(saved.status).toBe(200);
    const versionTwo = (await saved.json()) as Session;
    expect(versionTwo.version).toBe(2);

    const foreignRuntime = await replaceSnapshot(
      app,
      desktopToken,
      versionTwo,
      "runtime_2",
      interruptedSnapshot(queued),
    );
    expect(foreignRuntime.status).toBe(409);

    const recovered = await replaceSnapshot(
      app,
      desktopToken,
      versionTwo,
      "runtime_2",
      interruptedSnapshot(queued),
      "runtime_1",
    );
    expect(recovered.status).toBe(200);

    const snapshotResponse = await jsonRequest(
      app,
      `/v1/desktop/sessions/${session.id}`,
      desktopToken,
    );
    const snapshot = (await snapshotResponse.json()) as SessionSnapshot;
    expect(snapshot.turns[0]).toMatchObject({
      status: "failed",
      error: { code: ErrorCodes.RUNTIME_INTERRUPTED },
    });

    const staleWrite = await replaceSnapshot(
      app,
      desktopToken,
      versionTwo,
      "runtime_2",
      interruptedSnapshot(queued),
      "runtime_1",
    );
    expect(staleWrite.status).toBe(409);
  });
});

function createQueuedSnapshot(session: Session): { messages: Message[]; turns: Turn[] } {
  const turn: Turn = {
    id: "turn_desktop_1",
    sessionId: session.id,
    index: 1,
    status: "queued",
    userMessageId: "msg_desktop_1",
  };
  return {
    turns: [turn],
    messages: [
      {
        id: turn.userMessageId,
        sessionId: session.id,
        turnId: turn.id,
        role: "user",
        parts: [{ id: "part_desktop_1", type: "text", text: "计算 1+1" }],
        createdAt: "2026-08-17T00:00:00.000Z",
      },
    ],
  };
}

function interruptedSnapshot(snapshot: { messages: Message[]; turns: Turn[] }): {
  messages: Message[];
  turns: Turn[];
} {
  return {
    messages: structuredClone(snapshot.messages),
    turns: snapshot.turns.map((turn) => ({
      ...turn,
      status: "failed",
      error: {
        code: ErrorCodes.RUNTIME_INTERRUPTED,
        message: "Desktop Runtime restarted",
        retryable: true,
      },
      finishedAt: "2026-08-17T00:00:01.000Z",
    })),
  };
}

function replaceSnapshot(
  app: ReturnType<typeof createBackendApp>,
  token: string,
  session: Session,
  runtimeId: string,
  snapshot: { messages: Message[]; turns: Turn[] },
  replacesRuntimeId?: string,
): Promise<Response> {
  return jsonRequest(app, `/v1/desktop/sessions/${session.id}/snapshot`, token, {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion: session.version,
      runtimeId,
      ...(replacesRuntimeId ? { replacesRuntimeId } : {}),
      ...snapshot,
    }),
  });
}

function putClientToken(
  store: InMemoryBackendStore,
  accountId: string,
  clientId: string,
  suffix: string,
): string {
  const token = `bca_${suffix}`;
  store.putAccessToken({
    accountId,
    clientId,
    tokenHash: hashSecret(token),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  return token;
}

async function browserLogin(
  app: ReturnType<typeof createBackendApp>,
  subject: string,
): Promise<string> {
  const started = await app.request(
    `http://api.test/v1/auth/login/development?loginHint=${encodeURIComponent(subject)}`,
  );
  const callback = await app.request(started.headers.get("location") ?? "");
  return callback.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

function authorizeDesktop(
  app: ReturnType<typeof createBackendApp>,
  cookie: string,
  challenge: string,
  redirectUri: string,
): Promise<Response> {
  return Promise.resolve(
    app.request("http://api.test/oauth/authorize", {
      method: "POST",
      headers: {
        cookie,
        origin: "http://web.test",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "beecode-desktop",
        redirect_uri: redirectUri,
        code_challenge: challenge,
        state: "desktop-state",
        decision: "allow",
      }),
    }),
  );
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
