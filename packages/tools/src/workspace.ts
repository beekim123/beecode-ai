import { randomUUID } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  BeecodeError,
  ErrorCodes,
  WORKSPACE_FILE_MAX_CONTENT_BYTES,
  WORKSPACE_MAX_LISTED_FILES,
  type WorkspaceSummary,
} from "@beecode/protocol";
import type { ToolExecutionContext } from "./tool.js";

export interface WorkspaceFileEntry {
  path: string;
  sizeBytes: number;
  isReadable: boolean;
}

export interface WorkspaceFileContent {
  path: string;
  sizeBytes: number;
  content: string;
}

export interface ReadonlyWorkspaceSource {
  getSummary(): WorkspaceSummary | undefined;
  listFiles(context: ToolExecutionContext): Promise<WorkspaceFileEntry[]>;
  readTextFile(path: string, context: ToolExecutionContext): Promise<WorkspaceFileContent>;
}

export class LocalWorkspaceSource implements ReadonlyWorkspaceSource {
  private rootPath: string | undefined;
  private summary: WorkspaceSummary | undefined;

  async configure(directoryPath: string): Promise<WorkspaceSummary> {
    const rootPath = await realpath(directoryPath);
    if (!(await stat(rootPath)).isDirectory()) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Workspace must be an existing directory");
    }
    const entries = await listLocalFiles(rootPath, new AbortController().signal);
    this.rootPath = rootPath;
    this.summary = {
      id: `workspace_${randomUUID()}`,
      name: basename(rootPath) || rootPath,
      fileCount: entries.length,
    };
    return this.summary;
  }

  clear(): void {
    this.rootPath = undefined;
    this.summary = undefined;
  }

  getSummary(): WorkspaceSummary | undefined {
    return this.summary;
  }

  listFiles(context: ToolExecutionContext): Promise<WorkspaceFileEntry[]> {
    return listLocalFiles(this.requireRoot(), context.signal);
  }

  async readTextFile(path: string, context: ToolExecutionContext): Promise<WorkspaceFileContent> {
    const relativePath = normalizeWorkspacePath(path);
    const rootPath = this.requireRoot();
    const canonicalPath = await realpath(resolve(rootPath, relativePath));
    assertContained(rootPath, canonicalPath);
    const metadata = await stat(canonicalPath);
    if (!metadata.isFile()) {
      throw new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Workspace path is not a regular file");
    }
    if (metadata.size > WORKSPACE_FILE_MAX_CONTENT_BYTES) {
      throw new BeecodeError(
        ErrorCodes.TOOL_EXECUTION_FAILED,
        `File exceeds the ${WORKSPACE_FILE_MAX_CONTENT_BYTES}-byte read limit`,
      );
    }
    const buffer = await readFile(canonicalPath, { signal: context.signal });
    return {
      path: relativePath,
      sizeBytes: buffer.byteLength,
      content: decodeText(buffer),
    };
  }

  private requireRoot(): string {
    if (!this.rootPath) {
      throw new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "No Workspace is configured");
    }
    return this.rootPath;
  }
}

export function normalizeWorkspacePath(path: string): string {
  if (path.length === 0 || path.includes("\0") || path.includes("\\") || isAbsolute(path)) {
    throw new BeecodeError(ErrorCodes.TOOL_INPUT_INVALID, "path must be Workspace-relative");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new BeecodeError(ErrorCodes.TOOL_INPUT_INVALID, "path must not contain empty, . or .. segments");
  }
  if (/^[A-Za-z]:/.test(path)) {
    throw new BeecodeError(ErrorCodes.TOOL_INPUT_INVALID, "path must not be absolute");
  }
  return segments.join("/");
}

async function listLocalFiles(rootPath: string, signal: AbortSignal): Promise<WorkspaceFileEntry[]> {
  const files: WorkspaceFileEntry[] = [];
  const directories = [""];
  while (directories.length > 0 && files.length < WORKSPACE_MAX_LISTED_FILES) {
    throwIfAborted(signal);
    const directory = directories.shift() ?? "";
    const absoluteDirectory = join(rootPath, directory);
    const entries = await readdir(absoluteDirectory, { withFileTypes: true }).catch(
      (error: unknown) => {
        if (directory.length === 0) throw error;
        return [];
      },
    );
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= WORKSPACE_MAX_LISTED_FILES) break;
      const relativePath = directory.length === 0 ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        directories.push(relativePath);
      } else if (entry.isFile()) {
        const metadata = await stat(join(rootPath, relativePath));
        files.push({
          path: relativePath,
          sizeBytes: metadata.size,
          isReadable: metadata.size <= WORKSPACE_FILE_MAX_CONTENT_BYTES,
        });
      }
      // Symlinks are omitted from listings. Explicit reads still enforce realpath containment.
    }
  }
  return files;
}

function assertContained(rootPath: string, targetPath: string): void {
  const pathFromRoot = relative(rootPath, targetPath);
  if (
    pathFromRoot === "" ||
    (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== ".." && !isAbsolute(pathFromRoot))
  ) {
    return;
  }
  throw new BeecodeError(ErrorCodes.FORBIDDEN, "File is outside the authorized Workspace");
}

function decodeText(buffer: Uint8Array): string {
  if (buffer.includes(0)) {
    throw new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Binary files cannot be read as text");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "File is not valid UTF-8 text");
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason;
}
