/**
 * Agent Loop 的可配置安全限制（设计文档 6.3）。
 * 数值属于配置，不属于协议；由 Runtime 应用服务注入。
 */
export interface TurnLimits {
  /** 最大模型步骤数 */
  maxSteps: number;
  /** 单 Turn 总 Token 预算 */
  maxTokens: number;
  /** 相同 Tool Call 连续重复达到此次数即熔断 */
  maxRepeatedToolCalls: number;
  /** 单次 Model Gateway 请求超时（毫秒） */
  gatewayTimeoutMs: number;
  /** 可重试错误的最大退避重试次数 */
  maxRetries: number;
}

export const DEFAULT_TURN_LIMITS: TurnLimits = {
  maxSteps: 8,
  maxTokens: 100_000,
  maxRepeatedToolCalls: 3,
  gatewayTimeoutMs: 60_000,
  maxRetries: 2,
};

export const DEFAULT_SYSTEM_PROMPT = [
  "You are Beecode, a coding assistant running inside a local CLI runtime.",
  "RULE: For ANY arithmetic or math evaluation you MUST call the calculator tool.",
  "Never compute arithmetic results yourself, even for trivial expressions like 1+1.",
  "After receiving the tool result, answer the user concisely.",
].join("\n");
