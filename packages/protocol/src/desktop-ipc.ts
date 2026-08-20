import * as z from "zod";
import type {
  CapabilitySet,
  Page,
  Session,
  SessionSnapshot,
  Turn,
} from "./domain.js";
import type { AgentEventEnvelope, WorkspaceSummary } from "./agent-protocol.js";
import {
  AgentEventEnvelopeSchema,
  BeecodeErrorShapeSchema,
  CapabilitySetSchema,
  SessionPageSchema,
  SessionSchema,
  SessionSnapshotSchema,
  TurnSchema,
  WorkspaceSummarySchema,
} from "./schemas.js";

export const DESKTOP_IPC_PROTOCOL_VERSION = 1 as const;
export const DESKTOP_IPC_MAX_FRAME_BYTES = 1_048_576;

const IdSchema = z.string().min(1);
const EmptyPayloadSchema = z.strictObject({});

export const DesktopIpcMethodSchema = z.enum([
  "session.create",
  "session.list",
  "session.getSnapshot",
  "session.update",
  "session.subscribe",
  "session.unsubscribe",
  "turn.submit",
  "turn.cancel",
  "runtime.getCapabilities",
  "workspace.get",
  "workspace.configure",
  "workspace.clear",
]);

export type DesktopIpcMethod = z.infer<typeof DesktopIpcMethodSchema>;

const CreateSessionPayloadSchema = z.strictObject({
  title: z.string().trim().max(200).optional(),
});
const ListSessionsPayloadSchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
const SessionIdPayloadSchema = z.strictObject({ sessionId: IdSchema });
const UpdateSessionPayloadSchema = z
  .strictObject({
    sessionId: IdSchema,
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().max(200).optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine((input) => input.title !== undefined || input.status !== undefined, {
    message: "at least one mutable field is required",
  });
const SubmitMessagePayloadSchema = z.strictObject({
  sessionId: IdSchema,
  text: z.string().trim().min(1).max(DESKTOP_IPC_MAX_FRAME_BYTES),
  idempotencyKey: z.string().min(8).max(200).optional(),
});
const CancelTurnPayloadSchema = z.strictObject({
  sessionId: IdSchema,
  turnId: IdSchema,
});
const ConfigureWorkspacePayloadSchema = z.strictObject({
  directoryPath: z
    .string()
    .min(1)
    .max(32_768)
    .refine(isAbsoluteWorkspaceDirectory, "directoryPath must be absolute"),
});

const requestBase = {
  protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
  kind: z.literal("request"),
  requestId: IdSchema,
};

export const DesktopIpcRequestFrameSchema = z.discriminatedUnion("method", [
  z.strictObject({ ...requestBase, method: z.literal("session.create"), payload: CreateSessionPayloadSchema }),
  z.strictObject({ ...requestBase, method: z.literal("session.list"), payload: ListSessionsPayloadSchema }),
  z.strictObject({ ...requestBase, method: z.literal("session.getSnapshot"), payload: SessionIdPayloadSchema }),
  z.strictObject({ ...requestBase, method: z.literal("session.update"), payload: UpdateSessionPayloadSchema }),
  z.strictObject({ ...requestBase, method: z.literal("session.subscribe"), payload: SessionIdPayloadSchema }),
  z.strictObject({ ...requestBase, method: z.literal("session.unsubscribe"), payload: SessionIdPayloadSchema }),
  z.strictObject({ ...requestBase, method: z.literal("turn.submit"), payload: SubmitMessagePayloadSchema }),
  z.strictObject({ ...requestBase, method: z.literal("turn.cancel"), payload: CancelTurnPayloadSchema }),
  z.strictObject({
    ...requestBase,
    method: z.literal("runtime.getCapabilities"),
    payload: EmptyPayloadSchema,
  }),
  z.strictObject({
    ...requestBase,
    method: z.literal("workspace.get"),
    payload: EmptyPayloadSchema,
  }),
  z.strictObject({
    ...requestBase,
    method: z.literal("workspace.configure"),
    payload: ConfigureWorkspacePayloadSchema,
  }),
  z.strictObject({
    ...requestBase,
    method: z.literal("workspace.clear"),
    payload: EmptyPayloadSchema,
  }),
]);

export type DesktopIpcRequestFrame = z.infer<typeof DesktopIpcRequestFrameSchema>;

export const DesktopIpcResponseFrameSchema = z.strictObject({
  protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
  kind: z.literal("response"),
  requestId: IdSchema,
  result: z.discriminatedUnion("ok", [
    z.strictObject({ ok: z.literal(true), value: z.unknown() }),
    z.strictObject({ ok: z.literal(false), error: BeecodeErrorShapeSchema }),
  ]),
});

export type DesktopIpcResponseFrame = z.infer<typeof DesktopIpcResponseFrameSchema>;

const RuntimeStatusSchema = z.strictObject({
  state: z.enum([
    "stopped",
    "starting",
    "handshaking",
    "ready",
    "stopping",
    "reconnecting",
    "unavailable",
  ]),
  runtimeId: IdSchema.optional(),
  error: BeecodeErrorShapeSchema.optional(),
});

export type DesktopRuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const DesktopIpcEventFrameSchema = z.discriminatedUnion("event", [
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("event"),
    event: z.literal("agent.event"),
    payload: AgentEventEnvelopeSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("event"),
    event: z.literal("runtime.status"),
    payload: RuntimeStatusSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("event"),
    event: z.literal("auth.required"),
    payload: z.strictObject({ reason: z.string().min(1) }),
  }),
]);

export type DesktopIpcEventFrame = z.infer<typeof DesktopIpcEventFrameSchema>;

