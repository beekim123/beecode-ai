import { calculatorTool } from "./calculator.js";
import { createReadFileTool } from "./read-file.js";
import { ToolRegistry } from "./registry.js";
import type { ReadonlyWorkspaceSource } from "./workspace.js";
import type { ToolRegistryOptions } from "./tool.js";

export interface DefaultToolRegistryOptions extends ToolRegistryOptions {
  workspace?: ReadonlyWorkspaceSource;
}

export function createDefaultToolRegistry(options: DefaultToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry(options);
  registry.register(calculatorTool);
  if (options.workspace) registry.register(createReadFileTool(options.workspace));
  return registry;
}

export * from "./tool.js";
export * from "./registry.js";
export * from "./calculator.js";
export * from "./expression.js";
export * from "./workspace.js";
export * from "./read-file.js";
