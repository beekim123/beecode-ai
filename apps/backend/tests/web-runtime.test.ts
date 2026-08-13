import { describe, expect, it } from "vitest";
import {
  BEECODE_CSRF_HEADER_NAME,
  BEECODE_CSRF_HEADER_VALUE,
  ErrorCodes,
  type ModelRequest,
  type ModelStreamEvent,
  type Session,
  type SessionSnapshot,
  type Turn,
} from "@beecode/protocol";
import { createBackendApp } from "../src/app.js";
import { ModelGatewayService } from "../src/model/model-gateway-service.js";
import type { ProviderAdapter } from "../src/provider/adapter.js";
import { FakeProviderAdapter } from "../src/provider/fake.js";
import { WebRuntimeHost } from "../src/runtime/web-runtime-host.js";
import { InMemoryBackendStore } from "../src/store.js";
import { StoreSessionRepository } from "../src/session/store-session-repository.js";

function createHarness() {
  const store = new InMemoryBackendStore();
  const app = createBackendApp(store, new FakeProviderAdapter(), {
    quotaLimitTokens: 100_000,
    webOrigin: "http://web.test",
    publicBaseUrl: "http://api.test",
  });
  return { app, store };
}

async function login(app: ReturnType<typeof createBackendApp>, subject = "web-runtime@example.test") {
  const started = await app.request(
    `http://api.test/v1/auth/login/development?loginHint=${encodeURIComponent(subject)}`,
  );
  const callback = await app.request(started.headers.get("location") ?? "");
  return callback.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

function webRequest(
  app: ReturnType<typeof createBackendApp>,
  cookie: string,
  path: string,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  headers.set("origin", "http://web.test");
  if (init.body) headers.set("content-type", "application/json");
  return Promise.resolve(app.request(`http://api.test${path}`, { ...init, headers }));
}

describe("Web Agent vertical slice", () => {
  it("uses a Chinese title for a new untitled Web session", async () => {
    const { app } = createHarness();
    const cookie = await login(app, "default-title@example.test");
    const created = await webRequest(app, cookie, "/v1/web/sessions", {
      method: "POST",
      body: JSON.stringify({}),
    });

    expect(created.status).toBe(201);
    expect((await created.json()) as Session).toMatchObject({ title: "新会话" });
  });

  it("accepts the explicit CSRF header when session creation Origin is rewritten", async () => {
    const { app } = createHarness();
    const cookie = await login(app, "rewritten-session-origin@example.test");
    const created = await app.request("http://api.test/v1/web/sessions", {
      method: "POST",
      headers: {
        cookie,
        origin: "chrome-extension://invalid",
        "content-type": "application/json",
        [BEECODE_CSRF_HEADER_NAME]: BEECODE_CSRF_HEADER_VALUE,
      },
      body: JSON.stringify({ title: "Extension-safe session" }),
    });

    expect(created.status).toBe(201);
  });

  it("creates, updates, archives, paginates, and surface-isolates Web sessions", async () => {
    const { app } = createHarness();
    const cookie = await login(app);
    const first = await webRequest(app, cookie, "/v1/web/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "First" }),
    });
    expect(first.status).toBe(201);
    const session = (await first.json()) as Session;
    expect(session.surface).toBe("web");

    await webRequest(app, cookie, "/v1/web/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "Second" }),
    });
    const pageOne = await webRequest(app, cookie, "/v1/web/sessions?limit=1");
    const page = (await pageOne.json()) as { items: Session[]; nextCursor: string };
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const pageTwo = await webRequest(
      app,
      cookie,
      `/v1/web/sessions?limit=1&cursor=${encodeURIComponent(page.nextCursor)}`,
    );
    expect(((await pageTwo.json()) as { items: Session[] }).items).toHaveLength(1);

    const renamed = await webRequest(app, cookie, `/v1/web/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: session.version, title: "Renamed" }),
    });
    expect((await renamed.json()) as Session).toMatchObject({ title: "Renamed", version: 2 });

    const developer = await app.request("http://api.test/v1/auth/dev-token", { method: "POST" });
    const token = ((await developer.json()) as { token: string }).token;
    const cliRead = await app.request(`http://api.test/v1/cli/sessions/${session.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(cliRead.status).toBe(404);
  });

  it("accepts an idempotent turn and persists calculator output plus final answer", async () => {
    const { app } = createHarness();
    const cookie = await login(app);
    const created = await webRequest(app, cookie, "/v1/web/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "Calculator" }),
    });
    const session = (await created.json()) as Session;
    const requestBody = JSON.stringify({ text: "计算 1+1", idempotencyKey: "idem-calculator-0001" });
    const accepted = await webRequest(app, cookie, `/v1/web/sessions/${session.id}/turns`, {
      method: "POST",
      body: requestBody,
    });
    expect(accepted.status).toBe(202);
    const acceptedTurn = ((await accepted.json()) as { turn: Turn }).turn;
    expect(acceptedTurn.status).toBe("queued");

    const retried = await webRequest(app, cookie, `/v1/web/sessions/${session.id}/turns`, {
      method: "POST",
      body: requestBody,
    });
    expect(((await retried.json()) as { turn: Turn }).turn.id).toBe(acceptedTurn.id);

    const snapshot = await waitForTerminalSnapshot(app, cookie, session.id);
    expect(snapshot.turns.at(-1)?.status).toBe("completed");
    expect(JSON.stringify(snapshot.messages)).toContain('"value":2');
    expect(JSON.stringify(snapshot.messages)).toContain("1+1 = 2");
    expect(snapshot.messages.filter((message) => message.role === "user")).toHaveLength(1);

    const conflict = await webRequest(app, cookie, `/v1/web/sessions/${session.id}/turns`, {
      method: "POST",
      body: JSON.stringify({ text: "different", idempotencyKey: "idem-calculator-0001" }),
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe(
      ErrorCodes.IDEMPOTENCY_CONFLICT,
    );
  });

  it("marks persisted non-terminal turns as interrupted during recovery", async () => {
    const store = new InMemoryBackendStore();
    const account = store.createAccount(10_000);
    const repository = new StoreSessionRepository(store);
    const session = await repository.create(account.accountId, "Interrupted");
    await repository.acceptTurn({
      accountId: account.accountId,
      sessionId: session.id,
      text: "hello",
      idempotencyKey: "interrupted-turn-key",
    });

    expect(await repository.recoverInterruptedTurns()).toBe(1);
    const snapshot = await repository.getOwned(account.accountId, session.id);
    expect(snapshot?.turns[0]).toMatchObject({
      status: "failed",
      error: { code: ErrorCodes.RUNTIME_INTERRUPTED, retryable: true },
    });
  });

  it("rejects concurrent turns, emits ordered events, and persists cancellation", async () => {
    const store = new InMemoryBackendStore();
    const account = store.createAccount(10_000);
    const repository = new StoreSessionRepository(store);
    const host = new WebRuntimeHost({
      repository,
      modelGateway: new ModelGatewayService(store, new BlockingProviderAdapter()),
    });
    const session = await repository.create(account.accountId, "Cancellation");
    const events: Array<{ sequence: number; type: string }> = [];
    const unsubscribe = host.subscribe(session.id, (envelope) => {
      events.push({ sequence: envelope.sequence, type: envelope.event.type });
    });

    const accepted = await host.submitTurn({
      accountId: account.accountId,
      sessionId: session.id,
      text: "wait for cancellation",
      idempotencyKey: "cancellation-turn-0001",
    });
    await waitUntil(() => events.some((event) => event.type === "message.delta"));

    await expect(
      host.submitTurn({
        accountId: account.accountId,
        sessionId: session.id,
        text: "concurrent turn",
        idempotencyKey: "concurrent-turn-0001",
      }),
    ).rejects.toMatchObject({ code: ErrorCodes.TURN_ALREADY_ACTIVE });

    await host.cancelTurn(account.accountId, session.id, accepted.turn.id);
    await waitUntil(async () => {
      const snapshot = await host.getSnapshot(account.accountId, session.id);
      return snapshot.turns.at(-1)?.status === "cancelled";
    });
    unsubscribe();

    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "message.delta",
      "turn.cancelled",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect((await repository.getOwned(account.accountId, session.id))?.turns.at(-1)).toMatchObject({
      id: accepted.turn.id,
      status: "cancelled",
    });
  });
});

class BlockingProviderAdapter implements ProviderAdapter {
  readonly name = "blocking-test";

  async *stream(_request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    yield { type: "text_delta", text: "Working" };
    await new Promise<never>((_resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new Error("Aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
  }
}

async function waitForTerminalSnapshot(
  app: ReturnType<typeof createBackendApp>,
  cookie: string,
  sessionId: string,
): Promise<SessionSnapshot> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await webRequest(app, cookie, `/v1/web/sessions/${sessionId}`);
    const snapshot = (await response.json()) as SessionSnapshot;
    const status = snapshot.turns.at(-1)?.status;
    if (status === "completed" || status === "failed" || status === "cancelled") return snapshot;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for Web turn to finish");
}

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition");
}
