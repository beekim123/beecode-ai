import { AgentRuntime, DEFAULT_TURN_LIMITS } from "@beecode/agent-core";
import { AgentServerFacade, HttpModelGateway } from "@beecode/agent-server";
import {
  BeecodeError,
  DESKTOP_IPC_PROTOCOL_VERSION,
  ErrorCodes,
  parseDesktopIpcFrame,
  parseDesktopIpcMethodResult,
  type AgentEventEnvelope,
  type CapabilitySet,
  type DesktopIpcControlFrame,
  type DesktopIpcFrame,
  type DesktopIpcMethod,
  type DesktopIpcRequestFrame,
} from "@beecode/protocol";
import {
  calculatorTool,
  createReadFileTool,
  LocalWorkspaceSource,
  READ_FILE_TOOL_DESCRIPTION,
  ToolRegistry,
} from "@beecode/tools";
import { DesktopBackendClient } from "./desktop-backend-client.js";
import { createAuthenticatedFetch, RuntimeTokenStore } from "./token-store.js";

interface RuntimeHostOptions {
  runtimeId: string;
  send(frame: DesktopIpcFrame): void;
  fetchImpl?: typeof fetch;
}

type InitializeFrame = Extract<DesktopIpcControlFrame, { control: "runtime.initialize" }>;

export class DesktopRuntimeHost {
  private readonly runtimeId: string;
  private readonly sendFrame: (frame: DesktopIpcFrame) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly tokens = new RuntimeTokenStore();
  private readonly subscriptions = new Map<string, () => void>();
  private readonly activeTurns = new Map<string, string>();
  private readonly submissions = new Set<Promise<unknown>>();
  private readonly workspace = new LocalWorkspaceSource();
  private service: AgentServerFacade | undefined;
  private runtime: AgentRuntime | undefined;
  private backendUrl = "";
  private replacesRuntimeId: string | undefined;
  private workspaceAllowed = false;
  private workspaceChanging = false;

