import { BeecodeError, ErrorCodes, type GatewayMessage, type ModelRequest, type ModelStreamEvent, type Usage } from "@beecode/protocol";
import type { ProviderAdapter } from "./adapter.js";
import { sseEvents } from "./sse.js";
import {
  optionalTokenCount,
  providerProtocolError,
  requireIndex,
  requireRecord,
  requireString,
} from "./validate.js";

/**
 * Anthropic Provider Adapter：供应商 SDK/密钥只存在于后端。
 * 把标准化模型请求转换为 Anthropic Messages API 流式请求，
 * 再把供应商私有事件转换回标准化模型流。
 */
export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; model?: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "claude-haiku-4-5-20251001";
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxOutputTokens ?? 4096,
        stream: true,
        ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        messages: toAnthropicMessages(request.messages),
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
    // 按 tool_use block 累积 input JSON
    const pendingTools = new Map<number, { id: string; name: string; json: string }>();
    let usage: Usage | undefined;

    for await (const raw of sseEvents(body, signal)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw providerProtocolError("Provider emitted malformed JSON");
      }
      const event = requireRecord(parsed, "event");
      const type = requireString(event.type, "event.type");

      if (type === "content_block_start") {
        const block = requireRecord(event.content_block, "event.content_block");
        if (requireString(block.type, "event.content_block.type") === "tool_use") {
          pendingTools.set(requireIndex(event.index, "event.index"), {
            id: requireString(block.id, "event.content_block.id"),
            name: requireString(block.name, "event.content_block.name"),
            json: "",
          });
        }
      } else if (type === "content_block_delta") {
        const delta = requireRecord(event.delta, "event.delta");
        const deltaType = requireString(delta.type, "event.delta.type");
        if (deltaType === "text_delta") {
          yield { type: "text_delta", text: requireString(delta.text, "event.delta.text") };
        } else if (deltaType === "input_json_delta") {
          const pending = pendingTools.get(requireIndex(event.index, "event.index"));
          if (pending) pending.json += requireString(delta.partial_json, "event.delta.partial_json");
        }
      } else if (type === "content_block_stop") {
        const index = requireIndex(event.index, "event.index");
        const pending = pendingTools.get(index);
        if (pending) {
          pendingTools.delete(index);
          let input: unknown = {};
          try {
            input = pending.json ? JSON.parse(pending.json) : {};
          } catch {
            // 保留空 input，由 Tool 校验给出结构化错误
          }
          yield { type: "tool_call", toolCall: { id: pending.id, name: pending.name, input } };
        }
      } else if (type === "message_start") {
        const message = requireRecord(event.message, "event.message");
        if (message.usage !== undefined) {
          const providerUsage = requireRecord(message.usage, "event.message.usage");
          const inputTokens = optionalTokenCount(providerUsage.input_tokens, "event.message.usage.input_tokens");
          const outputTokens = optionalTokenCount(providerUsage.output_tokens, "event.message.usage.output_tokens");
          usage = {
            inputTokens,
            outputTokens,
            totalTokens: inputTokens + outputTokens,
          };
        }
      } else if (type === "message_delta") {
        const deltaUsage = event.usage === undefined
          ? undefined
          : optionalTokenCount(requireRecord(event.usage, "event.usage").output_tokens, "event.usage.output_tokens");
        if (usage && deltaUsage !== undefined) {
          usage = { ...usage, outputTokens: deltaUsage, totalTokens: usage.inputTokens + deltaUsage };
        }
        const delta = requireRecord(event.delta, "event.delta");
        const stopReason = delta.stop_reason;
        if (stopReason !== undefined && stopReason !== null) {
          const normalizedStopReason = requireString(stopReason, "event.delta.stop_reason");
          yield { type: "usage", usage: usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
          yield {
            type: "finish",
            reason: normalizeStopReason(normalizedStopReason),
          };
        }
      } else if (type === "error") {
        yield {
          type: "error",
          error: { code: ErrorCodes.MODEL_STREAM_ERROR, message: "Model provider stream error", retryable: true },
        };
        return;
      }
    }
  }
}

type AnthropicMessage = { role: "user" | "assistant"; content: unknown };

function toAnthropicMessages(messages: GatewayMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: message.content }] });
    } else if (message.role === "assistant") {
      const content: unknown[] = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) {
        content.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: "assistant", content });
    } else {
      // tool 结果在 Anthropic 协议中是 user 消息
      out.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.toolCallId, content: message.content }],
      });
    }
  }
  return out;
}

function normalizeStopReason(reason: string): "stop" | "tool_calls" | "length" {
  if (reason === "tool_use") return "tool_calls";
  if (reason === "max_tokens") return "length";
  return "stop";
}
