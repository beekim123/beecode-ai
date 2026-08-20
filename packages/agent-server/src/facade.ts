import {
  BeecodeError,
  ErrorCodes,
  type AgentEvent,
  type AgentEventEnvelope,
  type AgentProtocolService,
  type Capability,
  type CapabilityUnavailableReason,
  type CreateSessionInput,
  type Id,
  type ListSessionsInput,
  type ListSessionsResult,
  type Message,
  type Part,
  type Session,
  type SessionSnapshot,
  type SubmitMessageInput,
  type SubmitMessageResult,
  type Surface,
  type ToolCall,
  type ToolCallPart,
  type Turn,
  type UpdateSessionInput,
} from "@beecode/protocol";
import { AgentRuntime, newId, type TurnLimits } from "@beecode/agent-core";
import type { ToolRegistry } from "@beecode/tools";
import type { BackendSessionStore } from "./backend-client.js";
import { toGatewayHistory } from "./history.js";

/**
 * Agent Server Facade（设计文档第 5 节）：
 * Agent Protocol 的应用服务门面，组合 Agent Core、Tool Registry
 * 与 Runtime Backend Protocol 的 Session 存储。
 */

export interface AgentServerFacadeOptions {
  runtime: AgentRuntime;
  tools: ToolRegistry;
  backend: BackendSessionStore;
  surface: Surface;
  limits: TurnLimits;
}

type EventHandler = (event: AgentEventEnvelope) => void;

const DEFAULT_MAX_INPUT_BYTES = 1024 * 1024;

/** 一个 Turn 的领域消息构建器：保留 Assistant -> Tool -> Assistant 的事件顺序。 */
export class TurnMessageBuilder {
  private readonly messages: Message[] = [];
  private readonly assistantById = new Map<Id, Message>();
  private readonly textByPartId = new Map<Id, Extract<Part, { type: "text" }>>();
  private readonly toolPartByCallId = new Map<Id, ToolCallPart>();
  private readonly completedToolResults = new Set<Id>();

  constructor(
    private readonly sessionId: Id,
    private readonly turnId: Id,
    private readonly now: () => string,
  ) {}

  apply(event: AgentEvent): void {
    switch (event.type) {
      case "message.delta": {
        const existing = this.textByPartId.get(event.partId);
        if (existing) {
          existing.text += event.textDelta;
        } else {
          const part: Extract<Part, { type: "text" }> = {
            id: event.partId,
            type: "text",
            text: event.textDelta,
          };
          this.ensureAssistant(event.messageId).parts.push(part);
          this.textByPartId.set(event.partId, part);
        }
        return;
      }
      case "tool.requested": {
        const part: ToolCallPart = {
          id: event.partId,
          type: "tool_call",
          toolCall: { ...event.toolCall },
        };
        this.ensureAssistant(event.messageId).parts.push(part);
        this.toolPartByCallId.set(event.toolCall.id, part);
        return;
      }
      case "tool.started": {
        const part = this.toolPartByCallId.get(event.toolCallId);
        if (part) part.toolCall.status = "running";
        return;
      }
      case "tool.completed":
      case "tool.failed": {
        const part = this.toolPartByCallId.get(event.toolCall.id);
        if (part) part.toolCall = { ...event.toolCall };
        if (!this.completedToolResults.has(event.toolCall.id)) {
          this.completedToolResults.add(event.toolCall.id);
          this.messages.push({
            id: newId("msg"),
            sessionId: this.sessionId,
            turnId: this.turnId,
            role: "tool",
            parts: [
              {
                id: newId("part"),
                type: "tool_result",
                toolCallId: event.toolCall.id,
                result:
                  event.toolCall.status === "completed"
                    ? { ok: true, output: event.toolCall.output }
                    : {
                        ok: false,
                        error: event.toolCall.error ?? {
                          code: ErrorCodes.INTERNAL,
                          message: "Tool failed without an error",
                          retryable: false,
                        },
                      },
              },
            ],
            createdAt: this.now(),
          });
        }
        return;
      }
      case "turn.cancelled":
        for (const part of this.toolPartByCallId.values()) {
          if (part.toolCall.status === "requested" || part.toolCall.status === "running") {
            part.toolCall = {
              ...part.toolCall,
              status: "failed",
              error: {
                code: ErrorCodes.TURN_CANCELLED,
                message: "Tool execution was cancelled with the turn",
                retryable: false,
              },
            };
          }
        }
        return;
      default:
        return;
    }
  }