  constructor(options: RuntimeHostOptions) {
    this.runtimeId = options.runtimeId;
    this.sendFrame = options.send;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async initialize(frame: InitializeFrame): Promise<void> {
    this.backendUrl = frame.payload.backendUrl;
    this.replacesRuntimeId = frame.payload.replacesRuntimeId;
    this.tokens.update(frame.payload.auth.authenticated ? frame.payload.auth.accessToken : undefined);
    const capabilities = frame.payload.auth.authenticated
      ? await this.composeAuthenticatedService()
      : unauthenticatedCapabilities();
    this.send({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "control",
      control: "runtime.ready",
      payload: { runtimeId: this.runtimeId, capabilities },
    });
  }

  async updateAuth(frame: Extract<DesktopIpcControlFrame, { control: "auth.update" }>): Promise<void> {
    this.publishRuntimeStatus("handshaking");
    this.tokens.update(frame.payload.auth.authenticated ? frame.payload.auth.accessToken : undefined);
    try {
      if (frame.payload.auth.authenticated) {
        if (!this.service) await this.composeAuthenticatedService();
      } else {
        this.disposeSubscriptions();
        this.service = undefined;
        this.runtime = undefined;
        this.workspaceAllowed = false;
        this.workspace.clear();
      }
      this.publishRuntimeStatus("ready");
    } catch (error: unknown) {
      const normalized = sanitizeRuntimeError(error);
      this.publishRuntimeStatus("unavailable", normalized);
    }
  }

  handleRequest(frame: DesktopIpcRequestFrame): void {
    const operation = this.execute(frame);
    if (frame.method === "turn.submit") this.submissions.add(operation);
    void operation.finally(() => this.submissions.delete(operation));
  }

  async shutdown(): Promise<void> {
    for (const [sessionId, turnId] of this.activeTurns) {
      this.runtime?.cancelTurn(sessionId, turnId);
    }
    await Promise.race([
      Promise.allSettled([...this.submissions]),
      new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
    ]);
    this.disposeSubscriptions();
    this.tokens.clear();
    this.send({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "control",
      control: "runtime.shutdown.ack",
      payload: { runtimeId: this.runtimeId },
    });
  }

  private async composeAuthenticatedService(): Promise<CapabilitySet> {
    this.disposeSubscriptions();
    const backend = new DesktopBackendClient({
      baseUrl: this.backendUrl,
      runtimeId: this.runtimeId,
      replacesRuntimeId: this.replacesRuntimeId,
      tokens: this.tokens,
      fetchImpl: this.fetchImpl,
    });
    await backend.recoverInterruptedTurns();
    const policy = await backend.getPolicy();
    this.workspaceAllowed = policy.allowedFeatures.localWorkspace && policy.allowedTools.includes("read_file");
    const tools = new ToolRegistry();
    if (policy.allowedTools.includes("calculator")) tools.register(calculatorTool);
    if (this.workspaceAllowed) {
      tools.register(createReadFileTool(this.workspace));
    }
    const gateway = new HttpModelGateway({
      baseUrl: this.backendUrl,
      token: "managed-by-desktop-main",
      fetchImpl: createAuthenticatedFetch(this.tokens, this.fetchImpl),
    });
    const runtime = new AgentRuntime({ gateway, tools, surface: "desktop" });
    this.runtime = runtime;
    this.service = new AgentServerFacade({
      runtime,
      tools,
      backend,
      surface: "desktop",
      limits: { ...DEFAULT_TURN_LIMITS, maxSteps: policy.limits.maxTurnSteps },
    });
    this.replacesRuntimeId = undefined;
    return this.service.getCapabilities();
  }

  private async execute(frame: DesktopIpcRequestFrame): Promise<void> {
    try {
      const value = await this.invoke(frame);
      this.send({
        protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        kind: "response",
        requestId: frame.requestId,
        result: { ok: true, value: parseDesktopIpcMethodResult(frame.method, value) },
      });
    } catch (error: unknown) {
      const normalized = sanitizeRuntimeError(error);
      this.send({
        protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        kind: "response",
        requestId: frame.requestId,
        result: { ok: false, error: normalized.toShape() },
      });
    }
  }

  private invoke(frame: DesktopIpcRequestFrame): Promise<unknown> {
    if (frame.method === "runtime.getCapabilities") {
      return this.service?.getCapabilities() ?? Promise.resolve(unauthenticatedCapabilities());
    }
    if (frame.method === "workspace.get") {
      return Promise.resolve(this.workspace.getSummary() ?? null);
    }
    if (frame.method === "workspace.configure") {
      return this.configureWorkspace(frame.payload.directoryPath);
    }
    if (frame.method === "workspace.clear") {
      this.assertWorkspaceCanChange();
      this.workspace.clear();
      return Promise.resolve(null);
    }
    const service = this.requireService();
    switch (frame.method) {
      case "session.create":
        return service.createSession(frame.payload);
      case "session.list":
        return service.listSessions(frame.payload);
      case "session.getSnapshot":
        return service.getSessionSnapshot(frame.payload.sessionId);
      case "session.update":
        return service.updateSession(frame.payload);
      case "session.subscribe":
        return this.subscribe(frame.payload.sessionId, service);
      case "session.unsubscribe":
        return this.unsubscribe(frame.payload.sessionId);
      case "turn.submit":
        if (this.workspaceChanging) {
          throw new BeecodeError(
            ErrorCodes.SURFACE_UNAVAILABLE,
            "Workspace is being configured",
            true,
          );
        }
        return service.submitMessage(frame.payload);
      case "turn.cancel":
        return service.cancelTurn(frame.payload.sessionId, frame.payload.turnId).then(() => null);
      default:
        return assertNever(frame);
    }
  }

  private async configureWorkspace(
    directoryPath: string,
  ): Promise<NonNullable<ReturnType<LocalWorkspaceSource["getSummary"]>>> {
    this.requireService();
    if (!this.workspaceAllowed) {
      throw new BeecodeError(ErrorCodes.FORBIDDEN, "Local Workspace is disabled by Desktop policy");
    }
    this.assertWorkspaceCanChange();
    this.workspaceChanging = true;
    try {
      return await this.workspace.configure(directoryPath);
    } finally {
      this.workspaceChanging = false;
    }
  }

  private assertWorkspaceCanChange(): void {
    if (this.workspaceChanging || this.submissions.size > 0) {
      throw new BeecodeError(
        ErrorCodes.TURN_ALREADY_ACTIVE,
        "Workspace cannot change while a Turn is active",
        true,
      );
    }
  }

  private subscribe(sessionId: string, service: AgentServerFacade): Promise<null> {
    if (!this.subscriptions.has(sessionId)) {
      this.subscriptions.set(
        sessionId,
        service.subscribe(sessionId, (event) => this.publishAgentEvent(event)),
      );
    }
    return Promise.resolve(null);
  }

  private unsubscribe(sessionId: string): Promise<null> {
    this.subscriptions.get(sessionId)?.();
    this.subscriptions.delete(sessionId);
    return Promise.resolve(null);
  }

  private publishAgentEvent(envelope: AgentEventEnvelope): void {
    if (envelope.event.type === "turn.started") {
      this.activeTurns.set(envelope.sessionId, envelope.event.turnId);
    }
    if (
      envelope.event.type === "turn.completed" ||
      envelope.event.type === "turn.failed" ||
      envelope.event.type === "turn.cancelled"
    ) {
      this.activeTurns.delete(envelope.sessionId);
    }
    this.send({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "event",
      event: "agent.event",
      payload: envelope,
    });
  }

  private requireService(): AgentServerFacade {
    if (!this.service) {
      throw new BeecodeError(ErrorCodes.UNAUTHENTICATED, "Desktop login is required");
    }
    return this.service;
  }

  private disposeSubscriptions(): void {
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }

  private send(frame: DesktopIpcFrame): void {
    this.sendFrame(parseDesktopIpcFrame(frame));
  }

  private publishRuntimeStatus(
    state: "handshaking" | "ready" | "unavailable",
    error?: BeecodeError,
  ): void {
    this.send({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "event",
      event: "runtime.status",
      payload: {
        state,
        runtimeId: this.runtimeId,
        ...(error ? { error: error.toShape() } : {}),
      },
    });
  }
}

function unauthenticatedCapabilities(): CapabilitySet {
  const unavailable = { available: false as const, reason: "not_authorized" as const };
  return {
    surface: "desktop",
    runtimeLocation: "local",
    tools: [
      {
        name: "calculator",
        description: calculatorTool.description,
        ...unavailable,
      },
      {
        name: "read_file",
        description: READ_FILE_TOOL_DESCRIPTION,
        ...unavailable,
      },
    ],
    features: {
      localWorkspace: unavailable,
      shell: unavailable,
      git: unavailable,
      attachments: unavailable,
    },
    limits: { maxTurnSteps: DEFAULT_TURN_LIMITS.maxSteps, maxInputBytes: 1_048_576 },
  };
}

function sanitizeRuntimeError(error: unknown): BeecodeError {
  if (error instanceof BeecodeError) return error;
  if (error instanceof TypeError) {
    return new BeecodeError(ErrorCodes.INVALID_REQUEST, error.message);
  }
  return new BeecodeError(ErrorCodes.INTERNAL, "Desktop Runtime request failed");
}

function assertNever(value: never): never {
  throw new BeecodeError(
    ErrorCodes.INVALID_REQUEST,
    `Unsupported Desktop method: ${(value as { method?: string }).method ?? "unknown"}`,
  );
}
