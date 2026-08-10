import type { ModelRequest, ModelStreamEvent, Usage } from "@beecode/protocol";

/**
 * Provider Adapter（设计文档第 8 节）：
 * 供应商协议适配只存在于后端；对 Runtime 只暴露标准化模型流。
 */
export interface ProviderAdapter {
  readonly name: string;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export function fakeUsage(request: ModelRequest): Usage {
  const inputTokens = request.messages.reduce((sum, m) => sum + Math.ceil(JSON.stringify(m).length / 4), 0);
  return { inputTokens, outputTokens: 20, totalTokens: inputTokens + 20 };
}
