import { describe, expect, it } from "vitest";
import type { AgentEventEnvelope, SessionSnapshot } from "@beecode/protocol";
import { applyAgentEvent } from "../../src/renderer/session-projection.js";

const now = "2026-08-17T00:00:00.000Z";

function snapshot(): SessionSnapshot {
  return {
    session: {
      id: "ses_desktop",
      accountId: "acct_desktop",
      surface: "desktop",
      title: "Desktop",
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
    messages: [],
    turns: [],
  };
}

function event(event: AgentEventEnvelope["event"], sequence: number): AgentEventEnvelope {
  return {
    eventId: `evt_${sequence}`,
    sessionId: "ses_desktop",
    turnId: "turn_1",
    sequence,
    occurredAt: now,
    event,
  };
}

describe("Desktop event projection", () => {
  it("projects calculator Tool Call, result and streamed answer in order", () => {
    let current = snapshot();
    current = applyAgentEvent(
      current,
      event({
        type: "turn.started",
        sessionId: "ses_desktop",
        turnId: "turn_1",
        turn: {
          id: "turn_1",
          sessionId: "ses_desktop",
          index: 1,
          status: "running",
          userMessageId: "msg_1",
        },
      }, 1),
    );
    current = applyAgentEvent(
      current,
      event({
        type: "tool.requested",
        sessionId: "ses_desktop",
        turnId: "turn_1",
        messageId: "msg_assistant",
        partId: "part_tool",
        toolCall: { id: "tc_1", name: "calculator", input: { expression: "1+1" }, status: "requested" },
      }, 2),
    );
    current = applyAgentEvent(
      current,
      event({
        type: "tool.completed",
        sessionId: "ses_desktop",
        turnId: "turn_1",
        toolCall: { id: "tc_1", name: "calculator", input: { expression: "1+1" }, status: "completed", output: { value: 2 } },
      }, 3),
    );
    current = applyAgentEvent(
      current,
      event({
        type: "message.delta",
        sessionId: "ses_desktop",
        turnId: "turn_1",
        messageId: "msg_final",
        partId: "part_text",
        textDelta: "1+1 = 2",
      }, 4),
    );

    expect(current.messages.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(current.messages[0]?.parts[0]).toMatchObject({ type: "tool_call", toolCall: { name: "calculator" } });
    expect(current.messages[1]?.parts[0]).toMatchObject({ type: "tool_result", result: { ok: true } });
    expect(current.messages[2]?.parts[0]).toMatchObject({ type: "text", text: "1+1 = 2" });
  });

  it("drops duplicate or stale sequences without mutating the snapshot", () => {
    const initial = { ...snapshot(), live: { sequence: 4 } };
    const projected = applyAgentEvent(
      initial,
      event({ type: "turn.cancelled", sessionId: "ses_desktop", turnId: "turn_1" }, 4),
    );
    expect(projected).toEqual(initial);
  });
});
