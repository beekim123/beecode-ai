import type {
  BeecodeErrorShape,
  Capability,
  Id,
  Page,
  Session,
  SessionSnapshot,
  ToolCall,
  Turn,
  Usage,
} from "./domain.js";

/**
 * Agent Protocol：面向所有产品客户端的契约（设计文档 4.1）。
 * Transport 只改变传输方式，不改变命令、错误、事件或状态语义。
 */

// ---- 在线事件（仅用于在线展示，不作为持久数据源）----

export type AgentEvent =
  | TurnStartedEvent
  | MessageDeltaEvent
  | ToolRequestedEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | ToolFailedEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | TurnCancelledEvent;

/**
 * 在线事件的稳定信封。sequence 只在当前 Runtime 实例和 Session 内单调递增，
 * 不能作为永久事件历史的恢复游标。
 */
export interface AgentEventEnvelope<TEvent extends AgentEvent = AgentEvent> {
  eventId: Id;
  sessionId: Id;
  turnId?: Id;
  sequence: number;
  occurredAt: string;
  event: TEvent;
}

interface EventBase {
  sessionId: Id;
  turnId: Id;
}

export interface TurnStartedEvent extends EventBase {
  type: "turn.started";
  turn: Turn;
}

export interface MessageDeltaEvent extends EventBase {
  type: "message.delta";
  messageId: Id;
  partId: Id;
  textDelta: string;
}

export interface ToolRequestedEvent extends EventBase {
  type: "tool.requested";
  messageId: Id;
  partId: Id;
  toolCall: ToolCall;
}

export interface ToolStartedEvent extends EventBase {
  type: "tool.started";
  toolCallId: Id;
}

export interface ToolCompletedEvent extends EventBase {
  type: "tool.completed";
  toolCall: ToolCall;
}

export interface ToolFailedEvent extends EventBase {
  type: "tool.failed";
  toolCall: ToolCall;
}

export interface TurnCompletedEvent extends EventBase {
  type: "turn.completed";
  usage?: Usage;
}

export interface TurnFailedEvent extends EventBase {
  type: "turn.failed";
  error: BeecodeErrorShape;
}

export interface TurnCancelledEvent extends EventBase {
  type: "turn.cancelled";
}

// ---- 服务接口（Client SDK 与任意 Transport 的公共语义）----

export interface CreateSessionInput {
  title?: string;
}

export interface ListSessionsInput {
  cursor?: string;
  limit?: number;
}

export type ListSessionsResult = Page<Session>;

export interface UpdateSessionInput {
  sessionId: Id;
  expectedVersion: number;
  title?: string;
  status?: Session["status"];
}

export interface SubmitMessageInput {
  sessionId: Id;
  text: string;
  /** Web 网络重试时用于防止重复创建 Message 与 Turn。 */
  idempotencyKey?: string;
}

export interface SubmitMessageResult {
  turn: Turn;
}

export interface AgentProtocolService {
  createSession(input: CreateSessionInput): Promise<Session>;
  listSessions(input?: ListSessionsInput): Promise<ListSessionsResult>;
  getSessionSnapshot(sessionId: Id): Promise<SessionSnapshot>;
  updateSession(input: UpdateSessionInput): Promise<Session>;
  submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult>;
  cancelTurn(sessionId: Id, turnId: Id): Promise<void>;
  /**
   * 订阅 Session 的在线事件。取消订阅调用返回的 unsubscribe。
   * 语义等价于 SSE：断线或重启后调用方重新拉取完整快照。
   */
  subscribe(sessionId: Id, handler: (event: AgentEventEnvelope) => void): () => void;
  getCapabilities(): Promise<Capability>;
}
