import { describe, expect, it, vi } from "vitest";
import {
  BEECODE_CSRF_HEADER_NAME,
  BEECODE_CSRF_HEADER_VALUE,
  type AgentEventEnvelope,
  type SessionSnapshot,
} from "@beecode/protocol";
import { HttpAgentTransport } from "../src/http-transport.js";

const timestamp = "2026-08-10T00:00:00.000Z";
const snapshot: SessionSnapshot = {
  session: {
    id: "ses_web",
    accountId: "acct_web",
    surface: "web",
    title: "Web",
    status: "active",
    version: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  messages: [],
  turns: [],
  live: { sequence: 3 },
};

class FakeEventSource {
  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();
  closed = false;

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type: string, value: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(value) });
    }
  }

  close(): void {
    this.closed = true;
  }
}

describe("HttpAgentTransport", () => {
  it("maps Web HTTP commands and validates responses", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/v1/web/sessions") && init?.method === "POST") {
        return Response.json(snapshot.session, { status: 201 });
      }
      if (url.includes("/turns")) {
        return Response.json({
          turn: {
            id: "turn_1",
            sessionId: "ses_web",
            index: 1,
            status: "queued",
            userMessageId: "msg_1",
          },
        }, { status: 202 });
      }
      if (url.endsWith("/v1/auth/logout")) {
        return new Response(null, { status: 204 });
      }
      return Response.json({ items: [snapshot.session], nextCursor: null });
    });
    const transport = new HttpAgentTransport({
      baseUrl: "http://api.test",
      fetchImpl,
      eventSourceFactory: () => new FakeEventSource(),
    });

    expect((await transport.createSession({ title: "Web" })).surface).toBe("web");
    expect((await transport.listSessions()).items).toHaveLength(1);
    const accepted = await transport.submitMessage({
      sessionId: "ses_web",
      text: "hello",
      idempotencyKey: "idempotency-key",
      workspace: { id: "browser_workspace_1", name: "project" },
    });
    await transport.submitBrowserWorkspaceToolResult(
      "ses_web",
      {
        turnId: "turn_1",
        toolCallId: "tool_1",
        workspaceId: "browser_workspace_1",
        operation: { kind: "read", path: "README.md" },
      },
      {
        ok: true,
        output: { kind: "file", path: "README.md", sizeBytes: 5, content: "hello" },
      },
    );
    await transport.logout();
    expect(accepted.turn.status).toBe("queued");
    expect(requests.every((request) => request.init?.credentials === "include")).toBe(true);
    const writes = requests.filter((request) => request.init?.method !== "GET");
    expect(writes).toHaveLength(4);
    expect(JSON.parse(String(writes[1]?.init?.body))).toEqual({
      text: "hello",
      idempotencyKey: "idempotency-key",
      workspace: { id: "browser_workspace_1", name: "project" },
    });
    expect(writes[2]?.url).toContain("/turns/turn_1/tool-calls/tool_1/result");
    expect(
      writes.map((request) =>
        new Headers(request.init?.headers).get(BEECODE_CSRF_HEADER_NAME),
      ),
    ).toEqual(Array.from({ length: 4 }, () => BEECODE_CSRF_HEADER_VALUE));
  });

  it("buffers SSE events until the authoritative recovery snapshot is loaded", async () => {
    const source = new FakeEventSource();
    let resolveSnapshot: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn<typeof fetch>(
      () => new Promise<Response>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const transport = new HttpAgentTransport({
      baseUrl: "http://api.test",
      fetchImpl,
      eventSourceFactory: () => source,
    });
    const observed: number[] = [];
    const states: string[] = [];
    const unsubscribe = transport.subscribeWithRecovery("ses_web", {
      onSnapshot: () => observed.push(3),
      onEvent: (event) => observed.push(event.sequence),
      onConnectionState: (state) => states.push(state),
    });

    source.emit("stream.connected", { sequence: 0 });
    source.emit("agent", envelope(2));
    source.emit("agent", envelope(4));
    resolveSnapshot?.(Response.json(snapshot));
    await vi.waitFor(() => expect(states.at(-1)).toBe("connected"));

    expect(observed).toEqual([3, 4]);
    source.emit("agent", envelope(5));
    expect(observed).toEqual([3, 4, 5]);
    unsubscribe();
    expect(source.closed).toBe(true);
  });
});

function envelope(sequence: number): AgentEventEnvelope {
  return {
    eventId: `evt_${sequence}`,
    sessionId: "ses_web",
    turnId: "turn_1",
    sequence,
    occurredAt: timestamp,
    event: {
      type: "turn.cancelled",
      sessionId: "ses_web",
      turnId: "turn_1",
    },
  };
}
