import {
  BeecodeError,
  ErrorCodes,
  type Surface,
  type ToolResult,
  type ToolSchema,
} from "@beecode/protocol";
import type { Tool, ToolExecutionRecord, ToolRegistryOptions } from "./tool.js";

const DEFAULT_MAX_RESULT_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Tool Registry：注册、查询、按 surface 过滤、校验输入并执行。
 * 接口不假设只有 calculator 一个工具（设计文档 9.1）。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly maxResultBytes: number;
  private readonly executionTimeoutMs: number;

  constructor(options: ToolRegistryOptions = {}) {
    this.maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
    this.executionTimeoutMs = options.executionTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, `Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** 按 surface 生成当前可用工具集合的模型可见 Schema */
  schemasFor(surface: Surface): ToolSchema[] {
    const schemas: ToolSchema[] = [];
    for (const tool of this.tools.values()) {
      if (tool.surfaces && !tool.surfaces.includes(surface)) continue;
      schemas.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema });
    }
    return schemas;
  }

  /** 执行前再次检查可用性、校验输入、应用超时与结果大小限制 */
  async execute(
    name: string,
    input: unknown,
    surface: Surface,
    signal: AbortSignal,
  ): Promise<ToolExecutionRecord> {
    const tool = this.tools.get(name);
    if (!tool || (tool.surfaces && !tool.surfaces.includes(surface))) {
      return failed(`Tool is not available: ${name}`, ErrorCodes.TOOL_NOT_FOUND);
    }
    const invalid = tool.validate(input);
    if (invalid !== null) {
      return failed(invalid, ErrorCodes.TOOL_INPUT_INVALID);
    }

    const started = Date.now();
    const timeout = AbortSignal.timeout(this.executionTimeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      if (signal.aborted) {
        return failed("Tool execution cancelled", ErrorCodes.TURN_CANCELLED);
      }
      const execution = tool.execute(input, { signal: combined });
      const output = await waitForAbort(execution, combined);
      const result = this.toResult(output);
      return { result, durationMs: Date.now() - started };
    } catch (err) {
      const durationMs = Date.now() - started;
      if (signal.aborted) {
        return failed("Tool execution cancelled", ErrorCodes.TURN_CANCELLED, false, durationMs);
      }
      if (timeout.aborted) {
        return failed(
          `Tool timed out after ${this.executionTimeoutMs}ms`,
          ErrorCodes.TOOL_EXECUTION_FAILED,
          true,
          durationMs,
        );
      }
      // 不向外暴露内部堆栈
      const message = err instanceof BeecodeError ? err.message : "Tool execution failed";
      const code = err instanceof BeecodeError ? err.code : ErrorCodes.TOOL_EXECUTION_FAILED;
      return failed(message, code, false, durationMs);
    }
  }

  private toResult(output: unknown): ToolResult {
    const serialized = JSON.stringify(output) ?? "null";
    if (Buffer.byteLength(serialized, "utf8") > this.maxResultBytes) {
      return {
        ok: false,
        error: {
          code: ErrorCodes.TOOL_EXECUTION_FAILED,
          message: `Tool result exceeds ${this.maxResultBytes} bytes`,
          retryable: false,
        },
      };
    }
    return { ok: true, output };
  }
}

function failed(message: string, code: string, retryable = false, durationMs = 0): ToolExecutionRecord {
  return {
    result: { ok: false, error: { code, message, retryable } },
    durationMs,
  };
}

function waitForAbort<TResult>(promise: Promise<TResult>, signal: AbortSignal): Promise<TResult> {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise<TResult>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
