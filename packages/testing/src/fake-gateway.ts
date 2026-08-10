import type {
  GatewayMessage,
  ModelGateway,
  ModelRequest,
  ModelStreamEvent,
  Usage,
} from "@beecode/protocol";

/**
 * Fake Model Gateway（设计文档 13.2）：
 * 自动化测试中确定性地产生 Tool Call，而不是依赖真实模型概率。
 *
 * 默认行为（calculator 闭环）：
 * - 最后一条 user 消息含可提取的算术表达式 → 产生 calculator Tool Call。
 * - 最后一条是 tool 结果 → 产出最终文本回答。
 * 也可以通过 steps 队列完全脚本化每一步输出。
 */

export type FakeStep =
  | { kind: "tool_call"; name: string; input: unknown }
  | { kind: "text"; text: string }
  | { kind: "error"; code: string; message: string; retryable?: boolean };

export interface FakeModelGatewayOptions {
  /** 脚本化步骤；提供后不再使用默认算术行为 */
  steps?: FakeStep[];
  /** 记录收到的请求，供断言 */
  onRequest?: (request: ModelRequest) => void;
  /** 每个流事件之间的延迟（毫秒），用于取消场景测试 */
  eventDelayMs?: number;
}

const FAKE_USAGE: Usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

export class FakeModelGateway implements ModelGateway {
  private readonly steps: FakeStep[] | undefined;
  private readonly onRequest?: (request: ModelRequest) => void;
  private readonly eventDelayMs: number;
  private stepIndex = 0;
  readonly requests: ModelRequest[] = [];

  constructor(options: FakeModelGatewayOptions = {}) {
    this.steps = options.steps;
    this.onRequest = options.onRequest;
    this.eventDelayMs = options.eventDelayMs ?? 0;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    this.onRequest?.(request);

    const step = this.steps ? this.steps[this.stepIndex++] : this.inferStep(request.messages);
    if (!step) {
      yield { type: "error", error: { code: "MODEL_STREAM_ERROR", message: "Fake gateway: no scripted step", retryable: false } };
      return;
    }

    switch (step.kind) {
      case "tool_call":
        for await (const event of this.withDelay(
          [
            { type: "tool_call", toolCall: { id: `fake_tc_${this.stepIndex}_${this.requests.length}`, name: step.name, input: step.input } },
            { type: "usage", usage: FAKE_USAGE },
            { type: "finish", reason: "tool_calls" as const },
          ],
          signal,
        )) {
          yield event;
        }
        return;
      case "text": {
        const events: ModelStreamEvent[] = step.text.split(/(?<= )/).map((chunk) => ({
          type: "text_delta" as const,
          text: chunk,
        }));
        events.push({ type: "usage", usage: FAKE_USAGE }, { type: "finish", reason: "stop" });
        for await (const event of this.withDelay(events, signal)) yield event;
        return;
      }
      case "error":
        yield {
          type: "error",
          error: { code: step.code, message: step.message, retryable: step.retryable ?? false },
        };
        return;
    }
  }

  private async *withDelay(events: ModelStreamEvent[], signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    for (const event of events) {
      if (signal.aborted) return;
      if (this.eventDelayMs > 0) await delay(this.eventDelayMs, signal);
      if (signal.aborted) return;
      yield event;
    }
  }

  /** 默认确定性行为：从 user 文本提取算术表达式 → calculator；tool 结果 → 最终回答 */
  private inferStep(messages: GatewayMessage[]): FakeStep {
    const last = messages[messages.length - 1];
    if (last?.role === "tool") {
      try {
        const parsed = JSON.parse(last.content) as { expression?: string; value?: number };
        if (typeof parsed.value === "number") {
          return { kind: "text", text: `${parsed.expression ?? "?"} = ${parsed.value}` };
        }
      } catch {
        // fall through
      }
      return { kind: "text", text: `Tool result: ${last.content}` };
    }
    if (last?.role === "user") {
      const expression = extractExpression(last.content);
      if (expression) {
        return { kind: "tool_call", name: "calculator", input: { expression } };
      }
      return { kind: "text", text: `Echo: ${last.content}` };
    }
    return { kind: "text", text: "OK" };
  }
}

/** 从自然语言中提取一个简单算术表达式，如 “计算 1+1” → “1+1” */
export function extractExpression(text: string): string | undefined {
  const match = text.match(/[0-9][0-9+\-*/%^().\s]*[0-9)]/);
  if (!match) return undefined;
  const candidate = match[0].trim();
  return /[+\-*/%^]/.test(candidate) ? candidate : undefined;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
