/**
 * Provider SSE 解析：把响应体切成 `data:` 事件负载。
 * 兼容 `\n\n`、`\r\n\r\n` 和 `\r\r` 事件边界，忽略 `[DONE]` 终止标记。
 */
export async function* sseEvents(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncIterable<string> {
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
        if (finalData && finalData !== "[DONE]") yield finalData;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const boundary = findSseBoundary(buffer);
        if (!boundary) break;
        const raw = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary.length);
        const data = dataFromSseEvent(raw);
        if (data && data !== "[DONE]") yield data;
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
  const data = rawEvent
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data || undefined;
}
