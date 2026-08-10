import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelStreamEvent } from "@beecode/protocol";
import { OpenAiProviderAdapter } from "../../src/provider/openai.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function sseResponse(chunks: unknown[]): Response {
  const sse = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n";
  return new Response(sse, { status: 200 });
}

async function collectEvents(adapter: OpenAiProviderAdapter): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = [];
  for await (const event of adapter.stream(
    { messages: [{ role: "user", content: "hi" }], tools: [], maxOutputTokens: 32 },
    new AbortController().signal,
  )) {
    events.push(event);
  }
  return events;
}

describe("OpenAiProviderAdapter", () => {
  it("maps validated provider SSE into normalized model events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          { choices: [{ delta: { content: "hello" }, finish_reason: null }] },
          { choices: [{ delta: {}, finish_reason: "stop" }] },
          { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } },
        ]),
      ),
    );
    const adapter = new OpenAiProviderAdapter({ apiKey: "test-key", model: "test-model" });

    const events = await collectEvents(adapter);

    expect(events).toEqual([
      { type: "text_delta", text: "hello" },
      { type: "usage", usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
      { type: "finish", reason: "stop" },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({ body: expect.stringContaining('"max_tokens":32') }),
    );
  });

  it("assembles streamed tool call fragments", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_1", function: { name: "calculator", arguments: '{"ex' } },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: { tool_calls: [{ index: 0, function: { arguments: 'pression":"1+1"}' } }] },
                finish_reason: "tool_calls",
              },
            ],
          },
          { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } },
        ]),
      ),
    );
    const adapter = new OpenAiProviderAdapter({ apiKey: "test-key", model: "test-model" });

    const events = await collectEvents(adapter);

    expect(events).toEqual([
      { type: "tool_call", toolCall: { id: "call_1", name: "calculator", input: { expression: "1+1" } } },
      { type: "usage", usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } },
      { type: "finish", reason: "tool_calls" },
    ]);
  });

  it("honors a custom baseUrl for OpenAI-compatible providers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse([{ choices: [{ delta: {}, finish_reason: "stop" }] }])),
    );
    const adapter = new OpenAiProviderAdapter({
      apiKey: "test-key",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com/v1",
    });

    await collectEvents(adapter);

    expect(fetch).toHaveBeenCalledWith(
      "https://api.deepseek.com/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
      }),
    );
  });

  it("rejects malformed provider payloads", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('data: {"choices":1}\n\n', { status: 200 })));
    const adapter = new OpenAiProviderAdapter({ apiKey: "test-key", model: "test-model" });

    await expect(collectEvents(adapter)).rejects.toMatchObject({ code: "MODEL_STREAM_ERROR" });
  });
});
