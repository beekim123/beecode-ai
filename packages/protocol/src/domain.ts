/**
 * 领域对象：第一阶段最小集合。
 * 见 docs/development/phase-1-cli-development-design.md 第 7 节。
 */

export type Id = string;

/**
 * 产品端标识。第一阶段只有 cli；后续扩展 desktop/web/android/ios 时
 * 只允许在这里扩展，后端按 surface 做数据隔离。
 */
export type Surface = "cli";

export type SessionStatus = "active" | "archived";

export interface Session {
  id: Id;
  /** 固定为 "cli"，后端拒绝客户端覆盖为其他 Surface */
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

/** Runtime 对外声明的安全能力 */
export interface Capability {
  tools: string[];
  surfaces: Surface[];
  maxTurnSteps: number;
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
