import { describe, expect, it } from "vitest";
import { AgentRuntime, DEFAULT_TURN_LIMITS } from "@beecode/agent-core";
import {
  BeecodeError,
  ErrorCodes,
  type ModelGateway,
  type ModelRequest,
  type Session,
  type SessionSnapshot,
} from "@beecode/protocol";
import { FakeModelGateway } from "@beecode/testing";
import { createDefaultToolRegistry } from "@beecode/tools";
import type { BackendSessionStore } from "../src/backend-client.js";
import { AgentServerFacade } from "../src/facade.js";
import { toGatewayHistory } from "../src/history.js";

class MemoryBackend implements BackendSessionStore {
  private snapshot: SessionSnapshot;

  constructor() {
    const now = new Date().toISOString();
    this.snapshot = {
      session: {
        id: "ses_test",
        surface: "cli",
        accountId: "acct_test",
        title: "test",
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      messages: [],
      turns: [],
    };
  }

  createSession(): Promise<Session> {
    return Promise.resolve(this.snapshot.session);
  }

  listSessions(): Promise<Session[]> {
    return Promise.resolve([this.snapshot.session]);
  }

  getSnapshot(_sessionId: string): Promise<SessionSnapshot> {
    return Promise.resolve(structuredClone(this.snapshot));
  }

  saveSnapshot(snapshot: SessionSnapshot, expectedVersion: number): Promise<Session> {
    if (expectedVersion !== this.snapshot.session.version) {
      throw new BeecodeError(ErrorCodes.SESSION_VERSION_CONFLICT, "version conflict");
    }
    const session = {
      ...snapshot.session,
      version: expectedVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    this.snapshot = structuredClone({ ...snapshot, session });
    return Promise.resolve(session);
  }
}

function createFacade(gateway: ModelGateway, backend = new MemoryBackend()): {
  backend: MemoryBackend;
  facade: AgentServerFacade;
} {
  const tools = createDefaultToolRegistry();
  const runtime = new AgentRuntime({ gateway, tools, surface: "cli" });
  const facade = new AgentServerFacade({
    runtime,
    tools,
    backend,
    surface: "cli",
    limits: DEFAULT_TURN_LIMITS,
  });
  return { backend, facade };
}

describe("AgentServerFacade", () => {
  it("sends the current user message once and persists exact model message order", async () => {
    const requests: ModelRequest[] = [];
    const gateway = new FakeModelGateway({
      onRequest: (request) => requests.push(structuredClone(request)),
    });
    const { backend, facade } = createFacade(gateway);

    const result = await facade.submitMessage({ sessionId: "ses_test", text: "计算 1+1" });
    const snapshot = await backend.getSnapshot("ses_test");

    expect(requests[0]?.messages).toEqual([{ role: "user", content: "计算 1+1" }]);
    expect(snapshot.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(snapshot.messages.map((message) => message.parts.map((part) => part.type))).toEqual([
      ["text"],
      ["tool_call"],
      ["tool_result"],
      ["text"],
    ]);
    expect(toGatewayHistory(snapshot.messages).map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]).toMatchObject({
      id: result.turn.id,
      status: "completed",
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    });
    expect(snapshot.messages[0]?.turnId).toBe(result.turn.id);
  });

  it("persists a failed turn and partial assistant output when the stream is truncated", async () => {
    const gateway: ModelGateway = {
      async *stream() {
        yield { type: "text_delta", text: "partial" };
      },
    };
    const { backend, facade } = createFacade(gateway);

    const result = await facade.submitMessage({ sessionId: "ses_test", text: "hello" });
    const snapshot = await backend.getSnapshot("ses_test");

    expect(result.turn.status).toBe("failed");
    expect(result.turn.error?.code).toBe(ErrorCodes.MODEL_STREAM_ERROR);
    expect(snapshot.turns[0]?.status).toBe("failed");
    expect(JSON.stringify(snapshot.messages)).toContain("partial");
  });

  it("persists cancelled as the terminal turn state", async () => {
    const gateway = new FakeModelGateway({
      steps: [{ kind: "text", text: "slow streamed response" }],
      eventDelayMs: 50,
    });
    const { backend, facade } = createFacade(gateway);
    let startedTurnId: string | undefined;
    let resolveStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    facade.subscribe("ses_test", (event) => {
      if (event.type === "turn.started") {
        startedTurnId = event.turnId;
        resolveStarted?.();
      }
    });

    const submission = facade.submitMessage({ sessionId: "ses_test", text: "hello" });
    await started;
    if (!startedTurnId) throw new Error("turn.started was not observed");
    await facade.cancelTurn("ses_test", startedTurnId);
    const result = await submission;
    const snapshot = await backend.getSnapshot("ses_test");

    expect(result.turn.status).toBe("cancelled");
    expect(snapshot.turns[0]?.status).toBe("cancelled");
  });
});
