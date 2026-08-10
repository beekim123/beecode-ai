import { describe, expect, it } from "vitest";
import { evaluateExpression, ExpressionError } from "../src/expression.js";

describe("evaluateExpression", () => {
  it("evaluates basic arithmetic", () => {
    expect(evaluateExpression("1+1")).toBe(2);
    expect(evaluateExpression("1 + 1")).toBe(2);
    expect(evaluateExpression("2 * 3 + 4")).toBe(10);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
    expect(evaluateExpression("10 / 4")).toBe(2.5);
    expect(evaluateExpression("2 ** 10")).toBe(1024);
    expect(evaluateExpression("2 ^ 3")).toBe(8);
    expect(evaluateExpression("-3 + 5")).toBe(2);
    expect(evaluateExpression("7 % 3")).toBe(1);
    expect(evaluateExpression("2 + -3")).toBe(-1);
  });

  it("rejects invalid or unsafe input", () => {
    expect(() => evaluateExpression("")).toThrow(ExpressionError);
    expect(() => evaluateExpression("abc")).toThrow(ExpressionError);
    expect(() => evaluateExpression("1 +")).toThrow(ExpressionError);
    expect(() => evaluateExpression("process.exit(1)")).toThrow(ExpressionError);
    expect(() => evaluateExpression("1; rm -rf /")).toThrow(ExpressionError);
    expect(() => evaluateExpression("1/0")).toThrow(/Division by zero/);
    expect(() => evaluateExpression("(1+2")).toThrow(ExpressionError);
    expect(() => evaluateExpression("1 2 3")).toThrow(ExpressionError);
  });
});
