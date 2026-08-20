import { describe, expect, it } from "vitest";
import { ErrorCodes, type SessionSnapshot } from "@beecode/protocol";
import { DesktopBackendClient } from "../../src/runtime/desktop-backend-client.js";
import { RuntimeTokenStore } from "../../src/runtime/token-store.js";

describe("DesktopBackendClient", () => {
  it("uses Desktop routes and replaces an owned interrupted turn", async () => {
    const requests: Array<{ path: string; body?: Record<string, unknown> }> = [];
    const tokens = new RuntimeTokenStore();
    tokens.update("desktop-access");
    const queued: SessionSnapshot = {
      session: {
        id: "ses_1",
        accountId: "acct_1",
        surface: "desktop",
        title: "Recovery",
        status: "active",
        version: 1,
        createdAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z",
      },
      messages: [],
      turns: [{ id: "turn_1", sessionId: "ses_1", index: 1, status: "queued", userMessageId: "msg_1" }],
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.pathname === "/v1/desktop/sessions") {
        return json({ items: [queued.session], nextCursor: null });
      }
      if (url.pathname === "/v1/desktop/sessions/ses_1" && init?.method === "GET") return json(queued);
      if (url.pathname.endsWith("/snapshot")) {
        return json({ ...queued.session, version: 2 });
      }
      throw new Error(`unexpected ${url.pathname}`);
    };

    const client = new DesktopBackendClient({
      baseUrl: "http://backend.test",
      runtimeId: "runtime_new",
      replacesRuntimeId: "runtime_old",
      tokens,
      fetchImpl,
    });
    await client.recoverInterruptedTurns();

    expect(requests[0]?.path).toBe("/v1/desktop/sessions");
    expect(requests[0]?.body).toBeUndefined();
    expect(requests[2]?.path).toBe("/v1/desktop/sessions/ses_1/snapshot");
    expect(requests[2]?.body).toMatchObject({
      runtimeId: "runtime_new",
      replacesRuntimeId: "runtime_old",
      turns: [{ status: "failed", error: { code: ErrorCodes.RUNTIME_INTERRUPTED } }],
    });
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
