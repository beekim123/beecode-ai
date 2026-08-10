import { BeecodeError, ErrorCodes, type ModelRequest, type ModelStreamEvent, type Usage } from "@beecode/protocol";
import type { ProviderAdapter } from "./adapter.js";
import { sseEvents } from "./sse.js";
import { optionalTokenCount, providerProtocolError, requireArray, requireIndex, requireRecord } from "./validate.js";

/**
 * OpenAI 兼容 Provider Adapter：覆盖 DeepSeek、通义千问（DashScope 兼容模式）、
 * Kimi 等提供 OpenAI Chat Completions 协议的供应商，通过 baseUrl 切换。
 * 把标准化模型请求转换为 Chat Completions 流式请求，
 * 再把供应商私有事件转换回标准化模型流。
 */
export class OpenAiProviderAdapter implements ProviderAdapter {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxOutputTokens ?? 4096,
        stream: true,
        // 要求供应商在末尾补发 usage chunk；不支持的供应商会按零额度上报
        stream_options: { include_usage: true },
        messages: toOpenAiMessages(request),
        // 部分兼容供应商拒绝空 tools 数组
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
              })),
            }
          : {}),
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const retryable = response.status >= 500 || response.status === 429;
      throw new BeecodeError(
        retryable ? ErrorCodes.MODEL_UNAVAILABLE : ErrorCodes.MODEL_STREAM_ERROR,
        `Model provider request failed (HTTP ${response.status})`,
        retryable,
      );
    }

    yield* this.mapStream(response.body, signal);
  }

  private async *mapStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    // 按 tool_calls index 累积 arguments 分片；id 和 name 只在首个分片出现
    const pendingTools = new Map<number, { id: string; name: string; json: string }>();
    let usage: Usage | undefined;
    let finishReason: "stop" | "tool_calls" | "length" | undefined;

    for await (const raw of sseEvents(body, signal)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw providerProtocolError("Provider emitted malformed JSON");
      }
      const chunk = requireRecord(parsed, "chunk");

      if (chunk.usage !== undefined && chunk.usage !== null) {
        const providerUsage = requireRecord(chunk.usage, "chunk.usage");
        const inputTokens = optionalTokenCount(providerUsage.prompt_tokens, "chunk.usage.prompt_tokens");
        const outputTokens = optionalTokenCount(providerUsage.completion_tokens, "chunk.usage.completion_tokens");
        usage = { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
      }

      const choices = chunk.choices === undefined ? [] : requireArray(chunk.choices, "chunk.choices");
      for (const choiceValue of choices) {
        const choice = requireRecord(choiceValue, "chunk.choices[]");
        if (choice.delta !== undefined && choice.delta !== null) {
          const delta = requireRecord(choice.delta, "chunk.choices[].delta");
          if (typeof delta.content === "string" && delta.content.length > 0) {
            yield { type: "text_delta", text: delta.content };
          }
          if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
            for (const toolCallValue of requireArray(delta.tool_calls, "chunk.choices[].delta.tool_calls")) {
              const toolCall = requireRecord(toolCallValue, "chunk.choices[].delta.tool_calls[]");
              const index = requireIndex(toolCall.index, "chunk.choices[].delta.tool_calls[].index");
              let pending = pendingTools.get(index);
              if (!pending) {
                pending = { id: "", name: "", json: "" };
                pendingTools.set(index, pending);
              }
              if (typeof toolCall.id === "string") pending.id = toolCall.id;
              if (toolCall.function !== undefined && toolCall.function !== null) {
                const fn = requireRecord(toolCall.function, "chunk.choices[].delta.tool_calls[].function");
                if (typeof fn.name === "string") pending.name = fn.name;
                if (typeof fn.arguments === "string") pending.json += fn.arguments;
              }
            }
          }
        }
        if (typeof choice.finish_reason === "string") {
          finishReason = normalizeFinishReason(choice.finish_reason);
        }
      }
    }

    for (const pending of pendingTools.values()) {
      let input: unknown = {};
      try {
        input = pending.json ? JSON.parse(pending.json) : {};
      } catch {
        // 保留空 input，由 Tool 校验给出结构化错误
      }
      yield { type: "tool_call", toolCall: { id: pending.id, name: pending.name, input } };
    }
    if (finishReason !== undefined) {
      yield { type: "usage", usage: usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
      yield { type: "finish", reason: finishReason };
    }
  }
}

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
};

function toOpenAiMessages(request: ModelRequest): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  if (request.systemPrompt) {
    out.push({ role: "system", content: request.systemPrompt });
  }
  for (const message of request.messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
    } else if (message.role === "assistant") {
      out.push({
        role: "assistant",
        content: message.content || null,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              })),
            }
          : {}),
      });
    } else {
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: message.content });
    }
  }
  return out;
}

function normalizeFinishReason(reason: string): "stop" | "tool_calls" | "length" {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  return "stop";
}
