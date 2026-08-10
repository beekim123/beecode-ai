import type {
  BeecodeErrorShape,
  Message,
  Part,
  Session,
  SessionSnapshot,
  ToolCall,
  Turn,
  Usage,
} from "./domain.js";
import type {
  GatewayMessage,
  GatewayToolCall,
  ModelRequest,
  ModelStreamEvent,
  ToolSchema,
} from "./backend-protocol.js";

type UnknownRecord = Record<string, unknown>;

export function parseSession(value: unknown, path = "session"): Session {
  const record = expectRecord(value, path);
  const surface = expectString(record.surface, `${path}.surface`);
  if (surface !== "cli") throw invalid(`${path}.surface must be "cli"`);
  const status = expectString(record.status, `${path}.status`);
  if (status !== "active" && status !== "archived") {
    throw invalid(`${path}.status is invalid`);
  }
  return {
    id: expectString(record.id, `${path}.id`),
    surface,
    accountId: expectString(record.accountId, `${path}.accountId`),
    title: expectString(record.title, `${path}.title`),
    status,
    version: expectInteger(record.version, `${path}.version`, 1),
    createdAt: expectString(record.createdAt, `${path}.createdAt`),
    updatedAt: expectString(record.updatedAt, `${path}.updatedAt`),
  };
}

export function parseSessions(value: unknown, path = "sessions"): Session[] {
  return expectArray(value, path).map((item, index) => parseSession(item, `${path}[${index}]`));
}

export function parseSessionSnapshot(value: unknown, path = "snapshot"): SessionSnapshot {
  const record = expectRecord(value, path);
  const messages = parseMessages(record.messages, `${path}.messages`);
  const isLegacySnapshot = record.turns === undefined;
  return {
    session: parseSession(record.session, `${path}.session`),
    messages: isLegacySnapshot
      ? messages.map((message) => {
          const legacyMessage = { ...message };
          delete legacyMessage.turnId;
          return legacyMessage;
        })
      : messages,
    // Existing phase-one JSON files predate Turn persistence.
    turns: isLegacySnapshot ? [] : parseTurns(record.turns, `${path}.turns`),
  };
}

export function parseMessages(value: unknown, path = "messages"): Message[] {
  return expectArray(value, path).map((item, index) => parseMessage(item, `${path}[${index}]`));
}

export function parseTurns(value: unknown, path = "turns"): Turn[] {
  return expectArray(value, path).map((item, index) => parseTurn(item, `${path}[${index}]`));
}

export function parseModelRequest(value: unknown, path = "modelRequest"): ModelRequest {
  const record = expectRecord(value, path);
  const request: ModelRequest = {
    messages: expectArray(record.messages, `${path}.messages`).map((item, index) =>
      parseGatewayMessage(item, `${path}.messages[${index}]`),
    ),
    tools: expectArray(record.tools, `${path}.tools`).map((item, index) =>
      parseToolSchema(item, `${path}.tools[${index}]`),
    ),
  };
  if (record.systemPrompt !== undefined) {
    request.systemPrompt = expectString(record.systemPrompt, `${path}.systemPrompt`);
  }
  if (record.maxOutputTokens !== undefined) {
    request.maxOutputTokens = expectInteger(record.maxOutputTokens, `${path}.maxOutputTokens`, 1);
  }
  return request;
}

export function parseModelStreamEvent(value: unknown, path = "modelEvent"): ModelStreamEvent {
  const record = expectRecord(value, path);
  const type = expectString(record.type, `${path}.type`);
  switch (type) {
    case "text_delta":
      return { type, text: expectString(record.text, `${path}.text`) };
    case "tool_call":
      return { type, toolCall: parseGatewayToolCall(record.toolCall, `${path}.toolCall`) };
    case "usage":
      return { type, usage: parseUsage(record.usage, `${path}.usage`) };
    case "finish": {
      const reason = expectString(record.reason, `${path}.reason`);
      if (reason !== "stop" && reason !== "tool_calls" && reason !== "length") {
        throw invalid(`${path}.reason is invalid`);
      }
      return { type, reason };
    }
    case "error":
      return { type, error: parseErrorShape(record.error, `${path}.error`) };
    default:
      throw invalid(`${path}.type is invalid`);
  }
}

export function parseErrorShape(value: unknown, path = "error"): BeecodeErrorShape {
  const record = expectRecord(value, path);
  return {
    code: expectString(record.code, `${path}.code`),
    message: expectString(record.message, `${path}.message`),
    retryable: expectBoolean(record.retryable, `${path}.retryable`),
  };
}

function parseMessage(value: unknown, path: string): Message {
  const record = expectRecord(value, path);
  const role = expectString(record.role, `${path}.role`);
  if (role !== "user" && role !== "assistant" && role !== "tool") {
    throw invalid(`${path}.role is invalid`);
  }
  const message: Message = {
    id: expectString(record.id, `${path}.id`),
    sessionId: expectString(record.sessionId, `${path}.sessionId`),
    role,
    parts: expectArray(record.parts, `${path}.parts`).map((item, index) =>
      parsePart(item, `${path}.parts[${index}]`),
    ),
    createdAt: expectString(record.createdAt, `${path}.createdAt`),
  };
  if (record.turnId !== undefined) message.turnId = expectString(record.turnId, `${path}.turnId`);
  return message;
}

