import type {
  AgentEventEnvelope,
  Message,
  SessionSnapshot,
  ToolCall,
  ToolCallPart,
  Turn,
} from "@beecode/protocol";

export function applyAgentEvent(
  current: SessionSnapshot,
  envelope: AgentEventEnvelope,
): SessionSnapshot {
  if (envelope.sessionId !== current.session.id) return current;
  if (current.live && envelope.sequence <= current.live.sequence) return current;

  const snapshot = structuredClone(current);
  snapshot.live = { sequence: envelope.sequence, activeTurnId: envelope.turnId };
  const event = envelope.event;
  switch (event.type) {
    case "turn.started":
      upsertTurn(snapshot.turns, event.turn);
      break;
    case "message.delta": {
      const message = ensureAssistantMessage(snapshot.messages, envelope, event.messageId);
      const part = message.parts.find(
        (candidate) => candidate.id === event.partId && candidate.type === "text",
      );
      if (part?.type === "text") part.text += event.textDelta;
      else message.parts.push({ id: event.partId, type: "text", text: event.textDelta });
      break;
    }
    case "tool.requested": {
      const message = ensureAssistantMessage(snapshot.messages, envelope, event.messageId);
      message.parts.push({
        id: event.partId,
        type: "tool_call",
        toolCall: structuredClone(event.toolCall),
      });
      break;
    }
    case "tool.started":
      updateToolCall(snapshot.messages, event.toolCallId, (toolCall) => ({
        ...toolCall,
        status: "running",
      }));
      break;
    case "tool.completed":
    case "tool.failed":
      updateToolCall(snapshot.messages, event.toolCall.id, () => structuredClone(event.toolCall));
      appendToolResult(snapshot.messages, envelope, event.toolCall);
      break;
    case "turn.completed":
      updateTurn(snapshot.turns, event.turnId, {
        status: "completed",
        usage: event.usage,
        finishedAt: envelope.occurredAt,
      });
      snapshot.live = { sequence: envelope.sequence };
      break;
    case "turn.failed":
      updateTurn(snapshot.turns, event.turnId, {
        status: "failed",
        error: event.error,
        finishedAt: envelope.occurredAt,
      });
      snapshot.live = { sequence: envelope.sequence };
      break;
    case "turn.cancelled":
      updateTurn(snapshot.turns, event.turnId, {
        status: "cancelled",
        finishedAt: envelope.occurredAt,
      });
      snapshot.live = { sequence: envelope.sequence };
      break;
  }
  return snapshot;
}

function ensureAssistantMessage(
  messages: Message[],
  envelope: AgentEventEnvelope,
  messageId: string,
): Message {
  const existing = messages.find((message) => message.id === messageId);
  if (existing) return existing;
  const message: Message = {
    id: messageId,
    sessionId: envelope.sessionId,
    turnId: envelope.turnId,
    role: "assistant",
    parts: [],
    createdAt: envelope.occurredAt,
  };
  messages.push(message);
  return message;
}

function updateToolCall(
  messages: Message[],
  toolCallId: string,
  update: (toolCall: ToolCall) => ToolCall,
): void {
  for (const message of messages) {
    const part = message.parts.find(
      (candidate): candidate is ToolCallPart =>
        candidate.type === "tool_call" && candidate.toolCall.id === toolCallId,
    );
    if (part) {
      part.toolCall = update(part.toolCall);
      return;
    }
  }
}

function appendToolResult(
  messages: Message[],
  envelope: AgentEventEnvelope,
  toolCall: ToolCall,
): void {
  if (
    messages.some((message) =>
      message.parts.some(
        (part) => part.type === "tool_result" && part.toolCallId === toolCall.id,
      ),
    )
  ) {
    return;
  }
  messages.push({
    id: `${envelope.eventId}_result`,
    sessionId: envelope.sessionId,
    turnId: envelope.turnId,
    role: "tool",
    parts: [
      {
        id: `${envelope.eventId}_part`,
        type: "tool_result",
        toolCallId: toolCall.id,
        result:
          toolCall.status === "completed"
            ? { ok: true, output: toolCall.output }
            : {
                ok: false,
                error: toolCall.error ?? {
                  code: "TOOL_EXECUTION_FAILED",
                  message: "Tool failed",
                  retryable: false,
                },
              },
      },
    ],
    createdAt: envelope.occurredAt,
  });
}

function upsertTurn(turns: Turn[], turn: Turn): void {
  const index = turns.findIndex((candidate) => candidate.id === turn.id);
  if (index >= 0) turns[index] = structuredClone(turn);
  else turns.push(structuredClone(turn));
}

function updateTurn(turns: Turn[], turnId: string, update: Partial<Turn>): void {
  const turn = turns.find((candidate) => candidate.id === turnId);
  if (turn) Object.assign(turn, update);
}
