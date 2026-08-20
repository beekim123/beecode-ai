import {
  AgentRuntime,
  DEFAULT_TURN_LIMITS,
  newId,
} from "@beecode/agent-core";
import { TurnMessageBuilder, toGatewayHistory } from "@beecode/agent-server";
import {
  BeecodeError,
  ErrorCodes,
  type AgentEvent,
  type AgentEventEnvelope,
  type BrowserWorkspaceOperationResult,
  type BrowserWorkspaceReference,
  type CapabilitySet,
  type Message,
  type SessionSnapshot,
  type Surface,
  type Turn,
} from "@beecode/protocol";
import {
  READ_FILE_TOOL_DESCRIPTION,
  createDefaultToolRegistry,
} from "@beecode/tools";
import type { ModelGatewayService } from "../model/model-gateway-service.js";
import type { SessionRepository } from "../session/session-repository.js";
import { BrowserWorkspaceSource } from "./browser-workspace-source.js";

type EventSubscriber = (event: AgentEventEnvelope) => void;

interface SessionChannel {
  sequence: number;
  subscribers: Set<EventSubscriber>;
}

interface ActiveExecution {
  accountId: string;
  runtime: AgentRuntime;
  turn: Turn;
  builder: TurnMessageBuilder;
  persistence: Promise<void>;
  browserWorkspace?: BrowserWorkspaceSource;
}

type BackendRuntimeSurface = Extract<Surface, "web" | "ios">;

export interface BackendSurfaceRuntimeHostOptions {
  repository: SessionRepository;
  modelGateway: ModelGatewayService;
  surface?: BackendRuntimeSurface;
  maxConcurrentTurnsPerAccount?: number;
  now?: () => Date;
}

export class BackendSurfaceRuntimeHost {
  private readonly repository: SessionRepository;
  private readonly modelGateway: ModelGatewayService;
  private readonly surface: BackendRuntimeSurface;
  private readonly maxConcurrentTurnsPerAccount: number;
  private readonly now: () => Date;
  private readonly activeBySession = new Map<string, ActiveExecution>();
  private readonly channels = new Map<string, SessionChannel>();
  private readonly recovery: Promise<number>;

  constructor(options: BackendSurfaceRuntimeHostOptions) {
    this.repository = options.repository;
    this.modelGateway = options.modelGateway;
    this.surface = options.surface ?? "web";
    this.maxConcurrentTurnsPerAccount = options.maxConcurrentTurnsPerAccount ?? 4;
    this.now = options.now ?? (() => new Date());
    this.recovery = this.repository.recoverInterruptedTurns();
  }

  ready(): Promise<number> {
    return this.recovery;
  }

  async getSnapshot(accountId: string, sessionId: string): Promise<SessionSnapshot> {
    await this.recovery;
    const snapshot = await this.repository.getOwned(accountId, sessionId);
    if (!snapshot) throw new BeecodeError(ErrorCodes.SESSION_NOT_FOUND, this.notFoundMessage());
    const active = this.activeBySession.get(sessionId);
    const channel = this.channels.get(sessionId);
    if (!active || active.accountId !== accountId) {
      return {
        ...snapshot,
        ...(channel ? { live: { sequence: channel.sequence } } : {}),
      };
    }
    const browserWorkspaceRequests = active.browserWorkspace?.getPendingRequests() ?? [];

    return {
      session: snapshot.session,
      messages: mergeActiveMessages(snapshot.messages, active.turn.id, active.builder.buildMessages()),
      turns: snapshot.turns.map((turn) =>
        turn.id === active.turn.id ? structuredClone(active.turn) : turn,
      ),
      live: {
        sequence: channel?.sequence ?? 0,
        activeTurnId: active.turn.id,
        ...(browserWorkspaceRequests.length > 0
          ? { browserWorkspaceRequests }
          : {}),
      },
    };
  }