function parsePart(value: unknown, path: string): Part {
  const record = expectRecord(value, path);
  const type = expectString(record.type, `${path}.type`);
  const id = expectString(record.id, `${path}.id`);
  switch (type) {
    case "text":
      return { id, type, text: expectString(record.text, `${path}.text`) };
    case "tool_call":
      return { id, type, toolCall: parseToolCall(record.toolCall, `${path}.toolCall`) };
    case "tool_result": {
      const result = expectRecord(record.result, `${path}.result`);
      const ok = expectBoolean(result.ok, `${path}.result.ok`);
      return {
        id,
        type,
        toolCallId: expectString(record.toolCallId, `${path}.toolCallId`),
        result: ok
          ? { ok, ...(result.output !== undefined ? { output: result.output } : {}) }
          : {
              ok,
              error: parseErrorShape(result.error, `${path}.result.error`),
            },
      };
    }
    default:
      throw invalid(`${path}.type is invalid`);
  }
}

function parseToolCall(value: unknown, path: string): ToolCall {
  const record = expectRecord(value, path);
  const status = expectString(record.status, `${path}.status`);
  if (!new Set(["requested", "running", "completed", "failed", "rejected"]).has(status)) {
    throw invalid(`${path}.status is invalid`);
  }
  const toolCall: ToolCall = {
    id: expectString(record.id, `${path}.id`),
    name: expectString(record.name, `${path}.name`),
    input: record.input,
    status: status as ToolCall["status"],
  };
  if (record.output !== undefined) toolCall.output = record.output;
  if (record.error !== undefined) toolCall.error = parseErrorShape(record.error, `${path}.error`);
  return toolCall;
}

function parseTurn(value: unknown, path: string): Turn {
  const record = expectRecord(value, path);
  const status = expectString(record.status, `${path}.status`);
  if (!new Set(["queued", "running", "model_streaming", "tool_running", "completed", "failed", "cancelled"]).has(status)) {
    throw invalid(`${path}.status is invalid`);
  }
  const turn: Turn = {
    id: expectString(record.id, `${path}.id`),
    sessionId: expectString(record.sessionId, `${path}.sessionId`),
    index: expectInteger(record.index, `${path}.index`, 1),
    status: status as Turn["status"],
    userMessageId: expectString(record.userMessageId, `${path}.userMessageId`),
  };
  if (record.assistantMessageId !== undefined) {
    turn.assistantMessageId = expectString(record.assistantMessageId, `${path}.assistantMessageId`);
  }
  if (record.error !== undefined) turn.error = parseErrorShape(record.error, `${path}.error`);
  if (record.usage !== undefined) turn.usage = parseUsage(record.usage, `${path}.usage`);
  if (record.startedAt !== undefined) turn.startedAt = expectString(record.startedAt, `${path}.startedAt`);
  if (record.finishedAt !== undefined) turn.finishedAt = expectString(record.finishedAt, `${path}.finishedAt`);
  return turn;
}

function parseUsage(value: unknown, path: string): Usage {
  const record = expectRecord(value, path);
  return {
    inputTokens: expectInteger(record.inputTokens, `${path}.inputTokens`, 0),
    outputTokens: expectInteger(record.outputTokens, `${path}.outputTokens`, 0),
    totalTokens: expectInteger(record.totalTokens, `${path}.totalTokens`, 0),
  };
}

function parseGatewayMessage(value: unknown, path: string): GatewayMessage {
  const record = expectRecord(value, path);
  const role = expectString(record.role, `${path}.role`);
  if (role === "user") return { role, content: expectString(record.content, `${path}.content`) };
  if (role === "tool") {
    return {
      role,
      toolCallId: expectString(record.toolCallId, `${path}.toolCallId`),
      name: expectString(record.name, `${path}.name`),
      content: expectString(record.content, `${path}.content`),
    };
  }
  if (role === "assistant") {
    const message: Extract<GatewayMessage, { role: "assistant" }> = {
      role,
      content: expectString(record.content, `${path}.content`),
    };
    if (record.toolCalls !== undefined) {
      message.toolCalls = expectArray(record.toolCalls, `${path}.toolCalls`).map((item, index) =>
        parseGatewayToolCall(item, `${path}.toolCalls[${index}]`),
      );
    }
    return message;
  }
  throw invalid(`${path}.role is invalid`);
}

function parseGatewayToolCall(value: unknown, path: string): GatewayToolCall {
  const record = expectRecord(value, path);
  return {
    id: expectString(record.id, `${path}.id`),
    name: expectString(record.name, `${path}.name`),
    input: record.input,
  };
}

function parseToolSchema(value: unknown, path: string): ToolSchema {
  const record = expectRecord(value, path);
  return {
    name: expectString(record.name, `${path}.name`),
    description: expectString(record.description, `${path}.description`),
    inputSchema: expectRecord(record.inputSchema, `${path}.inputSchema`),
  };
}

function expectRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw invalid(`${path} must be an array`);
  return value;
}

function expectString(value: unknown, path: string): string {
  if (typeof value !== "string") throw invalid(`${path} must be a string`);
  return value;
}

function expectBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw invalid(`${path} must be a boolean`);
  return value;
}

function expectInteger(value: unknown, path: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw invalid(`${path} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function invalid(message: string): TypeError {
  return new TypeError(`Invalid protocol payload: ${message}`);
}
