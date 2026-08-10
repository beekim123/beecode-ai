import { BeecodeError, ErrorCodes } from "@beecode/protocol";
import type { Tool } from "./tool.js";
import { evaluateExpression, ExpressionError } from "./expression.js";

export interface CalculatorInput {
  expression: string;
}

export interface CalculatorOutput {
  expression: string;
  value: number;
}

/**
 * calculator：无副作用、无需审批、五端可复用（设计文档 9.2）。
 * 不访问网络、文件系统或进程环境，不使用动态代码执行。
 */
export const calculatorTool: Tool<CalculatorInput, CalculatorOutput> = {
  name: "calculator",
  description:
    "Evaluate a basic arithmetic expression. Supports numbers, + - * / % ^ (or **) and parentheses. " +
    "Use this tool for ANY arithmetic instead of computing in your head.",
  inputSchema: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description: "Arithmetic expression, e.g. \"1 + 1\" or \"(2 + 3) * 4\"",
        maxLength: 256,
      },
    },
    required: ["expression"],
    additionalProperties: false,
  },
  validate(input: unknown): string | null {
    if (typeof input !== "object" || input === null) return "Input must be an object";
    const expr = (input as Record<string, unknown>).expression;
    if (typeof expr !== "string") return "\"expression\" must be a string";
    if (expr.length === 0) return "\"expression\" must not be empty";
    if (expr.length > 256) return "\"expression\" is too long";
    return null;
  },
  async execute(input: CalculatorInput): Promise<CalculatorOutput> {
    try {
      const value = evaluateExpression(input.expression);
      return { expression: input.expression, value };
    } catch (err) {
      if (err instanceof ExpressionError) {
        // 结构化错误，不含内部堆栈
        throw new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, `Invalid expression: ${err.message}`);
      }
      throw err;
    }
  },
};
