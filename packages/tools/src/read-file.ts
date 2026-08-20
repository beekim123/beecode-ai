import type { Tool } from "./tool.js";
import type { ReadonlyWorkspaceSource } from "./workspace.js";

export interface ReadFileInput {
  path?: string;
}

export type ReadFileOutput =
  | {
      kind: "workspace_files";
      workspace: string;
      files: Awaited<ReturnType<ReadonlyWorkspaceSource["listFiles"]>>;
      totalFiles: number;
      truncated: boolean;
    }
  | {
      kind: "file";
      workspace: string;
      path: string;
      sizeBytes: number;
      content: string;
    };

const MAX_LIST_RESULT_FILES = 100;
export const READ_FILE_TOOL_DESCRIPTION =
  "List files in the authorized Workspace when path is omitted, or read one UTF-8 text file by its Workspace-relative path.";

export function createReadFileTool(workspace: ReadonlyWorkspaceSource): Tool<ReadFileInput, ReadFileOutput> {
  return {
    name: "read_file",
    description: READ_FILE_TOOL_DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path. Omit to list available files.",
          maxLength: 1024,
        },
      },
      additionalProperties: false,
    },
    isAvailable: () => workspace.getSummary() !== undefined,
    validate(input: unknown): string | null {
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return "Input must be an object";
      }
      const record = input as Record<string, unknown>;
      if (Object.keys(record).some((key) => key !== "path")) return "Input contains unknown properties";
      if (record.path === undefined) return null;
      if (typeof record.path !== "string") return '"path" must be a string';
      if (record.path.length === 0) return '"path" must not be empty';
      if (record.path.length > 1024) return '"path" is too long';
      return null;
    },
    async execute(input, context) {
      const summary = workspace.getSummary();
      if (!summary) throw new TypeError("No Workspace is configured");
      if (input.path === undefined) {
        const files = await workspace.listFiles(context);
        return {
          kind: "workspace_files",
          workspace: summary.name,
          files: files.slice(0, MAX_LIST_RESULT_FILES),
          totalFiles: files.length,
          truncated: files.length > MAX_LIST_RESULT_FILES,
        };
      }
      const file = await workspace.readTextFile(input.path, context);
      return { kind: "file", workspace: summary.name, ...file };
    },
  };
}
