import {
  WORKSPACE_FILE_MAX_CONTENT_BYTES,
  WORKSPACE_MAX_LISTED_FILES,
  type BrowserWorkspaceFileEntry,
  type BrowserWorkspaceOperationResult,
  type BrowserWorkspaceReference,
  type BrowserWorkspaceToolRequest,
} from "@beecode/protocol";

interface BrowserFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
}

interface BrowserDirectoryHandle {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterableIterator<BrowserFileHandle | BrowserDirectoryHandle>;
  getDirectoryHandle(name: string): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string): Promise<BrowserFileHandle>;
}

type DirectoryPicker = (options?: { mode?: "read" }) => Promise<BrowserDirectoryHandle>;

export interface BrowserWorkspace {
  reference: BrowserWorkspaceReference;
  directory: BrowserDirectoryHandle;
}

export function isBrowserWorkspaceSupported(): boolean {
  return getDirectoryPicker() !== undefined;
}

export async function selectBrowserWorkspace(): Promise<BrowserWorkspace | undefined> {
  const picker = getDirectoryPicker();
  if (!picker) throw new TypeError("当前浏览器不支持本地工作空间");
  try {
    const directory = await picker({ mode: "read" });
    return {
      reference: {
        id: `browser_workspace_${globalThis.crypto.randomUUID()}`,
        name: directory.name,
      },
      directory,
    };
  } catch (error: unknown) {
    if (isDomError(error, "AbortError")) return undefined;
    throw error;
  }
}

export async function executeBrowserWorkspaceRequest(
  workspace: BrowserWorkspace,
  request: BrowserWorkspaceToolRequest,
): Promise<BrowserWorkspaceOperationResult> {
  if (request.workspaceId !== workspace.reference.id) {
    return failed("workspace_unavailable");
  }
  try {
    if (request.operation.kind === "list") {
      return { ok: true, output: { kind: "list", files: await listFiles(workspace.directory) } };
    }
    return await readTextFile(workspace.directory, request.operation.path);
  } catch (error: unknown) {
    if (isDomError(error, "NotFoundError")) return failed("not_found");
    if (isDomError(error, "NotAllowedError") || isDomError(error, "SecurityError")) {
      return failed("permission_denied");
    }
    if (isDomError(error, "TypeMismatchError")) return failed("not_found");
    return failed("workspace_unavailable");
  }
}

async function listFiles(root: BrowserDirectoryHandle): Promise<BrowserWorkspaceFileEntry[]> {
  const files: BrowserWorkspaceFileEntry[] = [];
  const directories: Array<{ directory: BrowserDirectoryHandle; path: string }> = [
    { directory: root, path: "" },
  ];
  while (directories.length > 0 && files.length < WORKSPACE_MAX_LISTED_FILES) {
    const current = directories.shift();
    if (!current) break;
    const entries: Array<BrowserFileHandle | BrowserDirectoryHandle> = [];
    for await (const entry of current.directory.values()) entries.push(entry);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= WORKSPACE_MAX_LISTED_FILES) break;
      const path = current.path ? `${current.path}/${entry.name}` : entry.name;
      if (entry.kind === "directory") {
        directories.push({ directory: entry, path });
        continue;
      }
      const file = await entry.getFile();
      files.push({
        path,
        sizeBytes: file.size,
        isReadable: file.size <= WORKSPACE_FILE_MAX_CONTENT_BYTES,
      });
    }
  }
  return files;
}

async function readTextFile(
  root: BrowserDirectoryHandle,
  path: string,
): Promise<BrowserWorkspaceOperationResult> {
  const segments = normalizeWorkspacePath(path);
  const fileName = segments.at(-1);
  if (!fileName) return failed("not_found");
  let directory = root;
  for (const segment of segments.slice(0, -1)) {
    directory = await directory.getDirectoryHandle(segment);
  }
  const file = await (await directory.getFileHandle(fileName)).getFile();
  if (file.size > WORKSPACE_FILE_MAX_CONTENT_BYTES) return failed("not_readable");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.includes(0)) return failed("not_readable");
  try {
    return {
      ok: true,
      output: {
        kind: "file",
        path: segments.join("/"),
        sizeBytes: bytes.byteLength,
        content: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      },
    };
  } catch {
    return failed("not_readable");
  }
}

function normalizeWorkspacePath(path: string): string[] {
  if (
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path)
  ) {
    throw new TypeError("Workspace path must be relative");
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new TypeError("Workspace path contains unsafe segments");
  }
  return segments;
}

function getDirectoryPicker(): DirectoryPicker | undefined {
  return (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker?.bind(window);
}

function isDomError(error: unknown, name: string): boolean {
  return error instanceof DOMException && error.name === name;
}

function failed(
  code: "not_found" | "not_readable" | "permission_denied" | "workspace_unavailable",
): BrowserWorkspaceOperationResult {
  return { ok: false, error: { code } };
}
