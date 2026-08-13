import type {
  AgentEventEnvelope,
  Message,
  SessionSnapshot,
  ToolCall,
  Turn,
} from "@beecode/protocol";

export interface OptimisticUserMessageInput {
  id: string;
  sessionId: string;
  text: string;
  createdAt: string;
}

export function applyAgentEnvelope(
  current: SessionSnapshot,
  envelope: AgentEventEnvelope,
): SessionSnapshot {
  if (envelope.sessionId !== current.session.id) return current;
  const next = structuredClone(current);
  next.live = {
    sequence: Math.max(next.live?.sequence ?? 0, envelope.sequence),
    activeTurnId: envelope.turnId,
  };
  const event = envelope.event;

  switch (event.type) {
    case "turn.started":
      upsertTurn(next.turns, event.turn);
      break;
    case "message.delta": {
      const message = ensureAssistantMessage(next.messages, event.messageId, event.sessionId, event.turnId);
      const part = message.parts.find(
        (candidate) => candidate.id === event.partId && candidate.type === "text",
      );
      if (part?.type === "text") part.text += event.textDelta;
      else message.parts.push({ id: event.partId, type: "text", text: event.textDelta });
      patchTurn(next.turns, event.turnId, {
        status: "model_streaming",
        assistantMessageId: event.messageId,
      });
      break;
    }
    case "tool.requested": {
      const message = ensureAssistantMessage(next.messages, event.messageId, event.sessionId, event.turnId);
      if (!findToolCall(next.messages, event.toolCall.id)) {
        message.parts.push({ id: event.partId, type: "tool_call", toolCall: event.toolCall });
      }
      patchTurn(next.turns, event.turnId, { status: "tool_running" });
      break;
    }
    case "tool.started": {
      const toolCall = findToolCall(next.messages, event.toolCallId);
      if (toolCall) toolCall.status = "running";
      patchTurn(next.turns, event.turnId, { status: "tool_running" });
      break;
    }
    case "tool.completed":
    case "tool.failed": {
      const toolCall = findToolCall(next.messages, event.toolCall.id);
      if (toolCall) Object.assign(toolCall, event.toolCall);
      break;
    }
    case "turn.completed":
      patchTurn(next.turns, event.turnId, { status: "completed", usage: event.usage });
      next.live = { sequence: envelope.sequence };
      break;
    case "turn.failed":
      patchTurn(next.turns, event.turnId, { status: "failed", error: event.error });
      next.live = { sequence: envelope.sequence };
      break;
    case "turn.cancelled":
      patchTurn(next.turns, event.turnId, { status: "cancelled" });
      next.live = { sequence: envelope.sequence };
      break;
  }
  return next;
}

export function appendOptimisticUserMessage(
  current: SessionSnapshot,
  input: OptimisticUserMessageInput,
): SessionSnapshot {
  if (current.messages.some((message) => message.id === input.id)) return current;
  const next = structuredClone(current);
  next.messages.push({
    id: input.id,
    sessionId: input.sessionId,
    role: "user",
    parts: [{ id: `part_${input.id}`, type: "text", text: input.text }],
    createdAt: input.createdAt,
  });
  return next;
}

export function reconcileAcceptedTurn(
  current: SessionSnapshot,
  turn: Turn,
  optimisticMessageId: string,
  text: string,
): SessionSnapshot {
  const next = structuredClone(current);
  const existingTurn = next.turns.find((candidate) => candidate.id === turn.id);
  if (!existingTurn) next.turns.push(structuredClone(turn));

  const authoritativeMessageIndex = next.messages.findIndex(
    (message) => message.id === turn.userMessageId,
  );
  const optimisticMessageIndex = next.messages.findIndex(
    (message) => message.id === optimisticMessageId,
  );

  if (authoritativeMessageIndex >= 0) {
    if (optimisticMessageIndex >= 0 && optimisticMessageIndex !== authoritativeMessageIndex) {
      next.messages.splice(optimisticMessageIndex, 1);
    }
  } else if (optimisticMessageIndex >= 0) {
    const optimisticMessage = next.messages[optimisticMessageIndex];
    if (optimisticMessage) {
      next.messages[optimisticMessageIndex] = {
        ...optimisticMessage,
        id: turn.userMessageId,
        sessionId: turn.sessionId,
        turnId: turn.id,
      };
    }
  } else {
    next.messages.push({
      id: turn.userMessageId,
      sessionId: turn.sessionId,
      turnId: turn.id,
      role: "user",
      parts: [{ id: `part_${turn.userMessageId}`, type: "text", text }],
      createdAt: new Date().toISOString(),
    });
  }

  const effectiveTurn = existingTurn ?? turn;
  if (isActiveTurnStatus(effectiveTurn.status)) {
    next.live = { sequence: next.live?.sequence ?? 0, activeTurnId: turn.id };
  }
  return next;
}

export function discardOptimisticUserMessage(
  current: SessionSnapshot,
  optimisticMessageId: string,
): SessionSnapshot {
  if (!current.messages.some((message) => message.id === optimisticMessageId)) return current;
  const next = structuredClone(current);
  next.messages = next.messages.filter((message) => message.id !== optimisticMessageId);
  return next;
}

function upsertTurn(turns: Turn[], turn: Turn): void {
  const index = turns.findIndex((candidate) => candidate.id === turn.id);
  if (index >= 0) turns[index] = structuredClone(turn);
  else turns.push(structuredClone(turn));
}

function patchTurn(turns: Turn[], turnId: string, patch: Partial<Turn>): void {
  const turn = turns.find((candidate) => candidate.id === turnId);
  if (turn) Object.assign(turn, patch);
}

function ensureAssistantMessage(
  messages: Message[],
  messageId: string,
  sessionId: string,
  turnId: string,
): Message {
  const existing = messages.find((message) => message.id === messageId);
  if (existing) return existing;
  const message: Message = {
    id: messageId,
    sessionId,
    turnId,
    role: "assistant",
    parts: [],
    createdAt: new Date().toISOString(),
  };
  messages.push(message);
  return message;
}

function findToolCall(messages: Message[], toolCallId: string): ToolCall | undefined {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool_call" && part.toolCall.id === toolCallId) return part.toolCall;
    }
  }
  return undefined;
}

function isActiveTurnStatus(status: Turn["status"]): boolean {
  return status === "queued" || status === "running" || status === "model_streaming" || status === "tool_running";
}
