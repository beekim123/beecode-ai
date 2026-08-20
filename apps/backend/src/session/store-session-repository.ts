import { createHash, randomUUID } from "node:crypto";
import {
  BeecodeError,
  ErrorCodes,
  type Message,
  type Page,
  type Session,
  type SessionSnapshot,
  type Surface,
  type Turn,
} from "@beecode/protocol";
import { newId } from "@beecode/agent-core";
import type { BackendStore, SessionRecord } from "../store.js";
import type { AcceptedTurn, SessionRepository } from "./session-repository.js";
import { nonTerminalTurnStatuses } from "./session-repository.js";

type BackendSessionSurface = Extract<Surface, "web" | "ios" | "desktop">;

export class StoreSessionRepository implements SessionRepository {
  constructor(
    private readonly store: BackendStore,
    private readonly surface: BackendSessionSurface = "web",
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(accountId: string, title?: string): Promise<Session> {
    const timestamp = this.now().toISOString();
    const session: Session = {
      id: `ses_${randomUUID()}`,
      accountId,
      surface: this.surface,
      title: title?.trim() || "新会话",
      status: "active",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.store.putSession({ session, messages: [], turns: [], idempotencyKeys: {} });
    await this.store.flush();
    return structuredClone(session);
  }

  list(accountId: string, cursor?: string, limit = 30): Promise<Page<Session>> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Session page limit must be between 1 and 100");
    }
    const records = [...this.store.listSessions(accountId, this.surface)].sort((left, right) =>
        right.session.updatedAt.localeCompare(left.session.updatedAt) ||
        right.session.id.localeCompare(left.session.id),
      );
    const start = cursor ? cursorStart(records, cursor) : 0;
    const selected = records.slice(start, start + limit);
    const last = selected.at(-1);
    const nextCursor = start + selected.length < records.length && last
      ? encodeCursor(last.session.id)
      : null;
    return Promise.resolve({
      items: selected.map((record) => structuredClone(record.session)),
      nextCursor,
    });
  }

  getOwned(accountId: string, sessionId: string): Promise<SessionSnapshot | undefined> {
    const record = this.getOwnedRecord(accountId, sessionId);
    if (!record) return Promise.resolve(undefined);
    return Promise.resolve(
      structuredClone({
        session: record.session,
        messages: record.messages,
        turns: record.turns,
      }),
    );
  }

  async updateSession(input: {
    accountId: string;
    sessionId: string;
    expectedVersion: number;
    title?: string;
    status?: Session["status"];
  }): Promise<Session> {
    const record = this.requireOwnedRecord(input.accountId, input.sessionId);
    if (record.session.version !== input.expectedVersion) {
      throw new BeecodeError(ErrorCodes.SESSION_VERSION_CONFLICT, "Session changed; reload before updating");
    }
    const title = input.title?.trim();
    if (title !== undefined && title.length === 0) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Session title must not be empty");
    }
    record.session = {
      ...record.session,
      ...(title !== undefined ? { title } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      version: record.session.version + 1,
      updatedAt: this.now().toISOString(),
    };
    this.store.putSession(record);
    await this.store.flush();
    return structuredClone(record.session);
  }

