import { describe, expect, it } from "vitest";
import { ErrorCodes, type ModelStreamEvent } from "@beecode/protocol";
import { HttpBackendClient } from "../src/backend-client.js";
import { HttpModelGateway } from "../src/model-gateway-client.js";

describe("HTTP runtime clients", () => {
  it("parses CRLF SSE events and validates their payloads", async () => {
    const events: ModelStreamEvent[] = [
      { type: "text_delta", text: "hello" },
      { type: "usage", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      { type: "finish", reason: "stop" },
    ];
    const body = events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
    const gateway = new HttpModelGateway({
      baseUrl: "http://backend.test",
      token: "token",
      fetchImpl: async () => new Response(body, { status: 200 }),
    });

    const received: ModelStreamEvent[] = [];
    for await (const event of gateway.stream(
      { messages: [{ role: "user", content: "hi" }], tools: [] },
      new AbortController().signal,
    )) {
      received.push(event);
    }

    expect(received).toEqual(events);
  });

  it("rejects malformed backend and model payloads", async () => {
    const backend = new HttpBackendClient({
      baseUrl: "http://backend.test",
      token: "token",
      fetchImpl: async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
    });
    await expect(backend.listSessions()).rejects.toMatchObject({ code: ErrorCodes.SYNC_FAILED });

    const gateway = new HttpModelGateway({
      baseUrl: "http://backend.test",
      token: "token",
      fetchImpl: async () =>
        new Response('data: {"type":"finish","reason":"invalid"}\n\n', { status: 200 }),
    });
    const consume = async () => {
      for await (const _event of gateway.stream(
        { messages: [{ role: "user", content: "hi" }], tools: [] },
        new AbortController().signal,
      )) {
        // Consume the full stream so parser failures reject this promise.
      }
    };
    await expect(consume()).rejects.toMatchObject({ code: ErrorCodes.MODEL_STREAM_ERROR });
  });
});
