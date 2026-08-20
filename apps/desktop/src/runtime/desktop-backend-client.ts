import {
  BeecodeError,
  ErrorCodes,
  parseDesktopSurfacePolicy,
  parseSession,
  parseSessionPage,
  parseSessionSnapshot,
  type DesktopSurfacePolicy,
  type Session,
  type SessionSnapshot,
  type UpdateSessionInput,
} from "@beecode/protocol";
import { toBeecodeError, type BackendSessionStore } from "@beecode/agent-server";
import type { RuntimeTokenStore } from "./token-store.js";

interface DesktopBackendClientOptions {
  baseUrl: string;
  runtimeId: string;
  replacesRuntimeId?: string;
  tokens: RuntimeTokenStore;
  fetchImpl?: typeof fetch;
}

export class DesktopBackendClient implements BackendSessionStore {
  private readonly baseUrl: string;
  private readonly runtimeId: string;
  private readonly replacesRuntimeId: string | undefined;
  private readonly tokens: RuntimeTokenStore;
  private readonly fetchImpl: typeof fetch;

  constructor(options: DesktopBackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.runtimeId = options.runtimeId;
    this.replacesRuntimeId = options.replacesRuntimeId;
    this.tokens = options.tokens;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  createSession(title?: string): Promise<Session> {
    return this.request("POST", "/v1/desktop/sessions", parseSession, { title });
  }

  async listSessions(): Promise<Session[]> {
    const sessions: Session[] = [];
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const page = await this.request(
        "GET",
        `/v1/desktop/sessions?${query.toString()}`,
        parseSessionPage,
      );
      sessions.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) {
        throw new BeecodeError(ErrorCodes.SYNC_FAILED, "Desktop session pagination repeated a cursor", true);
      }
      if (cursor) seen.add(cursor);
    } while (cursor);
    return sessions;
  }

  getSnapshot(sessionId: string): Promise<SessionSnapshot> {
    return this.request(
      "GET",
      `/v1/desktop/sessions/${encodeURIComponent(sessionId)}`,
      parseSessionSnapshot,
    );
  }

  updateSession(input: UpdateSessionInput): Promise<Session> {
    return this.request(
      "PATCH",
      `/v1/desktop/sessions/${encodeURIComponent(input.sessionId)}`,
      parseSession,
      {
        expectedVersion: input.expectedVersion,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    );
  }

  saveSnapshot(snapshot: SessionSnapshot, expectedVersion: number): Promise<Session> {
    return this.replaceSnapshot(snapshot, expectedVersion);
  }

  getPolicy(): Promise<DesktopSurfacePolicy> {
    return this.request("GET", "/v1/desktop/capabilities", parseDesktopSurfacePolicy);
  }

  async recoverInterruptedTurns(): Promise<void> {
    if (!this.replacesRuntimeId) return;
    const sessions = await this.listSessions();
    for (const session of sessions) {
      const snapshot = await this.getSnapshot(session.id);
      if (!snapshot.turns.some((turn) => isActive(turn.status))) continue;
      const recovered: SessionSnapshot = {
        ...snapshot,
        turns: snapshot.turns.map((turn) =>
          isActive(turn.status)
            ? {
                ...turn,
                status: "failed",
                error: {
                  code: ErrorCodes.RUNTIME_INTERRUPTED,
                  message: "Desktop Runtime restarted while the Turn was active",
                  retryable: true,
                },
                finishedAt: new Date().toISOString(),
              }
            : turn,
        ),
      };
      try {
        await this.replaceSnapshot(recovered, snapshot.session.version, this.replacesRuntimeId);
      } catch (error: unknown) {
        const normalized = BeecodeError.fromUnknown(error);
        if (normalized.code !== ErrorCodes.SESSION_VERSION_CONFLICT) throw normalized;
      }
    }
  }

  private replaceSnapshot(
    snapshot: SessionSnapshot,
    expectedVersion: number,
    replacesRuntimeId?: string,
  ): Promise<Session> {
    return this.request(
      "PUT",
      `/v1/desktop/sessions/${encodeURIComponent(snapshot.session.id)}/snapshot`,
      parseSession,
      {
        expectedVersion,
        runtimeId: this.runtimeId,
        ...(replacesRuntimeId ? { replacesRuntimeId } : {}),
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
          authorization: `Bearer ${this.tokens.require()}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error: unknown) {
      if (error instanceof BeecodeError) throw error;
      throw new BeecodeError(ErrorCodes.SYNC_FAILED, "Cannot reach the Beecode Backend", true);
    }
    if (!response.ok) throw await toBeecodeError(response);
    try {
      return parse(await response.json());
    } catch (error: unknown) {
      if (error instanceof BeecodeError) throw error;
      throw new BeecodeError(ErrorCodes.SYNC_FAILED, `Invalid Backend response for ${method} ${path}`, true);
    }
  }
}

function isActive(status: string): boolean {
  return status === "queued" || status === "running" || status === "model_streaming" || status === "tool_running";
}
