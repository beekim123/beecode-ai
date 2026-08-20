import {
  BeecodeError,
  BEECODE_CSRF_HEADER_NAME,
  BEECODE_CSRF_HEADER_VALUE,
  ErrorCodes,
  parseAccountSummary,
  parseAgentEventEnvelope,
  parseCapabilitySet,
  parseErrorShape,
  parseQuotaSnapshot,
  parseSession,
  parseSessionPage,
  parseSessionSnapshot,
  parseTurn,
  type AccountSummary,
  type AgentEventEnvelope,
  type AgentProtocolService,
  type BrowserWorkspaceOperationResult,
  type BrowserWorkspaceToolRequest,
  type Capability,
  type CreateSessionInput,
  type Id,
  type ListSessionsInput,
  type ListSessionsResult,
  type QuotaSnapshot,
  type Session,
  type SessionSnapshot,
  type SubmitMessageInput,
  type SubmitMessageResult,
  type UpdateSessionInput,
} from "@beecode/protocol";

export type ConnectionState = "connecting" | "recovering" | "connected" | "reconnecting" | "unauthenticated";

interface MessageEventLike {
  data: string;
}

interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEventLike) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface RecoveryHandlers {
  onSnapshot(snapshot: SessionSnapshot): void;
  onEvent(event: AgentEventEnvelope): void;
  onConnectionState?(state: ConnectionState): void;
  onError?(error: BeecodeError): void;
}

export interface HttpAgentTransportOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  eventSourceFactory?: EventSourceFactory;
}

export class HttpAgentTransport implements AgentProtocolService {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly eventSourceFactory: EventSourceFactory;

  constructor(options: HttpAgentTransportOptions = {}) {
    this.baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.eventSourceFactory = options.eventSourceFactory ?? defaultEventSourceFactory;
  }

  createSession(input: CreateSessionInput): Promise<Session> {
    return this.request("POST", "/v1/web/sessions", parseSession, input);
  }

  listSessions(input: ListSessionsInput = {}): Promise<ListSessionsResult> {
    const search = new URLSearchParams();
    if (input.cursor) search.set("cursor", input.cursor);
    if (input.limit !== undefined) search.set("limit", String(input.limit));
    const suffix = search.size > 0 ? `?${search}` : "";
    return this.request("GET", `/v1/web/sessions${suffix}`, parseSessionPage);
  }

  getSessionSnapshot(sessionId: Id): Promise<SessionSnapshot> {
    return this.request(
      "GET",
      `/v1/web/sessions/${encodeURIComponent(sessionId)}`,
      parseSessionSnapshot,
    );
  }

  updateSession(input: UpdateSessionInput): Promise<Session> {
    return this.request(
      "PATCH",
      `/v1/web/sessions/${encodeURIComponent(input.sessionId)}`,
      parseSession,
      {
        expectedVersion: input.expectedVersion,
        title: input.title,
        status: input.status,
      },
    );
  }

