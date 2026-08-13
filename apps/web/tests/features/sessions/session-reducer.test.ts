import { describe, expect, it } from "vitest";
import type { AgentEventEnvelope, SessionSnapshot } from "@beecode/protocol";
import {
  appendOptimisticUserMessage,
  applyAgentEnvelope,
  discardOptimisticUserMessage,
  reconcileAcceptedTurn,
} from "../../../src/features/sessions/session-reducer.js";

const timestamp = "2026-08-10T00:00:00.000Z";

describe("session live reducer", () => {
  it("projects text, tool status, output, and terminal usage in sequence", () => {
    let snapshot = baseSnapshot();
    snapshot = applyAgentEnvelope(snapshot, envelope(1, {
      type: "turn.started",
      sessionId: "ses_1",
      turnId: "turn_1",
      turn: snapshot.turns[0]!,
    }));
    snapshot = applyAgentEnvelope(snapshot, envelope(2, {
      type: "tool.requested",
      sessionId: "ses_1",
      turnId: "turn_1",
      messageId: "msg_assistant",
      partId: "part_tool",
      toolCall: { id: "tc_1", name: "calculator", input: { expression: "1+1" }, status: "requested" },
    }));
    snapshot = applyAgentEnvelope(snapshot, envelope(3, {
      type: "tool.started",
      sessionId: "ses_1",
      turnId: "turn_1",
      toolCallId: "tc_1",
    }));
    snapshot = applyAgentEnvelope(snapshot, envelope(4, {
      type: "tool.completed",
      sessionId: "ses_1",
      turnId: "turn_1",
      toolCall: { id: "tc_1", name: "calculator", input: { expression: "1+1" }, status: "completed", output: { value: 2 } },
    }));
    snapshot = applyAgentEnvelope(snapshot, envelope(5, {
      type: "message.delta",
      sessionId: "ses_1",
      turnId: "turn_1",
      messageId: "msg_final",
      partId: "part_text",
      textDelta: "1+1 = 2",
    }));
    snapshot = applyAgentEnvelope(snapshot, envelope(6, {
      type: "turn.completed",
      sessionId: "ses_1",
      turnId: "turn_1",
      usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
    }));

    expect(JSON.stringify(snapshot.messages)).toContain('"value":2');
    expect(JSON.stringify(snapshot.messages)).toContain("1+1 = 2");
    expect(snapshot.turns[0]).toMatchObject({ status: "completed", usage: { totalTokens: 4 } });
    expect(snapshot.live).toEqual({ sequence: 6 });
  });

  it("projects stable failed and cancelled terminal states", () => {
    const failed = applyAgentEnvelope(baseSnapshot(), envelope(1, {
      type: "turn.failed",
      sessionId: "ses_1",
      turnId: "turn_1",
      error: { code: "MODEL_UNAVAILABLE", message: "Provider unavailable", retryable: true },
    }));
    expect(failed.turns[0]).toMatchObject({
      status: "failed",
      error: { code: "MODEL_UNAVAILABLE", retryable: true },
    });
    expect(failed.live).toEqual({ sequence: 1 });

    const cancelled = applyAgentEnvelope(baseSnapshot(), envelope(1, {
      type: "turn.cancelled",
      sessionId: "ses_1",
      turnId: "turn_1",
    }));
    expect(cancelled.turns[0]?.status).toBe("cancelled");
    expect(cancelled.live).toEqual({ sequence: 1 });
  });

  it("shows a user message immediately and reconciles it after turn acceptance", () => {
    const optimisticMessageId = "pending_idem_1";
    const initial = baseSnapshot();
    initial.turns = [];
    const optimistic = appendOptimisticUserMessage(initial, {
      id: optimisticMessageId,
      sessionId: "ses_1",
      text: "Hello now",
      createdAt: timestamp,
    });

    expect(optimistic.messages).toEqual([
      expect.objectContaining({ id: optimisticMessageId, role: "user" }),
    ]);

    const reconciled = reconcileAcceptedTurn(
      optimistic,
      {
        id: "turn_accepted",
        sessionId: "ses_1",
        index: 2,
        status: "queued",
        userMessageId: "msg_authoritative",
      },
      optimisticMessageId,
      "Hello now",
    );

    expect(reconciled.messages).toEqual([
      expect.objectContaining({
        id: "msg_authoritative",
        turnId: "turn_accepted",
        role: "user",
      }),
    ]);
    expect(reconciled.turns).toContainEqual(
      expect.objectContaining({ id: "turn_accepted", status: "queued" }),
    );
    expect(reconciled.live?.activeTurnId).toBe("turn_accepted");
  });

  it("keeps newer SSE progress when acceptance arrives after turn.started", () => {
    const optimisticMessageId = "pending_idem_2";
    const initial = baseSnapshot();
    initial.turns = [];
    let snapshot = appendOptimisticUserMessage(initial, {
      id: optimisticMessageId,
      sessionId: "ses_1",
      text: "Race-safe message",
      createdAt: timestamp,
    });
    snapshot = applyAgentEnvelope(snapshot, envelope(2, {
      type: "turn.started",
      sessionId: "ses_1",
      turnId: "turn_race",
      turn: {
        id: "turn_race",
        sessionId: "ses_1",
        index: 2,
        status: "running",
        userMessageId: "msg_race",
      },
    }));

    snapshot = reconcileAcceptedTurn(
      snapshot,
      {
        id: "turn_race",
        sessionId: "ses_1",
        index: 2,
        status: "queued",
        userMessageId: "msg_race",
      },
      optimisticMessageId,
      "Race-safe message",
    );

    expect(snapshot.turns.find((turn) => turn.id === "turn_race")?.status).toBe("running");
    expect(snapshot.messages.some((message) => message.id === optimisticMessageId)).toBe(false);
    expect(snapshot.messages).toContainEqual(
      expect.objectContaining({ id: "msg_race", turnId: "turn_race" }),
    );
  });

  it("removes an optimistic message when submission is rejected", () => {
    const optimistic = appendOptimisticUserMessage(baseSnapshot(), {
      id: "pending_rejected",
      sessionId: "ses_1",
      text: "Try once",
      createdAt: timestamp,
    });

    expect(discardOptimisticUserMessage(optimistic, "pending_rejected").messages).toEqual([]);
  });
});

function baseSnapshot(): SessionSnapshot {
  return {
    session: { id: "ses_1", accountId: "acct_1", surface: "web", title: "Test", status: "active", version: 1, createdAt: timestamp, updatedAt: timestamp },
    messages: [],
    turns: [{ id: "turn_1", sessionId: "ses_1", index: 1, status: "queued", userMessageId: "msg_user" }],
    live: { sequence: 0, activeTurnId: "turn_1" },
  };
}

function envelope(sequence: number, event: AgentEventEnvelope["event"]): AgentEventEnvelope {
  return { eventId: `evt_${sequence}`, sessionId: "ses_1", turnId: "turn_1", sequence, occurredAt: timestamp, event };
}
