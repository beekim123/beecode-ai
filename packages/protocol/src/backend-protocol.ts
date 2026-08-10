import type { BeecodeErrorShape, Usage } from "./domain.js";

/**
 * Runtime Backend Protocol：Runtime 与 Beecode 后端的契约（设计文档 4.2）。
 * 模型供应商名称、密钥和供应商私有响应不允许出现在这一层。
 */

// ---- 模型请求 ----

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON Schema 对象 */
  inputSchema: Record<string, unknown>;
}

export type GatewayMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: GatewayToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export interface GatewayToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelRequest {
  messages: GatewayMessage[];
  systemPrompt?: string;
  tools: ToolSchema[];
  /** Provider 单次生成上限，也用于后端在请求前预留额度。 */
  maxOutputTokens?: number;
}

// ---- 标准化模型流事件（SSE 语义）----

export type ModelStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; toolCall: GatewayToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "finish"; reason: FinishReason }
  | { type: "error"; error: BeecodeErrorShape };

export type FinishReason = "stop" | "tool_calls" | "length";

/**
 * Agent Core 唯一依赖的模型网关接口。
 * 生产实现走 Beecode 后端 HTTP+SSE；测试实现是 FakeModelGateway。
 */
export interface ModelGateway {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}
