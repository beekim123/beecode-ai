import { describe, expect, it } from "vitest";
import { ErrorCodes, type ModelStreamEvent, type Session } from "@beecode/protocol";
import { createBackendApp } from "../src/app.js";
import { FakeProviderAdapter } from "../src/provider/fake.js";
import { InMemoryBackendStore } from "../src/store.js";

function createHarness() {
  const store = new InMemoryBackendStore();
  const app = createBackendApp(store, new FakeProviderAdapter(), { quotaLimitTokens: 10_000 });

  async function login(): Promise<string> {
    const response = await app.request("/v1/auth/dev-token", { method: "POST" });
    expect(response.status).toBe(200);
    return ((await response.json()) as { token: string }).token;
  }

  function request(path: string, token: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    headers.set("content-type", "application/json");
    return Promise.resolve(app.request(path, { ...init, headers }));
  }

  return { app, login, request, store };
}

describe("Hono backend app", () => {
  it("writes allowlisted request logs without credentials or body content", async () => {
    const records: unknown[] = [];
    const app = createBackendApp(
      new InMemoryBackendStore(),
      new FakeProviderAdapter(),
      { quotaLimitTokens: 10_000, devLoginSecret: "dev-secret-value" },
      { log: (record) => records.push(record) },
    );
    await app.request("/v1/auth/dev-token", {
      method: "POST",
      headers: {
        cookie: "browser-session-secret",
        "content-type": "application/json",
        "x-beecode-dev-secret": "dev-secret-value",
      },
      body: JSON.stringify({ prompt: "private-prompt-value" }),
    });

    const serialized = JSON.stringify(records);
    expect(records).toHaveLength(1);
    expect(serialized).not.toContain("dev-secret-value");
    expect(serialized).not.toContain("browser-session-secret");
    expect(serialized).not.toContain("private-prompt-value");
    expect(records[0]).toMatchObject({ method: "POST", path: "/v1/auth/dev-token", status: 200 });
  });

  it("publishes OpenAPI and returns diagnostic request IDs without authentication", async () => {
    const { app } = createHarness();
    const openApi = await app.request("/openapi.json");
    expect(openApi.status).toBe(200);
    expect((await openApi.json()) as { openapi: string }).toMatchObject({ openapi: "3.1.0" });

    const denied = await app.request("/v1/quota");
    const body = (await denied.json()) as { error: { code: string }; requestId: string };
    expect(denied.status).toBe(401);
    expect(denied.headers.get("x-request-id")).toBe(body.requestId);
    expect(body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
  });

  it("preserves CLI session compatibility while enforcing the server-owned surface", async () => {
    const { app, login, request } = createHarness();
    const token = await login();
    const emptyBodyCreated = await app.request("/v1/cli/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(emptyBodyCreated.status).toBe(201);

    const createdResponse = await request("/v1/cli/sessions", token, {
      method: "POST",
      body: JSON.stringify({ title: "phase 2", surface: "web" }),
    });
    const created = (await createdResponse.json()) as Session;
    expect(createdResponse.status).toBe(201);
    expect(created.surface).toBe("cli");

    const savedResponse = await request(`/v1/cli/sessions/${created.id}`, token, {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: created.version,
        session: { ...created, surface: "web", title: "renamed" },
        messages: [],
      }),
    });
    const saved = (await savedResponse.json()) as Session;
    expect(savedResponse.status).toBe(200);
    expect(saved).toMatchObject({ surface: "cli", title: "renamed", version: 2 });

    const list = await request("/v1/cli/sessions", token);
    expect(((await list.json()) as Session[]).map((session) => session.id)).toContain(created.id);
  });

  it("normalizes validation and body-limit failures", async () => {
    const { login, request } = createHarness();
    const token = await login();
    const malformed = await request("/v1/cli/sessions", token, {
      method: "POST",
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe(
      ErrorCodes.INVALID_REQUEST,
    );

    const tooLarge = await request("/v1/cli/sessions", token, {
      method: "POST",
      body: JSON.stringify({ title: "x".repeat(1_048_577) }),
    });
    expect(tooLarge.status).toBe(413);
    expect(((await tooLarge.json()) as { requestId: string }).requestId).toMatch(/^req_/);
  });

  it("streams the normalized model protocol and charges durable usage", async () => {
    const { login, request } = createHarness();
    const token = await login();
    const response = await request("/v1/model/stream", token, {
      method: "POST",
      body: JSON.stringify({
        messages: [{ role: "user", content: "计算 1+1" }],
        tools: [{ name: "calculator", description: "Calculate", inputSchema: {} }],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    const events = (await response.text())
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data:"))
      .map((chunk) => JSON.parse(chunk.slice(5).trim()) as ModelStreamEvent);
    expect(events.some((event) => event.type === "tool_call")).toBe(true);
    expect(events.some((event) => event.type === "usage")).toBe(true);
    expect(events.at(-1)?.type).toBe("finish");

    const quota = await request("/v1/quota", token);
    expect(((await quota.json()) as { quotaUsedTokens: number }).quotaUsedTokens).toBeGreaterThan(0);
  });
});
