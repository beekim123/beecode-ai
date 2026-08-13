import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelStreamEvent } from "@beecode/protocol";
import { ModelGatewayService } from "../src/model/model-gateway-service.js";
import type { ProviderAdapter } from "../src/provider/adapter.js";
import { InMemoryBackendStore } from "../src/store.js";

describe("ModelGatewayService usage ledger", () => {
  it("charges cumulative usage idempotently by provider request", async () => {
    const store = new InMemoryBackendStore();
    const account = store.createAccount(100_000);
    const gateway = new ModelGatewayService(store, new CumulativeUsageProvider());
    const request: ModelRequest = {
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      maxOutputTokens: 16,
    };

    await consume(gateway.openStream(account.accountId, request, new AbortController().signal, {
      providerRequestId: "provider_request_1",
      turnId: "turn_1",
    }).events);
    await consume(gateway.openStream(account.accountId, request, new AbortController().signal, {
      providerRequestId: "provider_request_1",
      turnId: "turn_1",
    }).events);

    expect(store.getAccount(account.accountId)?.quotaUsedTokens).toBe(6);
    expect(gateway.getReservedTokens(account.accountId)).toBe(0);
  });
});

class CumulativeUsageProvider implements ProviderAdapter {
  readonly name = "cumulative-usage-test";

  async *stream(): AsyncIterable<ModelStreamEvent> {
    yield { type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } };
    yield { type: "usage", usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } };
    yield { type: "usage", usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } };
    yield { type: "finish", reason: "stop" };
  }
}

async function consume(events: AsyncIterable<ModelStreamEvent>): Promise<void> {
  for await (const _event of events) {
    // Consumption drives reservation release and ledger persistence.
  }
}