  async submitTurn(input: {
    accountId: string;
    sessionId: string;
    text: string;
    idempotencyKey: string;
    workspace?: BrowserWorkspaceReference;
  }): Promise<{ turn: Turn }> {
    await this.recovery;
    const activeCount = [...this.activeBySession.values()].filter(
      (active) => active.accountId === input.accountId,
    ).length;
    if (activeCount >= this.maxConcurrentTurnsPerAccount) {
      throw new BeecodeError(
        ErrorCodes.TURN_ALREADY_ACTIVE,
        `Account has reached its concurrent ${this.surfaceLabel()} turn limit`,
        true,
      );
    }
    const accepted = await this.repository.acceptTurn(input);
    if (accepted.isExisting) return { turn: accepted.turn };

    const snapshot = await this.repository.getOwned(input.accountId, input.sessionId);
    if (!snapshot) throw new BeecodeError(ErrorCodes.SESSION_NOT_FOUND, this.notFoundMessage());
    const browserWorkspace = this.surface === "web" && input.workspace
      ? new BrowserWorkspaceSource(input.workspace, accepted.turn.id)
      : undefined;
    const tools = createDefaultToolRegistry({ workspace: browserWorkspace });
    const runtime = new AgentRuntime({
      gateway: this.modelGateway.forAccount(input.accountId, accepted.turn.id),
      tools,
      surface: this.surface,
    });
    const builder = new TurnMessageBuilder(
      input.sessionId,
      accepted.turn.id,
      () => this.now().toISOString(),
    );
    const active: ActiveExecution = {
      accountId: input.accountId,
      runtime,
      turn: structuredClone(accepted.turn),
      builder,
      persistence: Promise.resolve(),
      browserWorkspace,
    };
    this.activeBySession.set(input.sessionId, active);
    runtime.onEvent((event) => this.applyRuntimeEvent(active, event));

    const history = toGatewayHistory(
      snapshot.messages.filter((message) => message.turnId !== accepted.turn.id),
    );
    void this.execute(active, history, input.text).catch(() => {
      // execute() persists a stable failed state before rejecting.
    });
    return { turn: accepted.turn };
  }

  async cancelTurn(accountId: string, sessionId: string, turnId: string): Promise<void> {
    await this.recovery;
    const snapshot = await this.repository.getOwned(accountId, sessionId);
    if (!snapshot) throw new BeecodeError(ErrorCodes.SESSION_NOT_FOUND, this.notFoundMessage());
    const turn = snapshot.turns.find((candidate) => candidate.id === turnId);
    if (!turn) throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Turn does not belong to this session");
    if (turn.status === "cancelled") return;
    const active = this.activeBySession.get(sessionId);
    if (!active || active.accountId !== accountId || active.turn.id !== turnId) {
      if (turn.status === "completed" || turn.status === "failed") return;
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Turn is not active");
    }
    active.runtime.cancelTurn(sessionId, turnId);
  }

