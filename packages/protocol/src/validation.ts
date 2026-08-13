import * as z from "zod";
import type {
  BeecodeErrorShape,
  AccountSummary,
  CapabilitySet,
  Message,
  Page,
  Session,
  SessionSnapshot,
  Turn,
  QuotaSnapshot,
} from "./domain.js";
import type { AgentEventEnvelope } from "./agent-protocol.js";
import type { ModelRequest, ModelStreamEvent } from "./backend-protocol.js";
import {
  AgentEventEnvelopeSchema,
  AccountSummarySchema,
  BeecodeErrorShapeSchema,
  CapabilitySetSchema,
  MessageSchema,
  ModelRequestSchema,
  ModelStreamEventSchema,
  SessionPageSchema,
  SessionSchema,
  SessionSnapshotSchema,
  TurnSchema,
  QuotaResponseSchema,
} from "./schemas.js";

type UnknownRecord = Record<string, unknown>;

export function parseSession(value: unknown, path = "session"): Session {
  return parseWithSchema(SessionSchema, value, path);
}

export function parseSessions(value: unknown, path = "sessions"): Session[] {
  return parseWithSchema(z.array(SessionSchema), value, path);
}

export function parseSessionPage(value: unknown, path = "sessionPage"): Page<Session> {
  return parseWithSchema(SessionPageSchema, value, path);
}

export function parseSessionSnapshot(value: unknown, path = "snapshot"): SessionSnapshot {
  const record = expectRecord(value, path);
  if (record.turns !== undefined) {
    return parseWithSchema(SessionSnapshotSchema, record, path);
  }

  const legacyMessages = expectArray(record.messages, `${path}.messages`).map((message, index) => {
    const parsed = expectRecord(message, `${path}.messages[${index}]`);
    const migrated = { ...parsed };
    delete migrated.turnId;
    return migrated;
  });

  // Phase 1 JSON snapshots predate durable Turn records.
  return parseWithSchema(
    SessionSnapshotSchema,
    { ...record, messages: legacyMessages, turns: [] },
    path,
  );
}

export function parseMessages(value: unknown, path = "messages"): Message[] {
  return parseWithSchema(z.array(MessageSchema), value, path);
}

export function parseTurns(value: unknown, path = "turns"): Turn[] {
  return parseWithSchema(z.array(TurnSchema), value, path);
}

export function parseTurn(value: unknown, path = "turn"): Turn {
  return parseWithSchema(TurnSchema, value, path);
}

export function parseAccountSummary(value: unknown, path = "account"): AccountSummary {
  return parseWithSchema(AccountSummarySchema, value, path);
}

export function parseQuotaSnapshot(value: unknown, path = "quota"): QuotaSnapshot {
  return parseWithSchema(QuotaResponseSchema, value, path);
}

export function parseCapabilitySet(value: unknown, path = "capabilities"): CapabilitySet {
  return parseWithSchema(CapabilitySetSchema, value, path);
}

export function parseAgentEventEnvelope(
  value: unknown,
  path = "agentEventEnvelope",
): AgentEventEnvelope {
  return parseWithSchema(AgentEventEnvelopeSchema, value, path);
}

export function parseModelRequest(value: unknown, path = "modelRequest"): ModelRequest {
  return parseWithSchema(ModelRequestSchema, value, path);
}

export function parseModelStreamEvent(value: unknown, path = "modelEvent"): ModelStreamEvent {
  return parseWithSchema(ModelStreamEventSchema, value, path);
}

export function parseErrorShape(value: unknown, path = "error"): BeecodeErrorShape {
  return parseWithSchema(BeecodeErrorShapeSchema, value, path);
}

function parseWithSchema<TOutput>(schema: z.ZodType<TOutput>, value: unknown, path: string): TOutput {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const issuePath = issue?.path.length ? `.${issue.path.map(String).join(".")}` : "";
  const message = issue?.message ?? "payload is invalid";
  throw invalid(`${path}${issuePath}: ${message}`);
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

function invalid(message: string): TypeError {
  return new TypeError(`Invalid protocol payload: ${message}`);
}
