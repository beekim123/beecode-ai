import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelStreamEvent } from "@beecode/protocol";
import { AnthropicProviderAdapter } from "../../src/provider/anthropic.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnthropicProviderAdapter", () => {
  it("maps validated provider SSE into normalized model events", async () => {
    const providerEvents = [
      { type: "message_start", message: { usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", usage: { output_tokens: 2 }, delta: { stop_reason: "end_turn" } },
    ];
    const sse = providerEvents.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(sse, { status: 200 })));
    const adapter = new AnthropicProviderAdapter({ apiKey: "test-key", model: "test-model" });
    const events: ModelStreamEvent[] = [];

    for await (const event of adapter.stream(
      { messages: [{ role: "user", content: "hi" }], tools: [], maxOutputTokens: 32 },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "hello" },
      { type: "usage", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
      { type: "finish", reason: "stop" },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({ body: expect.stringContaining('"max_tokens":32') }),
    );
  });

  it("rejects malformed provider payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"type":1}\n\n', { status: 200 })));
    const adapter = new AnthropicProviderAdapter({ apiKey: "test-key" });
    const consume = async () => {
      for await (const _event of adapter.stream(
        { messages: [{ role: "user", content: "hi" }], tools: [] },
        new AbortController().signal,
      )) {
        // Consume the stream to surface adapter validation errors.
      }
    };

    await expect(consume()).rejects.toMatchObject({ code: "MODEL_STREAM_ERROR" });
  });
});
