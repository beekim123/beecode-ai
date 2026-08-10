import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ErrorCodes, type ModelStreamEvent, type Session } from "@beecode/protocol";
import { createBackendServer } from "../src/http.js";
import { InMemoryBackendStore } from "../src/store.js";
import { FakeProviderAdapter } from "../src/provider/fake.js";
import type { ProviderAdapter } from "../src/provider/adapter.js";

let server: Server;
let baseUrl: string;
let store: InMemoryBackendStore;

beforeAll(async () => {
  store = new InMemoryBackendStore();
  server = createBackendServer(store, new FakeProviderAdapter(), { quotaLimitTokens: 10_000 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

async function login(): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/auth/dev-token`, { method: "POST" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { token: string };
  return body.token;
}

function authed(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("backend", () => {
  it("拒绝未认证的请求", async () => {
    const res = await fetch(`${baseUrl}/v1/cli/sessions`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ErrorCodes.UNAUTHENTICATED);
  });

  it("Session 生命周期：创建、列出、快照、版本化保存", async () => {
    const token = await login();

    const created = await fetch(`${baseUrl}/v1/cli/sessions`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ title: "t1" }),
    });
    expect(created.status).toBe(201);
    const session = (await created.json()) as Session;
    expect(session.surface).toBe("cli");
    expect(session.version).toBe(1);

    const list = await fetch(`${baseUrl}/v1/cli/sessions`, { headers: authed(token) });
    expect(((await list.json()) as Session[]).map((s) => s.id)).toContain(session.id);

    const snapshot = await fetch(`${baseUrl}/v1/cli/sessions/${session.id}`, { headers: authed(token) });
    expect(snapshot.status).toBe(200);
    expect(((await snapshot.json()) as { turns: unknown[] }).turns).toEqual([]);

    // 正确版本保存成功
    const saved = await fetch(`${baseUrl}/v1/cli/sessions/${session.id}`, {
      method: "PUT",
      headers: authed(token),
      body: JSON.stringify({
        expectedVersion: 1,
        messages: [
          {
            id: "msg_1",
            sessionId: session.id,
            role: "user",
            parts: [{ id: "p1", type: "text", text: "hi" }],
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    expect(((await saved.json()) as Session).version).toBe(2);

    // 旧版本保存被拒绝（不自动合并）
    const conflict = await fetch(`${baseUrl}/v1/cli/sessions/${session.id}`, {
      method: "PUT",
      headers: authed(token),
      body: JSON.stringify({ expectedVersion: 1, messages: [] }),
    });
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe(
      ErrorCodes.SESSION_VERSION_CONFLICT,
    );
  });

  it("同账号跨设备可见，其他账号不可见", async () => {
    const tokenA = await login();
    const tokenB = await login();

    const created = await fetch(`${baseUrl}/v1/cli/sessions`, {
      method: "POST",
      headers: authed(tokenA),
      body: JSON.stringify({ title: "A 的 session" }),
    });
    const session = (await created.json()) as Session;

    // 同账号另一个“设备”（同一 token）可读
    const sameAccount = await fetch(`${baseUrl}/v1/cli/sessions/${session.id}`, { headers: authed(tokenA) });
    expect(sameAccount.status).toBe(200);

    // 其他账号不可读，且不泄漏存在性
    const otherAccount = await fetch(`${baseUrl}/v1/cli/sessions/${session.id}`, { headers: authed(tokenB) });
    expect(otherAccount.status).toBe(404);
    const listB = await fetch(`${baseUrl}/v1/cli/sessions`, { headers: authed(tokenB) });
    expect(((await listB.json()) as Session[]).map((s) => s.id)).not.toContain(session.id);
  });

  it("客户端不能覆盖 surface", async () => {
    const token = await login();
    const created = await fetch(`${baseUrl}/v1/cli/sessions`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ title: "x" }),
    });
    const session = (await created.json()) as Session;

    const res = await fetch(`${baseUrl}/v1/cli/sessions/${session.id}`, {
      method: "PUT",
      headers: authed(token),
      body: JSON.stringify({
        expectedVersion: 1,
        session: { ...session, surface: "web" },
        messages: [],
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Session).surface).toBe("cli");
  });

  it("Model Gateway 以 SSE 返回标准化流并消耗额度", async () => {
    const token = await login();
    const res = await fetch(`${baseUrl}/v1/model/stream`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({
        messages: [{ role: "user", content: "计算 1+1" }],
        tools: [{ name: "calculator", description: "calc", inputSchema: {} }],
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    const events: ModelStreamEvent[] = text
      .split("\n\n")
      .filter((chunk) => chunk.startsWith("data:"))
      .map((chunk) => JSON.parse(chunk.slice(5).trim()) as ModelStreamEvent);

    const toolCall = events.find((e) => e.type === "tool_call");
    expect(toolCall?.type === "tool_call" && toolCall.toolCall.name).toBe("calculator");
    expect(events.some((e) => e.type === "usage")).toBe(true);
    expect(events.some((e) => e.type === "finish")).toBe(true);

    const quota = await fetch(`${baseUrl}/v1/quota`, { headers: authed(token) });
    const quotaBody = (await quota.json()) as { quotaUsedTokens: number };
    expect(quotaBody.quotaUsedTokens).toBeGreaterThan(0);
  });

  it("额度不足返回稳定产品错误", async () => {
    const token = await login();
    const account = store.findAccountByToken(token);
    if (!account) throw new Error("Expected the logged-in account in the store");
    account.quotaUsedTokens = account.quotaLimitTokens;

    const res = await fetch(`${baseUrl}/v1/model/stream`, {
      method: "POST",
      headers: authed(token),
      body: JSON.stringify({ messages: [{ role: "user", content: "1+1" }], tools: [] }),
    });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(ErrorCodes.QUOTA_EXCEEDED);
  });

  it("拒绝非法 JSON 和跨 Session 的消息归属", async () => {
    const token = await login();
    const malformed = await fetch(`${baseUrl}/v1/cli/sessions`, {
      method: "POST",
      headers: authed(token),
      body: "{not-json",
    });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe(
      ErrorCodes.INVALID_REQUEST,
    );

    const created = await fetch(`${baseUrl}/v1/cli/sessions`, {
      method: "POST",
      headers: authed(token),
      body: "{}",
    });
    const session = (await created.json()) as Session;
    const invalidOwnership = await fetch(`${baseUrl}/v1/cli/sessions/${session.id}`, {
      method: "PUT",
      headers: authed(token),
      body: JSON.stringify({
        expectedVersion: session.version,
        messages: [
          {
            id: "msg_wrong",
            sessionId: "ses_other",
            role: "user",
            parts: [{ id: "part_wrong", type: "text", text: "x" }],
            createdAt: new Date().toISOString(),
          },
        ],
        turns: [],
      }),
    });
    expect(invalidOwnership.status).toBe(400);
  });

  it("enforces development login secret when configured", async () => {
    const protectedServer = createBackendServer(
      new InMemoryBackendStore(),
      new FakeProviderAdapter(),
      { quotaLimitTokens: 1000, devLoginSecret: "test-secret" },
    );
    await new Promise<void>((resolve) => protectedServer.listen(0, "127.0.0.1", resolve));
    const protectedUrl = `http://127.0.0.1:${(protectedServer.address() as AddressInfo).port}`;
    try {
      const denied = await fetch(`${protectedUrl}/v1/auth/dev-token`, { method: "POST" });
      expect(denied.status).toBe(403);
      const allowed = await fetch(`${protectedUrl}/v1/auth/dev-token`, {
        method: "POST",
        headers: { "x-beecode-dev-secret": "test-secret" },
      });
      expect(allowed.status).toBe(200);
    } finally {
      await new Promise<void>((resolve) => protectedServer.close(() => resolve()));
    }
  });

  it("reserves quota before streaming so concurrent requests cannot oversubscribe", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slowProvider: ProviderAdapter = {
      name: "slow-fake",
      async *stream() {
        yield { type: "text_delta", text: "started" };
        await gate;
        yield { type: "usage", usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 } };
        yield { type: "finish", reason: "stop" };
      },
    };
    const quotaServer = createBackendServer(new InMemoryBackendStore(), slowProvider, {
      quotaLimitTokens: 700,
    });
    await new Promise<void>((resolve) => quotaServer.listen(0, "127.0.0.1", resolve));
    const quotaUrl = `http://127.0.0.1:${(quotaServer.address() as AddressInfo).port}`;
    try {
      const loginResponse = await fetch(`${quotaUrl}/v1/auth/dev-token`, { method: "POST" });
      const quotaToken = ((await loginResponse.json()) as { token: string }).token;
      const request = {
        method: "POST",
        headers: authed(quotaToken),
        body: JSON.stringify({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
          maxOutputTokens: 400,
        }),
      };
      const first = await fetch(`${quotaUrl}/v1/model/stream`, request);
      expect(first.status).toBe(200);

      const second = await fetch(`${quotaUrl}/v1/model/stream`, request);
      expect(second.status).toBe(402);

      release?.();
      await first.text();
    } finally {
      release?.();
      await new Promise<void>((resolve) => quotaServer.close(() => resolve()));
    }
  });
});
