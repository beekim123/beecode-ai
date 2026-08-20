import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeBrowserWorkspaceRequest,
  selectBrowserWorkspace,
} from "../../../src/features/workspaces/browser-workspace.js";

afterEach(() => {
  Reflect.deleteProperty(window, "showDirectoryPicker");
});

describe("browser Workspace", () => {
  it("keeps only a directory handle and opaque reference when selected", async () => {
    const directory = directoryHandle("project", []);
    const picker = vi.fn().mockResolvedValue(directory);
    Object.defineProperty(window, "showDirectoryPicker", { configurable: true, value: picker });

    const workspace = await selectBrowserWorkspace();

    expect(picker).toHaveBeenCalledWith({ mode: "read" });
    expect(workspace?.reference).toMatchObject({ name: "project", id: expect.stringMatching(/^browser_workspace_/) });
    expect(workspace).not.toHaveProperty("files");
    expect(directory.values).not.toHaveBeenCalled();
  });

  it("lists and reads files only when a delegated tool request arrives", async () => {
    const source = fileHandle("index.ts", "export const value = 1;\n");
    const root = directoryHandle("project", [
      fileHandle("README.md", "hello"),
      directoryHandle("src", [source]),
    ]);
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue(root),
    });
    const workspace = await selectBrowserWorkspace();
    if (!workspace) throw new Error("Workspace selection unexpectedly cancelled");

    const listed = await executeBrowserWorkspaceRequest(workspace, {
      turnId: "turn_1",
      toolCallId: "tool_list",
      workspaceId: workspace.reference.id,
      operation: { kind: "list" },
    });
    expect(listed).toEqual({
      ok: true,
      output: {
        kind: "list",
        files: [
          { path: "README.md", sizeBytes: 5, isReadable: true },
          { path: "src/index.ts", sizeBytes: 24, isReadable: true },
        ],
      },
    });

    const read = await executeBrowserWorkspaceRequest(workspace, {
      turnId: "turn_1",
      toolCallId: "tool_read",
      workspaceId: workspace.reference.id,
      operation: { kind: "read", path: "src/index.ts" },
    });
    expect(read).toEqual({
      ok: true,
      output: {
        kind: "file",
        path: "src/index.ts",
        sizeBytes: 24,
        content: "export const value = 1;\n",
      },
    });
    expect(source.getFile).toHaveBeenCalledTimes(2);
  });
});

interface MockFileHandle {
  kind: "file";
  name: string;
  getFile: ReturnType<typeof vi.fn>;
}

interface MockDirectoryHandle {
  kind: "directory";
  name: string;
  values: ReturnType<typeof vi.fn>;
  getDirectoryHandle: ReturnType<typeof vi.fn>;
  getFileHandle: ReturnType<typeof vi.fn>;
}

type MockHandle = MockFileHandle | MockDirectoryHandle;

function fileHandle(name: string, content: string): MockFileHandle {
  const bytes = new TextEncoder().encode(content);
  return {
    kind: "file",
    name,
    getFile: vi.fn().mockResolvedValue({
      size: bytes.byteLength,
      arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
    }),
  };
}

function directoryHandle(name: string, entries: MockHandle[]): MockDirectoryHandle {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  return {
    kind: "directory",
    name,
    values: vi.fn(() => (async function* () {
      yield* entries;
    })()),
    getDirectoryHandle: vi.fn(async (childName: string) => {
      const entry = byName.get(childName);
      if (entry?.kind === "directory") return entry;
      throw new DOMException("Directory not found", "NotFoundError");
    }),
    getFileHandle: vi.fn(async (childName: string) => {
      const entry = byName.get(childName);
      if (entry?.kind === "file") return entry;
      throw new DOMException("File not found", "NotFoundError");
    }),
  };
}
