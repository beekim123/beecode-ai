import * as z from "zod";
import { SURFACES } from "./domain.js";

const IdSchema = z.string().min(1);
const TimestampSchema = z.string().min(1).meta({ format: "date-time" });

export const SurfaceSchema = z.enum(SURFACES).meta({ id: "Surface" });

export const BeecodeErrorShapeSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    retryable: z.boolean(),
  })
  .meta({ id: "BeecodeError" });

export const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  })
  .meta({ id: "Usage" });

export const ToolCallSchema = z
  .object({
    id: IdSchema,
    name: z.string().min(1),
    input: z.unknown(),
    status: z.enum(["requested", "running", "completed", "failed", "rejected"]),
    output: z.unknown().optional(),
    error: BeecodeErrorShapeSchema.optional(),
  })
  .meta({ id: "ToolCall" });

export const ToolResultSchema = z
  .discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), output: z.unknown().optional() }),
    z.object({ ok: z.literal(false), error: BeecodeErrorShapeSchema }),
  ])
  .meta({ id: "ToolResult" });

export const PartSchema = z
  .discriminatedUnion("type", [
    z.object({ id: IdSchema, type: z.literal("text"), text: z.string() }),
    z.object({ id: IdSchema, type: z.literal("tool_call"), toolCall: ToolCallSchema }),
    z.object({
      id: IdSchema,
      type: z.literal("tool_result"),
      toolCallId: IdSchema,
      result: ToolResultSchema,
    }),
  ])
  .meta({ id: "Part" });

export const MessageSchema = z
  .object({
    id: IdSchema,
    sessionId: IdSchema,
    turnId: IdSchema.optional(),
    role: z.enum(["user", "assistant", "tool"]),
    parts: z.array(PartSchema),
    createdAt: TimestampSchema,
  })
  .meta({ id: "Message" });

export const TurnSchema = z
  .object({
    id: IdSchema,
    sessionId: IdSchema,
    index: z.number().int().positive(),
    status: z.enum([
      "queued",
      "running",
      "model_streaming",
      "tool_running",
      "completed",
      "failed",
      "cancelled",
    ]),
    userMessageId: IdSchema,
    assistantMessageId: IdSchema.optional(),
    error: BeecodeErrorShapeSchema.optional(),
    usage: UsageSchema.optional(),
    startedAt: TimestampSchema.optional(),
    finishedAt: TimestampSchema.optional(),
  })
  .meta({ id: "Turn" });

export const SessionSchema = z
  .object({
    id: IdSchema,
    surface: SurfaceSchema,
    accountId: IdSchema,
    title: z.string(),
    status: z.enum(["active", "archived"]),
    version: z.number().int().positive(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .meta({ id: "Session" });

export const SessionLiveStateSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    activeTurnId: IdSchema.optional(),
  })
  .meta({ id: "SessionLiveState" });

export const SessionSnapshotSchema = z
  .object({
    session: SessionSchema,
    messages: z.array(MessageSchema),
    turns: z.array(TurnSchema),
    live: SessionLiveStateSchema.optional(),
  })
  .meta({ id: "SessionSnapshot" });

export const CapabilityStateSchema = z
  .object({
    available: z.boolean(),
    reason: z
      .enum(["surface_policy", "runtime_missing", "not_configured", "not_authorized"])
      .optional(),
  })
  .superRefine((state, context) => {
    if (state.available && state.reason !== undefined) {
      context.addIssue({ code: "custom", message: "available capabilities cannot include a reason" });
    }
    if (!state.available && state.reason === undefined) {
      context.addIssue({ code: "custom", message: "unavailable capabilities require a reason" });
    }
  })
  .meta({ id: "CapabilityState" });

export const ToolCapabilitySchema = CapabilityStateSchema.safeExtend({
  name: z.string().min(1),
  description: z.string(),
}).meta({ id: "ToolCapability" });

export const CapabilitySetSchema = z
  .object({
    surface: SurfaceSchema,
    runtimeLocation: z.enum(["local", "backend"]),
    tools: z.array(ToolCapabilitySchema),
    features: z.object({
      localWorkspace: CapabilityStateSchema,
      shell: CapabilityStateSchema,
      git: CapabilityStateSchema,
      attachments: CapabilityStateSchema,
    }),
    limits: z.object({
      maxTurnSteps: z.number().int().positive(),
      maxInputBytes: z.number().int().positive(),
    }),
  })
  .meta({ id: "CapabilitySet" });

export const SessionPageSchema = z
  .object({
    items: z.array(SessionSchema),
    nextCursor: z.string().min(1).nullable(),
  })
  .meta({ id: "SessionPage" });

export const AgentEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("turn.started"), sessionId: IdSchema, turnId: IdSchema, turn: TurnSchema }),
    z.object({
      type: z.literal("message.delta"),
      sessionId: IdSchema,
      turnId: IdSchema,
      messageId: IdSchema,
      partId: IdSchema,
      textDelta: z.string(),
    }),
    z.object({
      type: z.literal("tool.requested"),
      sessionId: IdSchema,
      turnId: IdSchema,
      messageId: IdSchema,
      partId: IdSchema,
      toolCall: ToolCallSchema,
    }),
    z.object({
      type: z.literal("tool.started"),
      sessionId: IdSchema,
      turnId: IdSchema,
      toolCallId: IdSchema,
    }),
    z.object({ type: z.literal("tool.completed"), sessionId: IdSchema, turnId: IdSchema, toolCall: ToolCallSchema }),
    z.object({ type: z.literal("tool.failed"), sessionId: IdSchema, turnId: IdSchema, toolCall: ToolCallSchema }),
    z.object({ type: z.literal("turn.completed"), sessionId: IdSchema, turnId: IdSchema, usage: UsageSchema.optional() }),
    z.object({ type: z.literal("turn.failed"), sessionId: IdSchema, turnId: IdSchema, error: BeecodeErrorShapeSchema }),
    z.object({ type: z.literal("turn.cancelled"), sessionId: IdSchema, turnId: IdSchema }),
  ])
  .meta({ id: "AgentEvent" });

