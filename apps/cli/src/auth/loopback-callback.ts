import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface LoopbackCallback {
  redirectUri: string;
  waitForCode(): Promise<string>;
  close(): Promise<void>;
}

export async function createLoopbackCallback(options: {
  state: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<LoopbackCallback> {
  let settle: ((result: { code?: string; error?: Error }) => void) | undefined;
  const result = new Promise<{ code?: string; error?: Error }>((resolve) => {
    settle = resolve;
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404).end("Not found");
      return;
    }
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const providerError = url.searchParams.get("error");
    if (state !== options.state) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("OAuth state mismatch");
      settle?.({ error: new Error("OAuth state mismatch") });
      return;
    }
    if (providerError) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Authorization denied");
      settle?.({ error: new Error(`Authorization failed: ${providerError}`) });
      return;
    }
    if (!code) {
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Missing authorization code");
      settle?.({ error: new Error("Authorization callback did not include a code") });
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end("<!doctype html><html><body><h1>Beecode CLI authorized</h1><p>You can close this tab.</p></body></html>");
    settle?.({ code });
  });

  await listenOnLoopback(server);
  const address = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${address.port}/callback`;
  const timeout = setTimeout(
    () => settle?.({ error: new Error("Timed out waiting for browser authorization") }),
    options.timeoutMs,
  );
  const onAbort = () => settle?.({ error: new Error("Browser authorization was cancelled") });
  options.signal?.addEventListener("abort", onAbort, { once: true });

  return {
    redirectUri,
    async waitForCode(): Promise<string> {
      const resolved = await result;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      if (resolved.error) throw resolved.error;
      if (!resolved.code) throw new Error("Authorization callback completed without a code");
      return resolved.code;
    },
    close: () => closeServer(server),
  };
}

function listenOnLoopback(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
