import type {
  AgentEvent,
  AgentEventEnvelope,
  AgentProtocolService,
  BrowserWorkspaceReference,
  Capability,
  CreateSessionInput,
  Id,
  ListSessionsInput,
  ListSessionsResult,
  Session,
  SessionSnapshot,
  SubmitMessageInput,
  SubmitMessageResult,
  UpdateSessionInput,
} from "@beecode/protocol";

/**
 * Transport 抽象（设计文档 4.1）：
 * Transport 只能改变传输方式，不能改变命令、错误、事件或状态语义。
 * 第一阶段 CLI 使用 In-Process Transport；未来可替换为 SSE/HTTP。
 */
export type Transport = AgentProtocolService;

/** 进程内 Transport：直连 Agent Server Facade，不绕过协议边界 */
export class InProcessTransport implements Transport {
  constructor(private readonly service: AgentProtocolService) {}

  createSession(input: CreateSessionInput): Promise<Session> {
    return this.service.createSession(input);
  }
  listSessions(input?: ListSessionsInput): Promise<ListSessionsResult> {
    return this.service.listSessions(input);
  }
  getSessionSnapshot(sessionId: Id): Promise<SessionSnapshot> {
    return this.service.getSessionSnapshot(sessionId);
  }
  updateSession(input: UpdateSessionInput): Promise<Session> {
    return this.service.updateSession(input);
  }
  submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
    return this.service.submitMessage(input);
  }
  cancelTurn(sessionId: Id, turnId: Id): Promise<void> {
    return this.service.cancelTurn(sessionId, turnId);
  }
  subscribe(sessionId: Id, handler: (event: AgentEventEnvelope) => void): () => void {
    return this.service.subscribe(sessionId, handler);
  }
  getCapabilities(): Promise<Capability> {
    return this.service.getCapabilities();
  }
}

/**
 * Client SDK：所有产品端调用 Agent Protocol 的统一入口。
 * 展示层只依赖本 SDK，不直接调用 Agent Core。
 */
export class BeecodeClient {
  constructor(private readonly transport: Transport) {}

  createSession(title?: string): Promise<Session> {
    return this.transport.createSession({ title });
  }

  listSessionPage(input: ListSessionsInput = {}): Promise<ListSessionsResult> {
    return this.transport.listSessions(input);
  }

  async listSessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.transport.listSessions(cursor === undefined ? {} : { cursor });
      sessions.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (cursor !== undefined && seenCursors.has(cursor)) {
        throw new Error("Session pagination returned a repeated cursor");
      }
      if (cursor !== undefined) seenCursors.add(cursor);
    } while (cursor !== undefined);
    return sessions;
  }

  /** CLI 重启后调用：拉取完整快照，不回放历史事件 */
  getSessionSnapshot(sessionId: Id): Promise<SessionSnapshot> {
    return this.transport.getSessionSnapshot(sessionId);
  }

  updateSession(input: UpdateSessionInput): Promise<Session> {
    return this.transport.updateSession(input);
  }

  submitMessage(
    sessionId: Id,
    text: string,
    idempotencyKey?: string,
    workspace?: BrowserWorkspaceReference,
  ): Promise<SubmitMessageResult> {
    return this.transport.submitMessage({ sessionId, text, idempotencyKey, workspace });
  }

  cancelTurn(sessionId: Id, turnId: Id): Promise<void> {
    return this.transport.cancelTurn(sessionId, turnId);
  }

  subscribe(sessionId: Id, handler: (event: AgentEvent) => void): () => void {
    return this.transport.subscribe(sessionId, (envelope) => handler(envelope.event));
  }

  subscribeEnvelopes(sessionId: Id, handler: (event: AgentEventEnvelope) => void): () => void {
    return this.transport.subscribe(sessionId, handler);
  }

  getCapabilities(): Promise<Capability> {
    return this.transport.getCapabilities();
  }
}

export * from "./http-transport.js";
