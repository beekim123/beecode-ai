import { randomUUID } from "node:crypto";
import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import {
  CreateSessionRequestSchema,
  ErrorCodes,
  ReplaceCliSessionRequestSchema,
  type Message,
  type Session,
  type SessionSnapshot,
  type Turn,
} from "@beecode/protocol";
import type { BackendAppServices, BackendEnv } from "../app-context.js";
import { invalidRequest, sendApiError } from "../middleware/error-handler.js";

const CLI_SURFACE = "cli";

export function createCliSessionRoutes(services: BackendAppServices): Hono<BackendEnv> {
  const routes = new Hono<BackendEnv>();

  routes.post("/v1/cli/sessions", async (context) => {
    const account = context.get("account");
    const input = await parseCreateSessionRequest(context.req.raw);
    const now = new Date().toISOString();
    const session: Session = {
      id: `ses_${randomUUID()}`,
      surface: CLI_SURFACE,
      accountId: account.accountId,
      title: input.title || "New CLI Session",
      status: "active",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    services.store.putSession({ session, messages: [], turns: [] });
    await services.store.flush();
    return context.json(session, 201);
  });

  routes.get("/v1/cli/sessions", (context) => {
    const account = context.get("account");
    const sessions = services.store
      .listSessions(account.accountId, CLI_SURFACE)
      .map((record) => record.session)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return context.json(sessions);
  });

  routes.get("/v1/cli/sessions/:sessionId", (context) => {
    const record = getOwnedCliSession(services, context.get("account").accountId, context.req.param("sessionId"));
    if (!record) {
      return sendApiError(context, 404, ErrorCodes.SESSION_NOT_FOUND, "CLI session not found");
    }
    const snapshot: SessionSnapshot = {
      session: record.session,
      messages: record.messages,
      turns: record.turns,
    };
    return context.json(snapshot);
  });

  routes.put(
    "/v1/cli/sessions/:sessionId",
    sValidator("json", ReplaceCliSessionRequestSchema, (result, context) => {
      if (!result.success) return invalidRequest(context, result.error[0]?.message ?? "Invalid request body");
    }),
    async (context) => {
      const account = context.get("account");
      const sessionId = context.req.param("sessionId");
      const record = getOwnedCliSession(services, account.accountId, sessionId);
      if (!record) {
        return sendApiError(context, 404, ErrorCodes.SESSION_NOT_FOUND, "CLI session not found");
      }

      const input = context.req.valid("json");
      const turns = input.turns ?? record.turns;
      validateSnapshotOwnership(sessionId, input.messages, turns);
      if (input.expectedVersion !== record.session.version) {
        return sendApiError(
          context,
          409,
          ErrorCodes.SESSION_VERSION_CONFLICT,
          `Session version conflict: expected ${input.expectedVersion}, current ${record.session.version}; reload the session`,
        );
      }

      const updated: Session = {
        ...record.session,
        surface: CLI_SURFACE,
        accountId: account.accountId,
        title: input.session?.title ?? record.session.title,
        version: record.session.version + 1,
        updatedAt: new Date().toISOString(),
      };
      services.store.putSession({ session: updated, messages: input.messages, turns });
      await services.store.flush();
      return context.json(updated);
    },
  );

  return routes;
}

async function parseCreateSessionRequest(request: Request): Promise<{ title?: string }> {
  const raw = await request.text();
  let value: unknown = {};
  if (raw.length > 0) {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new TypeError("Request body must contain valid JSON");
    }
  }
  const result = CreateSessionRequestSchema.safeParse(value);
  if (!result.success) {
    throw new TypeError(result.error.issues[0]?.message ?? "Invalid request body");
  }
  return result.data;
}

function getOwnedCliSession(services: BackendAppServices, accountId: string, sessionId: string) {
  const record = services.store.getSession(sessionId);
  if (!record || record.session.accountId !== accountId || record.session.surface !== CLI_SURFACE) {
    return undefined;
  }
  return record;
}

function validateSnapshotOwnership(sessionId: string, messages: Message[], turns: Turn[]): void {
  if (messages.some((message) => message.sessionId !== sessionId)) {
    throw new TypeError("Every message must belong to the requested session");
  }
  if (turns.some((turn) => turn.sessionId !== sessionId)) {
    throw new TypeError("Every turn must belong to the requested session");
  }
  const turnIds = new Set(turns.map((turn) => turn.id));
  if (messages.some((message) => message.turnId !== undefined && !turnIds.has(message.turnId))) {
    throw new TypeError("Message references a turn missing from the snapshot");
  }
}
