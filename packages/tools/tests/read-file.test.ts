import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorCodes } from "@beecode/protocol";
import {
  LocalWorkspaceSource,
  createReadFileTool,
  ToolRegistry,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("read_file", () => {
  it("is hidden until a local Workspace is configured, then lists and reads files", async () => {
    const root = await createTemporaryDirectory();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "README.md"), "hello workspace\n");
    await writeFile(join(root, "src", "index.ts"), "export const value = 1;\n");
    const workspace = new LocalWorkspaceSource();
    const registry = new ToolRegistry();
    registry.register(createReadFileTool(workspace));

    expect(registry.schemasFor("cli")).toEqual([]);
    const summary = await workspace.configure(root);
    expect(summary).toMatchObject({ name: expect.any(String), fileCount: 2 });
    expect(summary).not.toHaveProperty("path");
    expect(registry.schemasFor("cli").map((schema) => schema.name)).toEqual(["read_file"]);

    const list = await registry.execute("read_file", {}, "cli", new AbortController().signal);
    expect(list.result).toMatchObject({
      ok: true,
      output: {
        kind: "workspace_files",
        files: [
          { path: "README.md", isReadable: true },
          { path: "src/index.ts", isReadable: true },
        ],
      },
    });
    const read = await registry.execute(
      "read_file",
      { path: "src/index.ts" },
      "cli",
      new AbortController().signal,
    );
    expect(read.result).toMatchObject({
      ok: true,
      output: { kind: "file", path: "src/index.ts", content: "export const value = 1;\n" },
    });
  });

  it("rejects traversal, absolute paths, and symlinks outside the Workspace", async () => {
    const root = await createTemporaryDirectory();
    const outside = await createTemporaryDirectory();
    await writeFile(join(outside, "secret.txt"), "not authorized");
    await symlink(join(outside, "secret.txt"), join(root, "escape.txt"));
    const workspace = new LocalWorkspaceSource();
    await workspace.configure(root);
    const registry = new ToolRegistry();
    registry.register(createReadFileTool(workspace));

    const traversal = await registry.execute(
      "read_file",
      { path: "../secret.txt" },
      "cli",
      new AbortController().signal,
    );
    expect(traversal.result).toMatchObject({ ok: false, error: { code: ErrorCodes.TOOL_INPUT_INVALID } });
    const absolute = await registry.execute(
      "read_file",
      { path: join(outside, "secret.txt") },
      "cli",
      new AbortController().signal,
    );
    expect(absolute.result).toMatchObject({ ok: false, error: { code: ErrorCodes.TOOL_INPUT_INVALID } });
    const symlinkEscape = await registry.execute(
      "read_file",
      { path: "escape.txt" },
      "cli",
      new AbortController().signal,
    );
    expect(symlinkEscape.result).toMatchObject({ ok: false, error: { code: ErrorCodes.FORBIDDEN } });
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "beecode-workspace-"));
  temporaryDirectories.push(directory);
  return directory;
}
