import * as z from "zod";
import {
  BeecodeError,
  BeecodeErrorShapeSchema,
  parseAgentEventEnvelope,
  parseCapabilitySet,
  parseSession,
  parseSessionPage,
  parseSessionSnapshot,
  parseTurn,
  WorkspaceSummarySchema,
  type AgentEventEnvelope,
  type CapabilitySet,
  type Page,
  type Session,
  type SessionSnapshot,
  type Turn,
  type WorkspaceSummary,
} from "@beecode/protocol";

export const DESKTOP_CHANNELS = {
  authStatus: "desktop:auth-status",
  authLogin: "desktop:auth-login",
  authLogout: "desktop:auth-logout",
  authEvent: "desktop:auth-event",
  runtimeRequest: "desktop:runtime-request",
  runtimeStatus: "desktop:runtime-status",
  runtimeRetry: "desktop:runtime-retry",
  runtimeEvent: "desktop:runtime-event",
  workspaceSelect: "desktop:workspace-select",
} as const;

export const DesktopAuthStatusSchema = z.strictObject({
  state: z.enum(["unauthenticated", "authorizing", "authenticated", "error"]),
  accountId: z.string().min(1).optional(),
  persistence: z.enum(["encrypted", "memory_only"]),
  error: BeecodeErrorShapeSchema.optional(),
});

export type DesktopAuthStatus = z.infer<typeof DesktopAuthStatusSchema>;

export const DesktopRuntimeStatusSchema = z.strictObject({
  state: z.enum([
    "stopped",
    "starting",
    "handshaking",
    "ready",
    "stopping",
    "reconnecting",
    "unavailable",
  ]),
  runtimeId: z.string().min(1).optional(),
  error: BeecodeErrorShapeSchema.optional(),
});

export type DesktopRuntimeStatus = z.infer<typeof DesktopRuntimeStatusSchema>;

const RendererResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: BeecodeErrorShapeSchema }),
]);

export interface DesktopApi {
  auth: {
    getStatus(): Promise<DesktopAuthStatus>;
    login(): Promise<DesktopAuthStatus>;
    logout(): Promise<DesktopAuthStatus>;
    onStatus(listener: (status: DesktopAuthStatus) => void): () => void;
  };
  runtime: {
    getStatus(): Promise<DesktopRuntimeStatus>;
    createSession(title?: string): Promise<Session>;
    listSessions(): Promise<Page<Session>>;
    getSessionSnapshot(sessionId: string): Promise<SessionSnapshot>;
    updateSession(input: {
      sessionId: string;
      expectedVersion: number;
      title?: string;
      status?: Session["status"];
    }): Promise<Session>;
    subscribe(sessionId: string): Promise<void>;
    unsubscribe(sessionId: string): Promise<void>;
    submitMessage(sessionId: string, text: string): Promise<{ turn: Turn }>;
    cancelTurn(sessionId: string, turnId: string): Promise<void>;
    getCapabilities(): Promise<CapabilitySet>;
    retry(): Promise<DesktopRuntimeStatus>;
    onEvent(listener: (event: AgentEventEnvelope) => void): () => void;
    onStatus(listener: (status: DesktopRuntimeStatus) => void): () => void;
  };
  workspace: {
    get(): Promise<WorkspaceSummary | null>;
    select(): Promise<WorkspaceSummary | null>;
    clear(): Promise<void>;
  };
}

export function parseRendererResponse(value: unknown): unknown {
  const result = RendererResponseSchema.parse(value);
  if (!result.ok) throw BeecodeError.fromShape(result.error);
  return result.value;
}

export const desktopResultParsers = {
  createSession: parseSession,
  listSessions: parseSessionPage,
  getSessionSnapshot: parseSessionSnapshot,
  updateSession: parseSession,
  submitMessage(value: unknown): { turn: Turn } {
    const record = z.strictObject({ turn: z.unknown() }).parse(value);
    return { turn: parseTurn(record.turn) };
  },
  getCapabilities: parseCapabilitySet,
  authStatus(value: unknown): DesktopAuthStatus {
    return DesktopAuthStatusSchema.parse(value);
  },
  runtimeStatus(value: unknown): DesktopRuntimeStatus {
    return DesktopRuntimeStatusSchema.parse(value);
  },
  agentEvent(value: unknown): AgentEventEnvelope {
    return parseAgentEventEnvelope(value);
  },
  workspace(value: unknown): WorkspaceSummary {
    return WorkspaceSummarySchema.parse(value);
  },
  optionalWorkspace(value: unknown): WorkspaceSummary | null {
    return WorkspaceSummarySchema.nullable().parse(value);
  },
};
