import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AgentRuntime } from "@beecode/agent-core";
import { HttpModelGateway } from "@beecode/agent-server";
import { createDefaultToolRegistry } from "@beecode/tools";
import { createBackendServer } from "../http.js";
import { InMemoryBackendStore } from "../store.js";
import { AnthropicProviderAdapter } from "./anthropic.js";

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for the real-model smoke test");

  const provider = new AnthropicProviderAdapter({
    apiKey,
    model: process.env.ANTHROPIC_MODEL,
  });
  const server = createBackendServer(new InMemoryBackendStore(), provider, {
    quotaLimitTokens: 100_000,
  });

  try {
    const baseUrl = await listen(server);
    const login = await fetch(`${baseUrl}/v1/auth/dev-token`, { method: "POST" });
    if (!login.ok) throw new Error(`Smoke login failed with HTTP ${login.status}`);
    const loginBody: unknown = await login.json();
    if (typeof loginBody !== "object" || loginBody === null || !("token" in loginBody)) {
      throw new Error("Smoke login returned an invalid response");
    }
    const token = (loginBody as { token: unknown }).token;
    if (typeof token !== "string") throw new Error("Smoke login returned an invalid token");

    const tools = createDefaultToolRegistry();
    const runtime = new AgentRuntime({
      gateway: new HttpModelGateway({ baseUrl, token }),
      tools,
      surface: "cli",
    });
    let calculatorResult: unknown;
    let finalText = "";
    runtime.onEvent((event) => {
      if (event.type === "tool.completed" && event.toolCall.name === "calculator") {
        calculatorResult = event.toolCall.output;
      }
      if (event.type === "message.delta") finalText += event.textDelta;
    });

    const result = await runtime.runTurn({
      sessionId: "ses_real_model_smoke",
      turnIndex: 1,
      history: [],
      userText: "计算 1+1",
    });
    if (result.outcome !== "completed") {
      throw new Error(`Real-model smoke failed: ${result.error?.code ?? result.outcome}`);
    }
    if (
      typeof calculatorResult !== "object" ||
      calculatorResult === null ||
      !("value" in calculatorResult) ||
      calculatorResult.value !== 2
    ) {
      throw new Error(`Real model did not complete calculator(1+1): ${JSON.stringify(calculatorResult)}`);
    }
    if (!finalText.includes("2")) throw new Error("Real model final answer did not contain 2");

    process.stdout.write(`Real-model smoke passed. Tokens: ${result.usage?.totalTokens ?? "unknown"}\n`);
  } finally {
    await close(server);
  }
}

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