  async submitBrowserWorkspaceToolResult(
    accountId: string,
    sessionId: string,
    turnId: string,
    toolCallId: string,
    workspaceId: string,
    result: BrowserWorkspaceOperationResult,
  ): Promise<void> {
    await this.recovery;
    const snapshot = await this.repository.getOwned(accountId, sessionId);
    if (!snapshot) throw new BeecodeError(ErrorCodes.SESSION_NOT_FOUND, this.notFoundMessage());
    const active = this.activeBySession.get(sessionId);
    if (!active || active.accountId !== accountId || active.turn.id !== turnId) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Turn is not active");
    }
    if (!active.browserWorkspace) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Turn has no browser Workspace");
    }
    active.browserWorkspace.submitResult(toolCallId, workspaceId, result);
  }

  subscribe(sessionId: string, subscriber: EventSubscriber): () => void {
    const channel = this.getChannel(sessionId);
    channel.subscribers.add(subscriber);
    return () => {
      channel.subscribers.delete(subscriber);
      if (channel.subscribers.size === 0 && !this.activeBySession.has(sessionId)) {
        this.channels.delete(sessionId);
      }
    };
  }

  getSequence(sessionId: string): number {
    return this.channels.get(sessionId)?.sequence ?? 0;
  }

  getCapabilities(): CapabilitySet {
    const tools = createDefaultToolRegistry();
    const unavailable = { available: false as const, reason: "surface_policy" as const };
    const supportsBrowserWorkspace = this.surface === "web";
    const toolCapabilities = tools.schemasFor(this.surface).map((schema) => ({
      name: schema.name,
      description: schema.description,
      available: true as const,
    }));
    if (supportsBrowserWorkspace) {
      toolCapabilities.push({
        name: "read_file",
        description: READ_FILE_TOOL_DESCRIPTION,
        available: true,
      });
    }
    return {
      surface: this.surface,
      runtimeLocation: "backend",
      tools: toolCapabilities,
      features: {
        localWorkspace: supportsBrowserWorkspace ? { available: true } : unavailable,
        shell: unavailable,
        git: unavailable,
        attachments: unavailable,
      },
      limits: {
        maxTurnSteps: DEFAULT_TURN_LIMITS.maxSteps,
        maxInputBytes: 1024 * 1024,
      },
    };
  }

  private async execute(
    active: ActiveExecution,
    history: ReturnType<typeof toGatewayHistory>,
    userText: string,
  ): Promise<void> {
    try {
      const result = await active.runtime.runTurn({
        sessionId: active.turn.sessionId,
        turnIndex: active.turn.index,
        history,
        userText,
        turnId: active.turn.id,
        userMessageId: active.turn.userMessageId,
      });
      active.turn = structuredClone(result.turn);
      await active.persistence;
      await this.repository.saveTurnProjection({
        accountId: active.accountId,
        sessionId: active.turn.sessionId,
        turn: active.turn,
        messages: structuredClone(active.builder.buildMessages()),
      });
    } catch (error: unknown) {
      const beecode = BeecodeError.fromUnknown(error);
      active.turn = {
        ...active.turn,
        status: "failed",
        error: beecode.toShape(),
        finishedAt: this.now().toISOString(),
      };
      await this.repository.saveTurnProjection({
        accountId: active.accountId,
        sessionId: active.turn.sessionId,
        turn: active.turn,
        messages: structuredClone(active.builder.buildMessages()),
      });
      throw beecode;
    } finally {
      active.browserWorkspace?.dispose();
      this.activeBySession.delete(active.turn.sessionId);
      const channel = this.channels.get(active.turn.sessionId);
      if (channel?.subscribers.size === 0) this.channels.delete(active.turn.sessionId);
    }
  }

  private applyRuntimeEvent(active: ActiveExecution, event: AgentEvent): void {
    const browserWorkspaceRequest = event.type === "tool.requested"
      ? active.browserWorkspace?.prepare(event.toolCall)
      : undefined;
    const projectedEvent = event.type === "tool.requested" && browserWorkspaceRequest
      ? { ...event, browserWorkspaceRequest }
      : event;
    active.builder.apply(projectedEvent);
    active.turn = projectTurn(active.turn, projectedEvent);
    this.broadcast(projectedEvent);
    if (
      event.type === "turn.started" ||
      event.type === "tool.completed" ||
      event.type === "tool.failed"
    ) {
      active.persistence = active.persistence.then(() =>
        this.repository.saveTurnProjection({
          accountId: active.accountId,
          sessionId: active.turn.sessionId,
          turn: structuredClone(active.turn),
          messages: structuredClone(active.builder.buildMessages()),
        }),
      );
    }
  }

  private broadcast(event: AgentEvent): void {
    const channel = this.getChannel(event.sessionId);
    channel.sequence += 1;
    const envelope: AgentEventEnvelope = {
      eventId: newId("evt"),
      sessionId: event.sessionId,
      turnId: event.turnId,
      sequence: channel.sequence,
      occurredAt: this.now().toISOString(),
      event,
    };
    for (const subscriber of channel.subscribers) {
      try {
        subscriber(envelope);
      } catch {
        // A disconnected presentation subscriber cannot change Runtime state.
      }
    }
  }

  private getChannel(sessionId: string): SessionChannel {
    const existing = this.channels.get(sessionId);
    if (existing) return existing;
    const channel: SessionChannel = { sequence: 0, subscribers: new Set() };
    this.channels.set(sessionId, channel);
    return channel;
  }

  private surfaceLabel(): string {
    return this.surface === "ios" ? "iOS" : "Web";
  }

  private notFoundMessage(): string {
    return `${this.surfaceLabel()} session not found`;
  }
}

/** Compatibility name retained for existing Web host callers. */
export { BackendSurfaceRuntimeHost as WebRuntimeHost };
export type WebRuntimeHostOptions = BackendSurfaceRuntimeHostOptions;

function projectTurn(turn: Turn, event: AgentEvent): Turn {
  switch (event.type) {
    case "turn.started":
      return structuredClone(event.turn);
    case "message.delta":
      return { ...turn, status: "model_streaming", assistantMessageId: event.messageId };
    case "tool.requested":
    case "tool.started":
    case "tool.completed":
    case "tool.failed":
      return { ...turn, status: "tool_running" };
    case "turn.completed":
      return { ...turn, status: "completed", usage: event.usage };
    case "turn.failed":
      return { ...turn, status: "failed", error: event.error };
    case "turn.cancelled":
      return { ...turn, status: "cancelled" };
  }
}

function mergeActiveMessages(
  messages: Message[],
  turnId: string,
  activeMessages: Message[],
): Message[] {
  return [
    ...messages.filter((message) => message.turnId !== turnId || message.role === "user"),
    ...structuredClone(activeMessages),
  ];
}