  async acceptTurn(input: {
    accountId: string;
    sessionId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<AcceptedTurn> {
    const record = this.requireOwnedRecord(input.accountId, input.sessionId);
    if (record.session.status === "archived") {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Archived sessions cannot accept new turns");
    }
    const textHash = createHash("sha256").update(input.text, "utf8").digest("base64url");
    const idempotency = record.idempotencyKeys?.[input.idempotencyKey];
    if (idempotency) {
      if (idempotency.textHash !== textHash) {
        throw new BeecodeError(
          ErrorCodes.IDEMPOTENCY_CONFLICT,
          "Idempotency key was already used for different content",
        );
      }
      const existing = record.turns.find((turn) => turn.id === idempotency.turnId);
      if (!existing) throw new BeecodeError(ErrorCodes.INTERNAL, "Idempotency record references a missing turn");
      return { turn: structuredClone(existing), isExisting: true };
    }
    if (record.turns.some((turn) => nonTerminalTurnStatuses.has(turn.status))) {
      throw new BeecodeError(ErrorCodes.TURN_ALREADY_ACTIVE, "Session already has an active turn");
    }

    const userMessageId = newId("msg");
    const turn: Turn = {
      id: newId("turn"),
      sessionId: input.sessionId,
      index: Math.max(0, ...record.turns.map((candidate) => candidate.index)) + 1,
      status: "queued",
      userMessageId,
    };
    const userMessage: Message = {
      id: userMessageId,
      sessionId: input.sessionId,
      turnId: turn.id,
      role: "user",
      parts: [{ id: newId("part"), type: "text", text: input.text }],
      createdAt: this.now().toISOString(),
    };
    record.messages.push(userMessage);
    record.turns.push(turn);
    record.idempotencyKeys ??= {};
    record.idempotencyKeys[input.idempotencyKey] = { turnId: turn.id, textHash };
    record.session = {
      ...record.session,
      version: record.session.version + 1,
      updatedAt: this.now().toISOString(),
    };
    this.store.putSession(record);
    await this.store.flush();
    return { turn: structuredClone(turn), isExisting: false };
  }

  async saveTurnProjection(input: {
    accountId: string;
    sessionId: string;
    turn: Turn;
    messages: Message[];
  }): Promise<void> {
    const record = this.requireOwnedRecord(input.accountId, input.sessionId);
    const turnIndex = record.turns.findIndex((turn) => turn.id === input.turn.id);
    if (turnIndex < 0) throw new BeecodeError(ErrorCodes.INTERNAL, "Turn disappeared while executing");
    record.turns[turnIndex] = structuredClone(input.turn);
    record.messages = [
      ...record.messages.filter(
        (message) => message.turnId !== input.turn.id || message.role === "user",
      ),
      ...structuredClone(input.messages),
    ];
    record.session = {
      ...record.session,
      version: record.session.version + 1,
      updatedAt: this.now().toISOString(),
    };
    this.store.putSession(record);
    await this.store.flush();
  }

  async replaceDesktopSnapshot(input: {
    accountId: string;
    sessionId: string;
    expectedVersion: number;
    runtimeId: string;
    replacesRuntimeId?: string;
    messages: Message[];
    turns: Turn[];
  }): Promise<Session> {
    if (this.surface !== "desktop") {
      throw new BeecodeError(ErrorCodes.SURFACE_UNAVAILABLE, "Snapshot replacement is Desktop-only");
    }
    const record = this.requireOwnedRecord(input.accountId, input.sessionId);
    if (record.session.version !== input.expectedVersion) {
      throw new BeecodeError(
        ErrorCodes.SESSION_VERSION_CONFLICT,
        "Session changed; reload before synchronizing",
      );
    }

    validateDesktopSnapshot(record, input);
    const activeTurn = input.turns.find((turn) => nonTerminalTurnStatuses.has(turn.status));
    record.messages = structuredClone(input.messages);
    record.turns = structuredClone(input.turns);
    record.activeRuntimeId = activeTurn ? input.runtimeId : undefined;
    record.session = {
      ...record.session,
      version: record.session.version + 1,
      updatedAt: this.now().toISOString(),
    };
    this.store.putSession(record);
    await this.store.flush();
    return structuredClone(record.session);
  }

  async recoverInterruptedTurns(): Promise<number> {
    let recovered = 0;
    const timestamp = this.now().toISOString();
    // Store has no unscoped list by design; recover accounts through every visible account session.
    const seenSessionIds = new Set<string>();
    for (const accountId of this.accountIds()) {
      for (const record of this.store.listSessions(accountId, this.surface)) {
        if (seenSessionIds.has(record.session.id)) continue;
        seenSessionIds.add(record.session.id);
        let changed = false;
        record.turns = record.turns.map((turn) => {
          if (!nonTerminalTurnStatuses.has(turn.status)) return turn;
          recovered += 1;
          changed = true;
          return {
            ...turn,
            status: "failed",
            error: {
              code: ErrorCodes.RUNTIME_INTERRUPTED,
              message: "Backend restarted while the turn was active",
              retryable: true,
            },
            finishedAt: timestamp,
          };
        });
        if (changed) {
          record.session = {
            ...record.session,
            version: record.session.version + 1,
            updatedAt: timestamp,
          };
          this.store.putSession(record);
        }
      }
    }
    if (recovered > 0) await this.store.flush();
    return recovered;
  }

  private accountIds(): string[] {
    return this.store.allAccountIds();
  }

  private getOwnedRecord(accountId: string, sessionId: string): SessionRecord | undefined {
    const record = this.store.getSession(sessionId);
    if (
      !record ||
      record.session.accountId !== accountId ||
      record.session.surface !== this.surface
    ) {
      return undefined;
    }
    return record;
  }

  private requireOwnedRecord(accountId: string, sessionId: string): SessionRecord {
    const record = this.getOwnedRecord(accountId, sessionId);
    if (!record) {
      throw new BeecodeError(
        ErrorCodes.SESSION_NOT_FOUND,
        `${surfaceLabel(this.surface)} session not found`,
      );
    }
    return record;
  }
}

function surfaceLabel(surface: BackendSessionSurface): string {
  if (surface === "ios") return "iOS";
  return surface === "desktop" ? "Desktop" : "Web";
}

function validateDesktopSnapshot(
  record: SessionRecord,
  input: {
    sessionId: string;
    runtimeId: string;
    replacesRuntimeId?: string;
    messages: Message[];
    turns: Turn[];
  },
): void {
  validateDesktopReferences(input.sessionId, input.messages, input.turns);
  if (input.messages.length < record.messages.length || input.turns.length < record.turns.length) {
    throw invalidSnapshot("Desktop snapshot history cannot be deleted");
  }
  for (let index = 0; index < record.messages.length; index += 1) {
    if (!isSameValue(record.messages[index], input.messages[index])) {
      throw invalidSnapshot("Existing Desktop messages are immutable");
    }
  }

  const existingActive = record.turns.find((turn) => nonTerminalTurnStatuses.has(turn.status));
  for (let index = 0; index < record.turns.length; index += 1) {
    const previous = record.turns[index];
    const next = input.turns[index];
    if (!previous || !next || previous.id !== next.id || previous.index !== next.index) {
      throw invalidSnapshot("Existing Desktop Turns cannot be removed or reordered");
    }
    if (!nonTerminalTurnStatuses.has(previous.status)) {
      if (!isSameValue(previous, next)) {
        throw invalidSnapshot("Terminal Desktop Turns are immutable");
      }
      continue;
    }
    validateActiveTurnOwner(record.activeRuntimeId, input, next);
  }

  const appended = input.turns.slice(record.turns.length);
  if (appended.length > 1) {
    throw invalidSnapshot("A Desktop snapshot can append at most one Turn");
  }
  const appendedTurn = appended[0];
  if (appendedTurn) {
    if (existingActive) {
      throw new BeecodeError(ErrorCodes.TURN_ALREADY_ACTIVE, "Session already has an active Turn");
    }
    const expectedIndex = Math.max(0, ...record.turns.map((turn) => turn.index)) + 1;
    if (appendedTurn.status !== "queued" || appendedTurn.index !== expectedIndex) {
      throw invalidSnapshot("A new Desktop Turn must start queued with the next index");
    }
  }

  if (input.turns.filter((turn) => nonTerminalTurnStatuses.has(turn.status)).length > 1) {
    throw new BeecodeError(ErrorCodes.TURN_ALREADY_ACTIVE, "Session has multiple active Turns");
  }
}

function validateDesktopReferences(sessionId: string, messages: Message[], turns: Turn[]): void {
  if (messages.some((message) => message.sessionId !== sessionId)) {
    throw invalidSnapshot("Every message must belong to the requested Desktop Session");
  }
  if (turns.some((turn) => turn.sessionId !== sessionId)) {
    throw invalidSnapshot("Every Turn must belong to the requested Desktop Session");
  }
  const turnIds = new Set(turns.map((turn) => turn.id));
  if (turnIds.size !== turns.length || new Set(turns.map((turn) => turn.index)).size !== turns.length) {
    throw invalidSnapshot("Desktop Turn ids and indexes must be unique");
  }
  if (messages.some((message) => message.turnId !== undefined && !turnIds.has(message.turnId))) {
    throw invalidSnapshot("Desktop message references a missing Turn");
  }
}

function validateActiveTurnOwner(
  activeRuntimeId: string | undefined,
  input: { runtimeId: string; replacesRuntimeId?: string },
  next: Turn,
): void {
  if (activeRuntimeId === input.runtimeId) return;
  const isInterruptedRecovery =
    activeRuntimeId !== undefined &&
    input.replacesRuntimeId === activeRuntimeId &&
    next.status === "failed" &&
    next.error?.code === ErrorCodes.RUNTIME_INTERRUPTED;
  if (!isInterruptedRecovery) {
    throw new BeecodeError(
      ErrorCodes.SESSION_VERSION_CONFLICT,
      "Desktop Turn is owned by another Runtime",
    );
  }
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalidSnapshot(message: string): BeecodeError {
  return new BeecodeError(ErrorCodes.INVALID_REQUEST, message);
}

function encodeCursor(sessionId: string): string {
  return Buffer.from(JSON.stringify({ sessionId }), "utf8").toString("base64url");
}

function cursorStart(records: SessionRecord[], cursor: string): number {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("sessionId" in value) ||
      typeof value.sessionId !== "string"
    ) {
      throw new TypeError("Invalid cursor");
    }
    const index = records.findIndex((record) => record.session.id === value.sessionId);
    if (index < 0) throw new TypeError("Cursor session no longer exists");
    return index + 1;
  } catch {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Session cursor is invalid or expired");
  }
}
