import {
  BeecodeError,
  ErrorCodes,
  type BrowserWorkspaceOperation,
  type BrowserWorkspaceOperationOutput,
  type BrowserWorkspaceOperationResult,
  type BrowserWorkspaceReference,
  type BrowserWorkspaceToolRequest,
  type ToolCall,
  type WorkspaceSummary,
} from "@beecode/protocol";
import {
  normalizeWorkspacePath,
  type ReadonlyWorkspaceSource,
  type ToolExecutionContext,
  type WorkspaceFileContent,
  type WorkspaceFileEntry,
} from "@beecode/tools";

type PendingStatus = "pending" | "completed" | "failed" | "expired";

interface PendingBrowserWorkspaceRequest {
  request: BrowserWorkspaceToolRequest;
  status: PendingStatus;
  promise: Promise<BrowserWorkspaceOperationOutput>;
  resolve(output: BrowserWorkspaceOperationOutput): void;
  reject(error: BeecodeError): void;
}

export class BrowserWorkspaceSource implements ReadonlyWorkspaceSource {
  private readonly requests = new Map<string, PendingBrowserWorkspaceRequest>();
  private readonly summary: WorkspaceSummary;

  constructor(
    private readonly reference: BrowserWorkspaceReference,
    private readonly turnId: string,
  ) {
    this.summary = { id: reference.id, name: reference.name, fileCount: 0 };
  }

  getSummary(): WorkspaceSummary {
    return { ...this.summary };
  }

  prepare(toolCall: ToolCall): BrowserWorkspaceToolRequest | undefined {
    if (toolCall.name !== "read_file") return undefined;
    const operation = parseReadFileOperation(toolCall.input);
    if (!operation) return undefined;

    const existing = this.requests.get(toolCall.id);
    if (existing) return existing.request;

    let resolve!: (output: BrowserWorkspaceOperationOutput) => void;
    let reject!: (error: BeecodeError) => void;
    const promise = new Promise<BrowserWorkspaceOperationOutput>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    // A Turn can be cancelled between tool.requested and tool.started.
    void promise.catch(() => undefined);

    const request: BrowserWorkspaceToolRequest = {
      turnId: this.turnId,
      toolCallId: toolCall.id,
      workspaceId: this.reference.id,
      operation,
    };
    this.requests.set(toolCall.id, { request, status: "pending", promise, resolve, reject });
    return request;
  }

  getPendingRequests(): BrowserWorkspaceToolRequest[] {
    return [...this.requests.values()]
      .filter((pending) => pending.status === "pending")
      .map((pending) => structuredClone(pending.request));
  }

  async listFiles(context: ToolExecutionContext): Promise<WorkspaceFileEntry[]> {
    const pending = this.requirePending(context, { kind: "list" });
    const output = await waitForResult(pending, context.signal);
    if (output.kind !== "list") throw invalidResult();
    this.summary.fileCount = output.files.length;
    return structuredClone(output.files);
  }

  async readTextFile(path: string, context: ToolExecutionContext): Promise<WorkspaceFileContent> {
    const relativePath = normalizeWorkspacePath(path);
    const pending = this.requirePending(context, { kind: "read", path: relativePath });
    const output = await waitForResult(pending, context.signal);
    if (output.kind !== "file" || output.path !== relativePath) throw invalidResult();
    return structuredClone(output);
  }

  submitResult(
    toolCallId: string,
    workspaceId: string,
    result: BrowserWorkspaceOperationResult,
  ): void {
    if (workspaceId !== this.reference.id) {
      throw new BeecodeError(ErrorCodes.FORBIDDEN, "Workspace authorization does not match this tool call");
    }
    const pending = this.requests.get(toolCallId);
    if (!pending) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Browser Workspace tool call is not active");
    }
    if (pending.status === "completed" || pending.status === "failed") return;
    if (pending.status === "expired") {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Browser Workspace tool call has expired");
    }

    if (!result.ok) {
      pending.status = "failed";
      pending.reject(toBrowserWorkspaceError(result.error.code));
      return;
    }
    assertExpectedOutput(pending.request.operation, result.output);
    pending.status = "completed";
    pending.resolve(structuredClone(result.output));
  }

  dispose(): void {
    for (const pending of this.requests.values()) {
      if (pending.status !== "pending") continue;
      pending.status = "expired";
      pending.reject(new BeecodeError(ErrorCodes.TURN_CANCELLED, "Browser Workspace tool call ended"));
    }
    this.requests.clear();
  }

  private requirePending(
    context: ToolExecutionContext,
    operation: BrowserWorkspaceOperation,
  ): PendingBrowserWorkspaceRequest {
    if (!context.toolCallId || context.turnId !== this.turnId) {
      throw new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Browser Workspace tool context is missing");
    }
    const pending = this.requests.get(context.toolCallId);
    if (!pending || !sameOperation(pending.request.operation, operation)) {
      throw new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Browser Workspace tool request is unavailable");
    }
    return pending;
  }
}

function parseReadFileOperation(input: unknown): BrowserWorkspaceOperation | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "path")) return undefined;
  if (record.path === undefined) return { kind: "list" };
  if (typeof record.path !== "string" || record.path.length > 1024) return undefined;
  try {
    return { kind: "read", path: normalizeWorkspacePath(record.path) };
  } catch {
    return undefined;
  }
}

function sameOperation(
  left: BrowserWorkspaceOperation,
  right: BrowserWorkspaceOperation,
): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "list" || left.path === (right.kind === "read" ? right.path : undefined);
}

function assertExpectedOutput(
  operation: BrowserWorkspaceOperation,
  output: BrowserWorkspaceOperationOutput,
): void {
  const matches = operation.kind === "list"
    ? output.kind === "list"
    : output.kind === "file" && output.path === operation.path;
  if (!matches) {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Browser Workspace result does not match the tool request");
  }
}

function waitForResult(
  pending: PendingBrowserWorkspaceRequest,
  signal: AbortSignal,
): Promise<BrowserWorkspaceOperationOutput> {
  if (signal.aborted) {
    pending.status = "expired";
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pending.status = "expired";
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.promise.then(
      (output) => {
        cleanup();
        resolve(output);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function toBrowserWorkspaceError(code: string): BeecodeError {
  switch (code) {
    case "not_found":
      return new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Workspace file was not found");
    case "not_readable":
      return new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Workspace file is not readable UTF-8 text");
    case "permission_denied":
      return new BeecodeError(ErrorCodes.FORBIDDEN, "Browser no longer has permission to read this Workspace");
    case "workspace_unavailable":
      return new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Browser Workspace is unavailable", true);
    default:
      return new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Browser Workspace operation failed");
  }
}

function invalidResult(): BeecodeError {
  return new BeecodeError(ErrorCodes.TOOL_EXECUTION_FAILED, "Browser Workspace returned an invalid result");
}
