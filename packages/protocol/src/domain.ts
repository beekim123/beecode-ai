/** 产品协议的跨端领域对象。 */

export type Id = string;

export const SURFACES = ["cli", "web", "desktop", "android", "ios"] as const;
export type Surface = (typeof SURFACES)[number];

export type SessionStatus = "active" | "archived";

export interface Session {
  id: Id;
  /** 由服务端路由和策略决定，不能信任客户端覆盖。 */
  surface: Surface;
  accountId: Id;
  title: string;
  status: SessionStatus;
  /** 乐观并发版本号；写入时版本不一致必须拒绝 */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 持久化到后端的完整 Session 快照（含消息）。
 * CLI 重启后通过快照恢复，不回放历史事件。
 */
export interface SessionSnapshot {
  session: Session;
  messages: Message[];
  /** Turn 终态随 Session 一起持久化；在线事件不承担恢复职责。 */
  turns: Turn[];
  /** 活动 Runtime 投影；不存在时表示当前只有持久快照。 */
  live?: SessionLiveState;
}

export interface SessionLiveState {
  /** 当前 Runtime 实例内、当前 Session 的单调递增序号。 */
  sequence: number;
  activeTurnId?: Id;
}

export type TurnStatus =
  | "queued"
  | "running"
  | "model_streaming"
  | "tool_running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Turn {
  id: Id;
  sessionId: Id;
  /** Session 内的递增序号 */
  index: number;
  status: TurnStatus;
  userMessageId: Id;
  assistantMessageId?: Id;
  error?: BeecodeErrorShape;
  usage?: Usage;
  startedAt?: string;
  finishedAt?: string;
}

export type MessageRole = "user" | "assistant" | "tool";

export interface Message {
  id: Id;
  sessionId: Id;
  turnId?: Id;
  role: MessageRole;
  parts: Part[];
  createdAt: string;
}

export type Part = TextPart | ToolCallPart | ToolResultPart;

export interface TextPart {
  id: Id;
  type: "text";
  text: string;
}

export interface ToolCallPart {
  id: Id;
  type: "tool_call";
  toolCall: ToolCall;
}

export interface ToolResultPart {
  id: Id;
  type: "tool_result";
  toolCallId: Id;
  result: ToolResult;
}

export type ToolCallStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "rejected";

export interface ToolCall {
  id: Id;
  name: string;
  /** 已通过 Tool 输入 Schema 校验前的原始输入 */
  input: unknown;
  status: ToolCallStatus;
  output?: unknown;
  error?: BeecodeErrorShape;
}

export interface ToolResult {
  ok: boolean;
  output?: unknown;
  error?: BeecodeErrorShape;
}

export type RuntimeLocation = "local" | "backend";

export type CapabilityUnavailableReason =
  | "surface_policy"
  | "runtime_missing"
  | "not_configured"
  | "not_authorized";

export interface CapabilityState {
  available: boolean;
  reason?: CapabilityUnavailableReason;
}

export interface ToolCapability extends CapabilityState {
  name: string;
  description: string;
}

export interface CapabilityFeatures {
  localWorkspace: CapabilityState;
  shell: CapabilityState;
  git: CapabilityState;
  attachments: CapabilityState;
}

/** Runtime 对当前 surface 声明的安全能力。 */
export interface CapabilitySet {
  surface: Surface;
  runtimeLocation: RuntimeLocation;
  tools: ToolCapability[];
  features: CapabilityFeatures;
  limits: {
    maxTurnSteps: number;
    maxInputBytes: number;
  };
}

/** @deprecated 使用 CapabilitySet；保留别名以便第一阶段调用方渐进迁移。 */
export type Capability = CapabilitySet;

export interface Page<TItem> {
  items: TItem[];
  /** 不透明游标；客户端不得解析内部字段。 */
  nextCursor: string | null;
}

export interface AccountSummary {
  accountId: Id;
  createdAt: string;
}

export interface QuotaSnapshot {
  accountId: Id;
  quotaLimitTokens: number;
  quotaUsedTokens: number;
  quotaReservedTokens: number;
}

/** 标准化用量；供应商私有字段不允许出现在这里 */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * 稳定产品错误形状。错误码面向所有端稳定，message 可读。
 * 不携带供应商密钥、访问令牌等敏感信息。
 */
export interface BeecodeErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}
