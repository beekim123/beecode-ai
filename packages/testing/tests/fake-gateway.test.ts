import { describe, expect, it } from "vitest";
import type { ModelStreamEvent } from "@beecode/protocol";
import { FakeModelGateway, extractExpression } from "../src/fake-gateway.js";

describe("FakeModelGateway", () => {
  it("deterministically requests calculator for arithmetic", async () => {
    const gateway = new FakeModelGateway();
    const events: ModelStreamEvent[] = [];

    for await (const event of gateway.stream(
      { messages: [{ role: "user", content: "计算 1+1" }], tools: [] },
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      type: "tool_call",
      toolCall: expect.objectContaining({ name: "calculator", input: { expression: "1+1" } }),
    });
    expect(extractExpression("计算 12 * 3")).toBe("12 * 3");
  });
});