  buildMessages(): Message[] {
    return this.messages;
  }

  private ensureAssistant(messageId: Id): Message {
    const existing = this.assistantById.get(messageId);
    if (existing) return existing;

    const message: Message = {
      id: messageId,
      sessionId: this.sessionId,
      turnId: this.turnId,
      role: "assistant",
      parts: [],
      createdAt: this.now(),
    };
    this.assistantById.set(messageId, message);
    this.messages.push(message);
    return message;
  }
}

export class AgentServerFacade implements AgentProtocolService {
  private readonly runtime: AgentRuntime;
  private readonly tools: ToolRegistry;
  private readonly backend: BackendSessionStore;
  private readonly surface: Surface;
  private readonly limits: TurnLimits;
  private readonly subscribers = new Map<Id, Set<EventHandler>>();
  private readonly sequenceBySession = new Map<Id, number>();
  private readonly activeSubmissions = new Set<Id>();
  private readonly now: () => string;

  constructor(options: AgentServerFacadeOptions, now: () => string = () => new Date().toISOString()) {
    this.runtime = options.runtime;
    this.tools = options.tools;
    this.backend = options.backend;
    this.surface = options.surface;
    this.limits = options.limits;
    this.now = now;

    this.runtime.onEvent((event) => this.routeEvent(event));
  }