  async submitMessage(input: SubmitMessageInput): Promise<SubmitMessageResult> {
    if (!input.idempotencyKey) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Web turns require an idempotency key");
    }
    return this.request(
      "POST",
      `/v1/web/sessions/${encodeURIComponent(input.sessionId)}/turns`,
      (value) => {
        if (!isRecord(value) || !("turn" in value)) {
          throw new TypeError("Invalid turn response");
        }
        return { turn: parseTurn(value.turn) };
      },
      {
        text: input.text,
        idempotencyKey: input.idempotencyKey,
        ...(input.workspace ? { workspace: input.workspace } : {}),
      },
    );
  }

  async cancelTurn(sessionId: Id, turnId: Id): Promise<void> {
    await this.requestNoContent(
      "POST",
      `/v1/web/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/cancel`,
    );
  }

  async submitBrowserWorkspaceToolResult(
    sessionId: Id,
    request: BrowserWorkspaceToolRequest,
    result: BrowserWorkspaceOperationResult,
  ): Promise<void> {
    await this.requestNoContent(
      "POST",
      `/v1/web/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(request.turnId)}` +
        `/tool-calls/${encodeURIComponent(request.toolCallId)}/result`,
      { workspaceId: request.workspaceId, result },
    );
  }

  subscribe(sessionId: Id, handler: (event: AgentEventEnvelope) => void): () => void {
    const source = this.eventSourceFactory(
      this.url(`/v1/web/sessions/${encodeURIComponent(sessionId)}/events`),
    );
    source.addEventListener("agent", (message) => {
      try {
        handler(parseAgentEventEnvelope(JSON.parse(message.data)));
      } catch {
        // Malformed online data is ignored here; recovery subscribers receive an explicit error.
      }
    });
    return () => source.close();
  }

  subscribeWithRecovery(sessionId: Id, handlers: RecoveryHandlers): () => void {
    const source = this.eventSourceFactory(
      this.url(`/v1/web/sessions/${encodeURIComponent(sessionId)}/events`),
    );
    let generation = 0;
    let lastSequence = -1;
    let isReady = false;
    let buffer: AgentEventEnvelope[] = [];
    let closed = false;
    handlers.onConnectionState?.("connecting");

    source.addEventListener("stream.connected", () => {
      const currentGeneration = ++generation;
      isReady = false;
      buffer = [];
      handlers.onConnectionState?.(currentGeneration === 1 ? "recovering" : "reconnecting");
      void this.getSessionSnapshot(sessionId)
        .then((snapshot) => {
          if (closed || generation !== currentGeneration) return;
          handlers.onSnapshot(snapshot);
          lastSequence = snapshot.live?.sequence ?? 0;
          for (const envelope of [...buffer].sort((left, right) => left.sequence - right.sequence)) {
            if (envelope.sequence > lastSequence) {
              handlers.onEvent(envelope);
              lastSequence = envelope.sequence;
            }
          }
          buffer = [];
          isReady = true;
          handlers.onConnectionState?.("connected");
        })
        .catch((error: unknown) => {
          if (closed || generation !== currentGeneration) return;
          const beecode = BeecodeError.fromUnknown(error);
          if (
            beecode.code === ErrorCodes.UNAUTHENTICATED ||
            beecode.code === ErrorCodes.TOKEN_EXPIRED ||
            beecode.code === ErrorCodes.TOKEN_REVOKED
          ) {
            handlers.onConnectionState?.("unauthenticated");
            source.close();
          } else {
            handlers.onConnectionState?.("reconnecting");
          }
          handlers.onError?.(beecode);
        });
    });

    source.addEventListener("agent", (message) => {
      try {
        const envelope = parseAgentEventEnvelope(JSON.parse(message.data));
        if (!isReady) {
          buffer.push(envelope);
          return;
        }
        if (envelope.sequence <= lastSequence) return;
        handlers.onEvent(envelope);
        lastSequence = envelope.sequence;
      } catch (error: unknown) {
        handlers.onError?.(
          new BeecodeError(
            ErrorCodes.STREAM_DISCONNECTED,
            error instanceof Error ? error.message : "Malformed session event",
            true,
          ),
        );
      }
    });

    source.addEventListener("error", () => {
      if (!closed) handlers.onConnectionState?.("reconnecting");
    });

    return () => {
      closed = true;
      source.close();
    };
  }

  getCapabilities(): Promise<Capability> {
    return this.request("GET", "/v1/web/capabilities", parseCapabilitySet);
  }

  getCurrentAccount(): Promise<AccountSummary> {
    return this.request("GET", "/v1/me", parseAccountSummary);
  }

  getQuota(): Promise<QuotaSnapshot> {
    return this.request("GET", "/v1/quota", parseQuotaSnapshot);
  }

  async logout(): Promise<void> {
    await this.requestNoContent("POST", "/v1/auth/logout");
  }

  loginUrl(provider = "development", returnTo = "/app"): string {
    const search = new URLSearchParams({ returnTo });
    return this.url(`/v1/auth/login/${encodeURIComponent(provider)}?${search}`);
  }

  private async request<TResult>(
    method: string,
    path: string,
    parse: (value: unknown) => TResult,
    body?: unknown,
  ): Promise<TResult> {
    const response = await this.fetchImpl(this.url(path), {
      method,
      credentials: "include",
      headers: createRequestHeaders(method, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await toBeecodeError(response);
    return parse(await response.json());
  }

  private async requestNoContent(method: string, path: string, body?: unknown): Promise<void> {
    const response = await this.fetchImpl(this.url(path), {
      method,
      credentials: "include",
      headers: createRequestHeaders(method, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await toBeecodeError(response);
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}

function createRequestHeaders(method: string, hasJsonBody: boolean): Headers | undefined {
  const headers = new Headers();
  if (hasJsonBody) headers.set("content-type", "application/json");
  const isWrite = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (isWrite) {
    headers.set(BEECODE_CSRF_HEADER_NAME, BEECODE_CSRF_HEADER_VALUE);
  }
  return hasJsonBody || isWrite ? headers : undefined;
}

export async function toBeecodeError(response: Response): Promise<BeecodeError> {
  try {
    const value: unknown = await response.json();
    if (isRecord(value) && "error" in value) {
      return BeecodeError.fromShape(parseErrorShape(value.error));
    }
  } catch {
    // Use the HTTP fallback below.
  }
  return new BeecodeError(
    response.status === 401 ? ErrorCodes.UNAUTHENTICATED : ErrorCodes.INTERNAL,
    `Beecode API returned HTTP ${response.status}`,
    response.status >= 500,
  );
}

function defaultEventSourceFactory(url: string): EventSourceLike {
  const EventSourceConstructor = (globalThis as unknown as {
    EventSource?: new (sourceUrl: string, init: { withCredentials: boolean }) => EventSourceLike;
  }).EventSource;
  if (!EventSourceConstructor) {
    throw new BeecodeError(ErrorCodes.SURFACE_UNAVAILABLE, "EventSource is unavailable in this runtime");
  }
  return new EventSourceConstructor(url, { withCredentials: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
