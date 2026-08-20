import {
  BeecodeError,
  ErrorCodes,
  parseErrorShape,
  parseSession,
  parseSessions,
  parseSessionSnapshot,
  type Session,
  type SessionSnapshot,
  type UpdateSessionInput,
} from "@beecode/protocol";

/**
 * Runtime Backend Protocol 的 Session 存储端口。
 * 权威数据在 Beecode 后端；本地状态只是当前执行与缓存（设计文档 10.1）。
 */
export interface BackendSessionStore {
  createSession(title?: string): Promise<Session>;
  listSessions(): Promise<Session[]>;
  getSnapshot(sessionId: string): Promise<SessionSnapshot>;
  /** Surface-specific metadata update when snapshots cannot mutate Session fields. */
  updateSession?(input: UpdateSessionInput): Promise<Session>;
  /** 乐观并发：版本不一致时后端拒绝（SESSION_VERSION_CONFLICT） */
  saveSnapshot(snapshot: SessionSnapshot, expectedVersion: number): Promise<Session>;
}

interface HttpBackendClientOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

/** Runtime Backend Protocol 的 HTTP 实现（CLI Runtime → Beecode 后端） */
export class HttpBackendClient implements BackendSessionStore {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpBackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  createSession(title?: string): Promise<Session> {
    return this.request("POST", "/v1/cli/sessions", parseSession, { title });
  }

  listSessions(): Promise<Session[]> {
    return this.request("GET", "/v1/cli/sessions", parseSessions);
  }

  getSnapshot(sessionId: string): Promise<SessionSnapshot> {
    return this.request("GET", `/v1/cli/sessions/${encodeURIComponent(sessionId)}`, parseSessionSnapshot);
  }

  saveSnapshot(snapshot: SessionSnapshot, expectedVersion: number): Promise<Session> {
    return this.request(
      "PUT",
      `/v1/cli/sessions/${encodeURIComponent(snapshot.session.id)}`,
      parseSession,
      {
        expectedVersion,
        session: snapshot.session,
        messages: snapshot.messages,
        turns: snapshot.turns,
      },
    );
  }

  private async request<TResult>(
    method: string,
    path: string,
    parse: (value: unknown) => TResult,
    body?: unknown,
  ): Promise<TResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new BeecodeError(
        ErrorCodes.SYNC_FAILED,
        `Cannot reach Beecode backend at ${this.baseUrl}: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
    }
    if (!response.ok) {
      throw await toBeecodeError(response);
    }
    let value: unknown;
    try {
      value = await response.json();
      return parse(value);
    } catch (error: unknown) {
      throw new BeecodeError(
        ErrorCodes.SYNC_FAILED,
        `Backend returned an invalid response for ${method} ${path}`,
        true,
      );
    }
  }
}

export async function toBeecodeError(response: Response): Promise<BeecodeError> {
  let code: string = ErrorCodes.INTERNAL;
  let message = `Backend returned HTTP ${response.status}`;
  let retryable = response.status >= 500;
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body) {
      const shape = parseErrorShape((body as { error: unknown }).error);
      code = shape.code;
      message = shape.message;
      retryable = shape.retryable;
    }
  } catch {
    // 保留默认错误
  }
  return BeecodeError.fromShape({ code, message, retryable });
}
