import { describe, expect, it } from "vitest";
import { ErrorCodes } from "@beecode/protocol";
import { calculatorTool } from "../src/calculator.js";
import { createDefaultToolRegistry } from "../src/index.js";
import type { Tool } from "../src/tool.js";

const signal = AbortSignal.timeout(5000);

describe("ToolRegistry", () => {
  it("executes calculator deterministically", async () => {
    const registry = createDefaultToolRegistry();
    const { result } = await registry.execute("calculator", { expression: "1 + 1" }, "cli", signal);
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ expression: "1 + 1", value: 2 });
  });

  it("rejects unknown tools", async () => {
    const registry = createDefaultToolRegistry();
    const { result } = await registry.execute("shell", { cmd: "ls" }, "cli", signal);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TOOL_NOT_FOUND);
  });

  it("rejects invalid input without executing the tool body", async () => {
    let executed = false;
    const spyTool: Tool = {
      name: "spy",
      description: "spy",
      inputSchema: {},
      validate: () => "always invalid",
      execute: async () => {
        executed = true;
        return null;
      },
    };
    const registry = createDefaultToolRegistry();
    registry.register(spyTool);
    const { result } = await registry.execute("spy", {}, "cli", signal);
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TOOL_INPUT_INVALID);
    expect(executed).toBe(false);
  });

  it("filters tools by surface", () => {
    const desktopOnly: Tool = {
      name: "desktop-only",
      description: "x",
      inputSchema: {},
      surfaces: ["desktop" as never],
      validate: () => null,
      execute: async () => null,
    };
    const registry = createDefaultToolRegistry();
    registry.register(desktopOnly);
    const names = registry.schemasFor("cli").map((s) => s.name);
    expect(names).toContain("calculator");
    expect(names).not.toContain("desktop-only");
  });

  it("returns structured errors for bad expressions without stack traces", async () => {
    const registry = createDefaultToolRegistry();
    const { result } = await registry.execute("calculator", { expression: "1/0" }, "cli", signal);
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("Division by zero");
    expect(result.error?.message).not.toContain("at ");
  });

  it("enforces timeout when a tool ignores AbortSignal", async () => {
    const registry = createDefaultToolRegistry({ executionTimeoutMs: 10 });
    registry.register({
      name: "hang",
      description: "never resolves",
      inputSchema: {},
      validate: () => null,
      execute: () => new Promise(() => undefined),
    });

    const { result, durationMs } = await registry.execute(
      "hang",
      {},
      "cli",
      new AbortController().signal,
    );

    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain("timed out");
    expect(durationMs).toBeGreaterThanOrEqual(5);
  });

  it("returns cancellation when the caller aborts a non-cooperative tool", async () => {
    const registry = createDefaultToolRegistry({ executionTimeoutMs: 1000 });
    registry.register({
      name: "hang",
      description: "never resolves",
      inputSchema: {},
      validate: () => null,
      execute: () => new Promise(() => undefined),
    });
    const abort = new AbortController();
    const execution = registry.execute("hang", {}, "cli", abort.signal);

    abort.abort();
    const { result } = await execution;

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe(ErrorCodes.TURN_CANCELLED);
  });
});