const AuthStateSchema = z.discriminatedUnion("authenticated", [
  z.strictObject({ authenticated: z.literal(false) }),
  z.strictObject({ authenticated: z.literal(true), accessToken: z.string().min(1) }),
]);

export const DesktopIpcControlFrameSchema = z.discriminatedUnion("control", [
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("control"),
    control: z.literal("runtime.hello"),
    payload: z.strictObject({
      startupId: IdSchema,
      runtimeId: IdSchema,
      sidecarVersion: z.string().min(1),
      supportedProtocolVersions: z.array(z.literal(DESKTOP_IPC_PROTOCOL_VERSION)).min(1),
    }),
  }),
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("control"),
    control: z.literal("runtime.initialize"),
    payload: z.strictObject({
      startupId: IdSchema,
      selectedProtocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
      backendUrl: z.string().url(),
      auth: AuthStateSchema,
      replacesRuntimeId: IdSchema.optional(),
    }),
  }),
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("control"),
    control: z.literal("runtime.ready"),
    payload: z.strictObject({ runtimeId: IdSchema, capabilities: CapabilitySetSchema }),
  }),
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("control"),
    control: z.literal("auth.update"),
    payload: z.strictObject({ auth: AuthStateSchema }),
  }),
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("control"),
    control: z.literal("runtime.shutdown"),
    payload: EmptyPayloadSchema,
  }),
  z.strictObject({
    protocolVersion: z.literal(DESKTOP_IPC_PROTOCOL_VERSION),
    kind: z.literal("control"),
    control: z.literal("runtime.shutdown.ack"),
    payload: z.strictObject({ runtimeId: IdSchema }),
  }),
]);

export type DesktopIpcControlFrame = z.infer<typeof DesktopIpcControlFrameSchema>;

export const DesktopIpcFrameSchema = z.union([
  DesktopIpcControlFrameSchema,
  DesktopIpcRequestFrameSchema,
  DesktopIpcResponseFrameSchema,
  DesktopIpcEventFrameSchema,
]);

export type DesktopIpcFrame = z.infer<typeof DesktopIpcFrameSchema>;

export const DesktopRuntimeBootstrapSchema = z.strictObject({
  type: z.literal("runtime.bootstrap"),
  startupId: IdSchema,
  appVersion: z.string().min(1),
  supportedProtocolVersions: z.array(z.literal(DESKTOP_IPC_PROTOCOL_VERSION)).min(1),
});

export type DesktopRuntimeBootstrap = z.infer<typeof DesktopRuntimeBootstrapSchema>;

export interface DesktopIpcMethodResultMap {
  "session.create": Session;
  "session.list": Page<Session>;
  "session.getSnapshot": SessionSnapshot;
  "session.update": Session;
  "session.subscribe": null;
  "session.unsubscribe": null;
  "turn.submit": { turn: Turn };
  "turn.cancel": null;
  "runtime.getCapabilities": CapabilitySet;
  "workspace.get": WorkspaceSummary | null;
  "workspace.configure": WorkspaceSummary;
  "workspace.clear": null;
}

const DesktopIpcMethodResultSchemas = {
  "session.create": SessionSchema,
  "session.list": SessionPageSchema,
  "session.getSnapshot": SessionSnapshotSchema,
  "session.update": SessionSchema,
  "session.subscribe": z.null(),
  "session.unsubscribe": z.null(),
  "turn.submit": z.strictObject({ turn: TurnSchema }),
  "turn.cancel": z.null(),
  "runtime.getCapabilities": CapabilitySetSchema,
  "workspace.get": WorkspaceSummarySchema.nullable(),
  "workspace.configure": WorkspaceSummarySchema,
  "workspace.clear": z.null(),
} satisfies Record<DesktopIpcMethod, z.ZodType>;

export function parseDesktopIpcFrame(value: unknown): DesktopIpcFrame {
  return parseDesktopIpcValue(DesktopIpcFrameSchema, value, "frame");
}

export function parseDesktopRuntimeBootstrap(value: unknown): DesktopRuntimeBootstrap {
  return parseDesktopIpcValue(DesktopRuntimeBootstrapSchema, value, "bootstrap");
}

export function parseDesktopIpcMethodResult<TMethod extends DesktopIpcMethod>(
  method: TMethod,
  value: unknown,
): DesktopIpcMethodResultMap[TMethod] {
  const schema = DesktopIpcMethodResultSchemas[method] as z.ZodType<unknown>;
  return parseDesktopIpcValue(
    schema,
    value,
    `result.${method}`,
  ) as DesktopIpcMethodResultMap[TMethod];
}

export function desktopIpcFrameSize(value: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("Invalid Desktop IPC frame: frame is not serializable");
  }
  if (serialized === undefined) {
    throw new TypeError("Invalid Desktop IPC frame: frame is not serializable");
  }
  return new TextEncoder().encode(serialized).byteLength;
}

export function assertDesktopIpcFrameSize(value: unknown): void {
  if (desktopIpcFrameSize(value) > DESKTOP_IPC_MAX_FRAME_BYTES) {
    throw new TypeError("Invalid Desktop IPC frame: frame exceeds 1 MiB");
  }
}

function parseDesktopIpcValue<TOutput>(
  schema: z.ZodType<TOutput>,
  value: unknown,
  path: string,
): TOutput {
  assertDesktopIpcFrameSize(value);
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const issuePath = issue?.path.length ? `.${issue.path.map(String).join(".")}` : "";
  throw new TypeError(
    `Invalid Desktop IPC ${path}${issuePath}: ${issue?.message ?? "payload is invalid"}`,
  );
}

export type DesktopAgentEvent = AgentEventEnvelope;

function isAbsoluteWorkspaceDirectory(value: string): boolean {
  if (value.includes("\0")) return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
