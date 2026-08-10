import { describe, expect, it } from "vitest";
import { ErrorCodes, type AgentEvent, type GatewayMessage } from "@beecode/protocol";
import { FakeModelGateway } from "@beecode/testing";
import { createDefaultToolRegistry } from "@beecode/tools";
import { AgentRuntime } from "../src/runtime.js";

function collectEvents(runtime: AgentRuntime): AgentEvent[] {
  const events: AgentEvent[] = [];
  runtime.onEvent((e) => events.push(e));
  return events;
}

describe("AgentRuntime", () => {
  it("输入“计算 1+1”产生 calculator Tool Call、结果 2 和最终回答", async () => {
    const gateway = new FakeModelGateway();
    const runtime = new AgentRuntime({ gateway, tools: createDefaultToolRegistry(), surface: "cli" });
    const events = collectEvents(runtime);

    const result = await runtime.runTurn({
      sessionId: "ses_test",
      turnIndex: 1,
      history: [],
      userText: "计算 1+1",
    });

    expect(result.outcome).toBe("completed");
    expect(result.turn.status).toBe("completed");
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 10, totalTokens: 30 });
    expect(result.turn.usage).toEqual(result.usage);

    const types = events.map((e) => e.type);
    expect(types).toContain("turn.started");
    expect(types).toContain("tool.requested");
    expect(types).toContain("tool.started");
    expect(types).toContain("tool.completed");
    expect(types).toContain("turn.completed");

    const requested = events.find((e) => e.type === "tool.requested");
    expect(requested?.type === "tool.requested" && requested.toolCall.name).toBe("calculator");
    expect(requested?.type === "tool.requested" && requested.toolCall.input).toEqual({ expression: "1+1" });

    const completed = events.find((e) => e.type === "tool.completed");
    expect(completed?.type === "tool.completed" && completed.toolCall.output).toEqual({
      expression: "1+1",
      value: 2,
    });

    // 最终回答包含计算结果
    const deltas = events.filter((e) => e.type === "message.delta").map((e) => e.textDelta).join("");
    expect(deltas).toContain("2");

    // 模型上下文包含 user → assistant(toolCalls) → tool 的完整链路
    const roles = result.appendedMessages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
  });

  it("无效 Tool 输入：标记 ToolCall 失败，不执行工具主体", async () => {
    const gateway = new FakeModelGateway({
      steps: [
        { kind: "tool_call", name: "calculator", input: { expression: 123 } },
        { kind: "text", text: "fallback" },
      ],
    });
    const runtime = new AgentRuntime({ gateway, tools: createDefaultToolRegistry(), surface: "cli" });
    const events = collectEvents(runtime);

    const result = await runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "x" });

    expect(result.outcome).toBe("completed");
    const failed = events.find((e) => e.type === "tool.failed");
    expect(failed?.type === "tool.failed" && failed.toolCall.error?.code).toBe(ErrorCodes.TOOL_INPUT_INVALID);
    // 失败后把结构化错误回传模型，继续生成最终回答
    const toolMessage = result.appendedMessages.find((m) => m.role === "tool");
    expect(toolMessage?.role === "tool" && toolMessage.content).toContain(ErrorCodes.TOOL_INPUT_INVALID);
  });

  it("未知工具：拒绝执行并将结构化错误返回模型", async () => {
    const gateway = new FakeModelGateway({
      steps: [
        { kind: "tool_call", name: "shell", input: { cmd: "rm -rf /" } },
        { kind: "text", text: "refused" },
      ],
    });
    const runtime = new AgentRuntime({ gateway, tools: createDefaultToolRegistry(), surface: "cli" });
    const events = collectEvents(runtime);

    await runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "x" });
    const failed = events.find((e) => e.type === "tool.failed");
    expect(failed?.type === "tool.failed" && failed.toolCall.error?.code).toBe(ErrorCodes.TOOL_NOT_FOUND);
  });

  it("达到最大步骤数时停止", async () => {
    const gateway = new FakeModelGateway({
      steps: Array.from({ length: 20 }, () => ({ kind: "tool_call", name: "calculator", input: { expression: "1+1" } })),
    });
    const runtime = new AgentRuntime({
      gateway,
      tools: createDefaultToolRegistry(),
      surface: "cli",
      limits: { maxSteps: 3, maxRepeatedToolCalls: 100 },
    });

    const result = await runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "x" });
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(ErrorCodes.TURN_LIMIT_EXCEEDED);
    expect(gateway.requests.length).toBe(3);
  });

  it("相同 Tool Call 连续重复时熔断", async () => {
    const gateway = new FakeModelGateway({
      steps: Array.from({ length: 10 }, () => ({ kind: "tool_call", name: "calculator", input: { expression: "1+1" } })),
    });
    const runtime = new AgentRuntime({
      gateway,
      tools: createDefaultToolRegistry(),
      surface: "cli",
      limits: { maxRepeatedToolCalls: 2, maxSteps: 50 },
    });

    const result = await runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "x" });
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(ErrorCodes.TURN_LIMIT_EXCEEDED);
    expect(result.error?.message).toContain("repeated");
  });

  it("取消：中止模型流，Turn 进入 cancelled", async () => {
    const gateway = new FakeModelGateway({ steps: [{ kind: "text", text: "a b c d e f g h" }], eventDelayMs: 50 });
    const runtime = new AgentRuntime({ gateway, tools: createDefaultToolRegistry(), surface: "cli" });
    const events = collectEvents(runtime);

    const promise = runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "hi" });
    await new Promise((r) => setTimeout(r, 80));
    const active = runtime.getActiveTurn("s");
    expect(active).toBeDefined();
    if (!active) throw new Error("Expected an active turn");
    expect(runtime.cancelTurn("s", active.id)).toBe(true);

    const result = await promise;
    expect(result.outcome).toBe("cancelled");
    expect(result.turn.status).toBe("cancelled");
    expect(events.map((e) => e.type)).toContain("turn.cancelled");
  });

  it("同一 Session 不允许并发 Turn", async () => {
    const gateway = new FakeModelGateway({ steps: [{ kind: "text", text: "slow answer" }], eventDelayMs: 30 });
    const runtime = new AgentRuntime({ gateway, tools: createDefaultToolRegistry(), surface: "cli" });

    const first = runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "a" });
    await expect(
      runtime.runTurn({ sessionId: "s", turnIndex: 2, history: [], userText: "b" }),
    ).rejects.toMatchObject({ code: ErrorCodes.INVALID_REQUEST });
    await first;
  });

  it("模型返回 retryable 错误时有限退避重试", async () => {
    const gateway = new FakeModelGateway({
      steps: [
        { kind: "error", code: ErrorCodes.MODEL_UNAVAILABLE, message: "boom", retryable: true },
        { kind: "text", text: "recovered" },
      ],
    });
    const runtime = new AgentRuntime({
      gateway,
      tools: createDefaultToolRegistry(),
      surface: "cli",
      limits: { maxRetries: 2 },
    });

    const result = await runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "x" });
    expect(result.outcome).toBe("completed");
    expect(gateway.requests.length).toBe(2);
  });

  it("Token 预算超限时停止", async () => {
    const gateway = new FakeModelGateway({
      steps: Array.from({ length: 10 }, () => ({ kind: "tool_call", name: "calculator", input: { expression: "1+2" } })),
    });
    const runtime = new AgentRuntime({
      gateway,
      tools: createDefaultToolRegistry(),
      surface: "cli",
      limits: { maxTokens: 1, maxRepeatedToolCalls: 100 },
    });
    const result = await runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "x" });
    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(ErrorCodes.TURN_LIMIT_EXCEEDED);
  });

  it("history 会带入模型请求（Session 恢复的上下文）", async () => {
    const gateway = new FakeModelGateway();
    const runtime = new AgentRuntime({ gateway, tools: createDefaultToolRegistry(), surface: "cli" });
    const history: GatewayMessage[] = [{ role: "user", content: "previous question" }];
    await runtime.runTurn({ sessionId: "s", turnIndex: 2, history, userText: "1+1" });
    expect(gateway.requests[0]?.messages[0]).toEqual({ role: "user", content: "previous question" });
  });

  it("模型流缺少 finish 时失败，不把截断文本标记为完成", async () => {
    let requestCount = 0;
    const gateway = {
      async *stream() {
        requestCount++;
        yield { type: "text_delta" as const, text: "partial" };
      },
    };
    const runtime = new AgentRuntime({ gateway, tools: createDefaultToolRegistry(), surface: "cli" });

    const result = await runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "x" });

    expect(result.outcome).toBe("failed");
    expect(result.error?.code).toBe(ErrorCodes.MODEL_STREAM_ERROR);
    expect(requestCount).toBe(1);
  });

  it("finish reason 为 length 时失败", async () => {
    const gateway = {
      async *stream() {
        yield { type: "text_delta" as const, text: "cut" };
        yield { type: "finish" as const, reason: "length" as const };
      },
    };
    const runtime = new AgentRuntime({ gateway, tools: createDefaultToolRegistry(), surface: "cli" });

    const result = await runtime.runTurn({ sessionId: "s", turnIndex: 1, history: [], userText: "x" });

    expect(result.outcome).toBe("failed");
    expect(result.error?.message).toContain("truncated");
  });
});
