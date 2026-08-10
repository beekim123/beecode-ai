import {
  BeecodeError,
  ErrorCodes,
  parseModelStreamEvent,
  type ModelGateway,
  type ModelRequest,
  type ModelStreamEvent,
} from "@beecode/protocol";
import { toBeecodeError } from "./backend-client.js";

interface HttpModelGatewayOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/**
 * 生产 Model Gateway 实现：把标准化模型请求发给 Beecode 后端，
 * 以 SSE 语义接收标准化模型流（设计文档第 8 节）。
 * 供应商名称、密钥与私有响应不经过这一层。
 */
export class HttpModelGateway implements ModelGateway {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpModelGatewayOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/model/stream`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/event-stream",
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify(request),
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw err;
      throw new BeecodeError(
        ErrorCodes.MODEL_UNAVAILABLE,
        `Cannot reach Beecode model gateway: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (!response.ok) {
      throw await toBeecodeError(response);
    }
    if (!response.body) {
      throw new BeecodeError(ErrorCodes.MODEL_STREAM_ERROR, "Model gateway returned no stream body", true);
    }

    for await (const data of parseSse(response.body, signal)) {
      let event: ModelStreamEvent;
      try {
        event = parseModelStreamEvent(JSON.parse(data));
      } catch {
        throw new BeecodeError(ErrorCodes.MODEL_STREAM_ERROR, "Malformed model stream event");
      }
      yield event;
      if (event.type === "finish" || event.type === "error") return;
    }
  }
}

/** 最小 SSE 解析：仅支持 data: 行，事件以空行分隔 */
async function* parseSse(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const onAbort = () => void reader.cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const finalData = dataFromSseEvent(buffer);
        if (finalData) yield finalData;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = findSseBoundary(buffer);
        if (!boundary) break;
        const rawEvent = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const data = dataFromSseEvent(rawEvent);
        if (data) yield data;
      }
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function findSseBoundary(buffer: string): { index: number; length: number } | undefined {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : undefined;
}

function dataFromSseEvent(rawEvent: string): string | undefined {
  const dataLines = rawEvent
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return dataLines.length > 0 ? dataLines.join("\n") : undefined;
}