  private routeEvent(event: AgentEvent): void {
    const sequence = (this.sequenceBySession.get(event.sessionId) ?? 0) + 1;
    this.sequenceBySession.set(event.sessionId, sequence);
    const envelope: AgentEventEnvelope = {
      eventId: newId("evt"),
      sessionId: event.sessionId,
      turnId: event.turnId,
      sequence,
      occurredAt: this.now(),
      event,
    };
    const handlers = this.subscribers.get(event.sessionId);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(envelope);
      } catch {
        // 展示层订阅者失败不能改变 Agent Runtime 的执行结果。
      }
    }
  }

  createSession(input: CreateSessionInput): Promise<Session> {
    return this.backend.createSession(input.title);
  }

  async listSessions(_input?: ListSessionsInput): Promise<ListSessionsResult> {
    return { items: await this.backend.listSessions(), nextCursor: null };
  }

  getSessionSnapshot(sessionId: Id): Promise<SessionSnapshot> {
    return this.backend.getSnapshot(sessionId);
  }

  async updateSession(input: UpdateSessionInput): Promise<Session> {
    if (input.title === undefined && input.status === undefined) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "At least one session field must be updated");
    }
    const snapshot = await this.backend.getSnapshot(input.sessionId);
    if (snapshot.session.version !== input.expectedVersion) {
      throw new BeecodeError(ErrorCodes.SESSION_VERSION_CONFLICT, "Session version conflict; reload the session");
    }
    const title = input.title?.trim();
    if (title !== undefined && title.length === 0) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Session title must not be empty");
    }
    if (this.backend.updateSession) {
      return this.backend.updateSession({ ...input, ...(title !== undefined ? { title } : {}) });
    }
    const updated = await this.persist(
      {
        ...snapshot,
        session: {
          ...snapshot.session,
          ...(title !== undefined ? { title } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
      },
      input.expectedVersion,
    );
    return updated.session;
  }

  subscribe(sessionId: Id, handler: EventHandler): () => void {
    let handlers = this.subscribers.get(sessionId);
    if (!handlers) {
      handlers = new Set();
      this.subscribers.set(sessionId, handlers);
    }
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) this.subscribers.delete(sessionId);
    };
  }

  async cancelTurn(sessionId: Id, turnId: Id): Promise<void> {
    if (!this.runtime.cancelTurn(sessionId, turnId)) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "No active turn matches the given id");
    }
  }

  async getCapabilities(): Promise<Capability> {
    const unavailableReason: CapabilityUnavailableReason =
      this.surface === "web" ? "surface_policy" : "runtime_missing";
    const unavailable = { available: false as const, reason: unavailableReason };
    const hasWorkspace = this.tools.schemasFor(this.surface).some((schema) => schema.name === "read_file");
    return {
      surface: this.surface,
      runtimeLocation: this.surface === "web" ? "backend" : "local",
      tools: this.tools.schemasFor(this.surface).map((schema) => ({
        name: schema.name,
        description: schema.description,
        available: true,
      })),
      features: {
        localWorkspace: hasWorkspace
          ? { available: true }
          : { available: false, reason: "not_configured" },
        shell: unavailable,
        git: unavailable,
        attachments: unavailable,
      },
      limits: {
        maxTurnSteps: this.limits.maxSteps,
        maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
      },
    };
  }

  /**
   * 提交用户消息并运行一个 Turn。
   * 在线进度通过 subscribe 的事件流获取；本方法在 Turn 结束后返回。
   * 持久化失败会以 SYNC_FAILED 抛出，绝不把未同步状态伪装成已保存。
   */
  async submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
    if (input.text.trim().length === 0) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Message text must not be empty");
    }
    if (this.activeSubmissions.has(input.sessionId)) {
      throw new BeecodeError(ErrorCodes.TURN_ALREADY_ACTIVE, "Session already has an active turn");
    }
    this.activeSubmissions.add(input.sessionId);

    try {
      // 1. 拉取权威快照，并在执行前保存用户消息和 queued Turn。
      const snapshot = await this.backend.getSnapshot(input.sessionId);
      const userMessageId = newId("msg");
      const turn: Turn = {
        id: newId("turn"),
        sessionId: input.sessionId,
        index: Math.max(0, ...snapshot.turns.map((item) => item.index)) + 1,
        status: "queued",
        userMessageId,
      };
      const userMessage: Message = {
        id: userMessageId,
        sessionId: input.sessionId,
        turnId: turn.id,
        role: "user",
        parts: [{ id: newId("part"), type: "text", text: input.text }],
        createdAt: this.now(),
      };
      let current = await this.persist(
        {
          session: snapshot.session,
          messages: [...snapshot.messages, userMessage],
          turns: [...snapshot.turns, turn],
        },
        snapshot.session.version,
      );

      // 2. Runtime history 只包含先前消息；当前 userText 由 Runtime 追加一次。
      const builder = new TurnMessageBuilder(input.sessionId, turn.id, this.now);
      const unsubscribe = this.subscribe(input.sessionId, (envelope) => builder.apply(envelope.event));
      let result;
      try {
        result = await this.runtime.runTurn({
          sessionId: input.sessionId,
          turnIndex: turn.index,
          history: toGatewayHistory(snapshot.messages),
          userText: input.text,
          turnId: turn.id,
          userMessageId,
        });
      } finally {
        unsubscribe();
      }

      // 3. 即使没有 Assistant 文本，也要保存 Turn 的 failed/cancelled 终态。
      const assistantMessages = builder.buildMessages();
      current = await this.persist(
        {
          session: current.session,
          messages: [...current.messages, ...assistantMessages],
          turns: current.turns.map((item) => (item.id === result.turn.id ? result.turn : item)),
        },
        current.session.version,
      );

      return { turn: result.turn };
    } finally {
      this.activeSubmissions.delete(input.sessionId);
    }
  }

  private async persist(snapshot: SessionSnapshot, expectedVersion: number): Promise<SessionSnapshot> {
    let saved;
    try {
      saved = await this.backend.saveSnapshot(snapshot, expectedVersion);
    } catch (err) {
      // 版本冲突与失联都以稳定错误码抛出，不自动合并
      throw BeecodeError.fromUnknown(err);
    }
    return { session: saved, messages: snapshot.messages, turns: snapshot.turns };
  }
}

export { ErrorCodes };
