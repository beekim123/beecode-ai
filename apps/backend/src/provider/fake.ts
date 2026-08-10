import { randomUUID } from "node:crypto";
import type { GatewayMessage, ModelRequest, ModelStreamEvent } from "@beecode/protocol";
import { fakeUsage, type ProviderAdapter } from "./adapter.js";

/**
 * 后端内置的确定性 Provider：开发/联调默认使用，
 * 保证“计算 1+1”必经真实 Tool Call 链路而不依赖外部模型概率。
 * 真实供应商通过 BEECODE_PROVIDER 切换。
 */
export class FakeProviderAdapter implements ProviderAdapter {
  readonly name = "fake";

  async *stream(request: ModelRequest, _signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const last = request.messages[request.messages.length - 1];
    if (last?.role === "tool") {
      let text: string;
      try {
        const parsed = JSON.parse(last.content) as { expression?: string; value?: number };
        text =
          typeof parsed.value === "number"
            ? `${parsed.expression ?? "?"} = ${parsed.value}`
            : `Tool result: ${last.content}`;
      } catch {
        text = `Tool result: ${last.content}`;
      }
      yield { type: "text_delta", text };
      yield { type: "usage", usage: fakeUsage(request) };
      yield { type: "finish", reason: "stop" };
      return;
    }

    const expression = last?.role === "user" ? extractExpression(last.content) : undefined;
    if (expression) {
      yield {
        type: "tool_call",
        toolCall: { id: `tc_${randomUUID()}`, name: "calculator", input: { expression } },
      };
      yield { type: "usage", usage: fakeUsage(request) };
      yield { type: "finish", reason: "tool_calls" };
      return;
    }

    const echo = last?.role === "user" ? last.content : "OK";
    yield { type: "text_delta", text: `Echo: ${echo}` };
    yield { type: "usage", usage: fakeUsage(request) };
    yield { type: "finish", reason: "stop" };
  }
}

function extractExpression(text: string): string | undefined {
  const match = text.match(/[0-9][0-9+\-*/%^().\s]*[0-9)]/);
  if (!match) return undefined;
  const candidate = match[0].trim();
  return /[+\-*/%^]/.test(candidate) ? candidate : undefined;
}

export type { GatewayMessage };