export const AgentEventEnvelopeSchema = z
  .object({
    eventId: IdSchema,
    sessionId: IdSchema,
    turnId: IdSchema.optional(),
    sequence: z.number().int().nonnegative(),
    occurredAt: TimestampSchema,
    event: AgentEventSchema,
  })
  .superRefine((envelope, context) => {
    if (envelope.event.sessionId !== envelope.sessionId) {
      context.addIssue({ code: "custom", message: "event sessionId must match envelope sessionId" });
    }
    if (envelope.turnId !== undefined && envelope.event.turnId !== envelope.turnId) {
      context.addIssue({ code: "custom", message: "event turnId must match envelope turnId" });
    }
  })
  .meta({ id: "AgentEventEnvelope" });

export const ToolSchemaSchema = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "ToolSchema" });

export const GatewayToolCallSchema = z
  .object({ id: IdSchema, name: z.string().min(1), input: z.unknown() })
  .meta({ id: "GatewayToolCall" });

export const GatewayMessageSchema = z
  .discriminatedUnion("role", [
    z.object({ role: z.literal("user"), content: z.string() }),
    z.object({
      role: z.literal("assistant"),
      content: z.string(),
      toolCalls: z.array(GatewayToolCallSchema).optional(),
    }),
    z.object({
      role: z.literal("tool"),
      toolCallId: IdSchema,
      name: z.string().min(1),
      content: z.string(),
    }),
  ])
  .meta({ id: "GatewayMessage" });

export const ModelRequestSchema = z
  .object({
    messages: z.array(GatewayMessageSchema),
    systemPrompt: z.string().optional(),
    tools: z.array(ToolSchemaSchema),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .meta({ id: "ModelRequest" });

export const ModelStreamEventSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("text_delta"), text: z.string() }),
    z.object({ type: z.literal("tool_call"), toolCall: GatewayToolCallSchema }),
    z.object({ type: z.literal("usage"), usage: UsageSchema }),
    z.object({ type: z.literal("finish"), reason: z.enum(["stop", "tool_calls", "length"]) }),
    z.object({ type: z.literal("error"), error: BeecodeErrorShapeSchema }),
  ])
  .meta({ id: "ModelStreamEvent" });

export const CreateSessionRequestSchema = z
  .object({ title: z.string().trim().max(200).optional() })
  .meta({ id: "CreateSessionRequest" });

export const ListSessionsQuerySchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  })
  .meta({ id: "ListSessionsQuery" });

export const ReplaceCliSessionRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    session: SessionSchema.optional(),
    messages: z.array(MessageSchema),
    turns: z.array(TurnSchema).optional(),
  })
  .meta({ id: "ReplaceCliSessionRequest" });

export const UpdateSessionRequestSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().max(200).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((input) => input.title !== undefined || input.status !== undefined, {
    message: "at least one mutable field is required",
  })
  .meta({ id: "UpdateSessionRequest" });

/** @deprecated Use the surface-neutral schema name. */
export const UpdateWebSessionRequestSchema = UpdateSessionRequestSchema;

export const SubmitTurnRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(1_048_576),
    idempotencyKey: z.string().min(8).max(200),
  })
  .meta({ id: "SubmitTurnRequest" });

export const SubmitTurnResponseSchema = z.object({ turn: TurnSchema }).meta({ id: "SubmitTurnResponse" });

export const ErrorResponseSchema = z
  .object({
    error: BeecodeErrorShapeSchema,
    requestId: z.string().min(1),
  })
  .meta({ id: "ErrorResponse" });

export const DevelopmentTokenResponseSchema = z
  .object({
    token: z.string().min(1),
    accountId: IdSchema,
    quotaLimitTokens: z.number().int().positive(),
  })
  .meta({ id: "DevelopmentTokenResponse" });

export const QuotaResponseSchema = z
  .object({
    accountId: IdSchema,
    quotaLimitTokens: z.number().int().positive(),
    quotaUsedTokens: z.number().int().nonnegative(),
    quotaReservedTokens: z.number().int().nonnegative(),
  })
  .meta({ id: "QuotaResponse" });

export const AccountSummarySchema = z
  .object({
    accountId: IdSchema,
    createdAt: TimestampSchema,
  })
  .meta({ id: "AccountSummary" });
