import { calculatorTool } from "./calculator.js";
import { ToolRegistry } from "./registry.js";
import type { ToolRegistryOptions } from "./tool.js";

export function createDefaultToolRegistry(options?: ToolRegistryOptions): ToolRegistry {
  const registry = new ToolRegistry(options);
  registry.register(calculatorTool);
  return registry;
}

export * from "./tool.js";
export * from "./registry.js";
export * from "./calculator.js";
export * from "./expression.js";
