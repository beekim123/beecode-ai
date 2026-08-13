import {
  BeecodeError,
  ErrorCodes,
  type Message,
  type Page,
  type Session,
  type SessionSnapshot,
  type Turn,
} from "@beecode/protocol";

export interface AcceptedTurn {
  turn: Turn;
  isExisting: boolean;
}

export interface SessionRepository {
  create(accountId: string, title?: string): Promise<Session>;
  list(accountId: string, cursor?: string, limit?: number): Promise<Page<Session>>;
  getOwned(accountId: string, sessionId: string): Promise<SessionSnapshot | undefined>;
  updateSession(input: {
    accountId: string;
    sessionId: string;
    expectedVersion: number;
    title?: string;
    status?: Session["status"];
  }): Promise<Session>;
  acceptTurn(input: {
    accountId: string;
    sessionId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<AcceptedTurn>;
  saveTurnProjection(input: {
    accountId: string;
    sessionId: string;
    turn: Turn;
    messages: Message[];
  }): Promise<void>;
  recoverInterruptedTurns(): Promise<number>;
}

export const nonTerminalTurnStatuses: ReadonlySet<Turn["status"]> = new Set([
  "queued",
  "running",
  "model_streaming",
  "tool_running",
]);

export function requireOwnedWebSnapshot(
  snapshot: SessionSnapshot | undefined,
): SessionSnapshot {
  if (!snapshot) {
    throw new BeecodeError(ErrorCodes.SESSION_NOT_FOUND, "Web session not found");
  }
  return snapshot;
}
