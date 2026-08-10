import type {
  AgentEvent,
  AgentProtocolService,
  Capability,
  CreateSessionInput,
  Id,
  Session,
  SessionSnapshot,
  SubmitMessageInput,
  SubmitMessageResult,
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
  listSessions(): Promise<Session[]> {
    return this.service.listSessions();
  }
  getSessionSnapshot(sessionId: Id): Promise<SessionSnapshot> {
    return this.service.getSessionSnapshot(sessionId);
  }
  submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
    return this.service.submitMessage(input);
  }
  cancelTurn(sessionId: Id, turnId: Id): Promise<void> {
    return this.service.cancelTurn(sessionId, turnId);
  }
  subscribe(sessionId: Id, handler: (event: AgentEvent) => void): () => void {
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

  listSessions(): Promise<Session[]> {
    return this.transport.listSessions();
  }

  /** CLI 重启后调用：拉取完整快照，不回放历史事件 */
  getSessionSnapshot(sessionId: Id): Promise<SessionSnapshot> {
    return this.transport.getSessionSnapshot(sessionId);
  }

  submitMessage(sessionId: Id, text: string): Promise<SubmitMessageResult> {
    return this.transport.submitMessage({ sessionId, text });
  }

  cancelTurn(sessionId: Id, turnId: Id): Promise<void> {
    return this.transport.cancelTurn(sessionId, turnId);
  }

  subscribe(sessionId: Id, handler: (event: AgentEvent) => void): () => void {
    return this.transport.subscribe(sessionId, handler);
  }

  getCapabilities(): Promise<Capability> {
    return this.transport.getCapabilities();
  }
}
