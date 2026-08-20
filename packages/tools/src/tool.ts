import type { Id, Surface, ToolResult, ToolSchema } from "@beecode/protocol";

/**
 * Tool 契约（设计文档第 9 节）。
 * 工具不输出终端文本，只返回结构化状态和结果。
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  /** 提供给模型的 JSON Schema */
  readonly inputSchema: Record<string, unknown>;
  /** 运行时校验输入；不合法时返回结构化错误信息字符串，合法返回 null */
  validate(input: unknown): string | null;
  /** 无副作用执行；抛出的错误会被 Registry 转换为安全错误 */
  execute(input: TInput, ctx: ToolExecutionContext): Promise<TOutput>;
  /** Dynamic host state such as a selected Workspace may hide a registered tool. */
  isAvailable?(): boolean;
  /** 该工具在哪些 Surface 可用；缺省表示全部可用 */
  readonly surfaces?: Surface[];
}

export interface ToolExecutionContext {
  signal: AbortSignal;
  sessionId?: Id;
  turnId?: Id;
  toolCallId?: Id;
}

export interface RegisteredTool {
  schema: ToolSchema;
  tool: Tool;
}

export interface ToolRegistryOptions {
  /** 单条工具结果的最大序列化长度，防止超大输出撑爆上下文 */
  maxResultBytes?: number;
  /** 工具执行超时（毫秒） */
  executionTimeoutMs?: number;
}

export interface ToolExecutionRecord {
  result: ToolResult;
  durationMs: number;
}
