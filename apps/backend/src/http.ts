import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  BeecodeError,
  ErrorCodes,
  parseMessages,
  parseModelRequest,
  parseTurns,
  type Message,
  type ModelRequest,
  type ModelStreamEvent,
  type Session,
  type SessionSnapshot,
  type Turn,
} from "@beecode/protocol";
import type { BackendStore } from "./store.js";
import type { ProviderAdapter } from "./provider/adapter.js";
import type { BackendConfig } from "./config.js";

/**
 * 最小 Beecode 后端（设计文档 3.2）：
 * 身份验证、surface=cli 数据边界、Session 持久化、额度校验与 Model Gateway。
 * 不运行 Agent Loop，不执行工具。
 */

const CLI_SURFACE = "cli";
const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const MAX_SESSION_TITLE_LENGTH = 200;

export function createBackendServer(
  store: BackendStore,
  provider: ProviderAdapter,
  config: Pick<BackendConfig, "quotaLimitTokens" | "devLoginSecret">,
): Server {
  const reservedTokensByAccount = new Map<string, number>();

  return createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      const beecode = BeecodeError.fromUnknown(error);
      if (beecode.code === ErrorCodes.INVALID_REQUEST) {
        sendError(res, 400, beecode.code, beecode.message);
        return;
      }
      if (error instanceof TypeError) {
        sendError(res, 400, ErrorCodes.INVALID_REQUEST, error.message);
        return;
      }
      sendError(res, 500, ErrorCodes.INTERNAL, "Internal backend error");
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const method = req.method ?? "GET";

    // ---- 开发登录：发放受控测试令牌（设计文档 11 节，开发阶段）----
    if (method === "POST" && path === "/v1/auth/dev-token") {
      if (config.devLoginSecret && req.headers["x-beecode-dev-secret"] !== config.devLoginSecret) {
        sendError(res, 403, ErrorCodes.FORBIDDEN, "Invalid development login secret");
        return;
      }
      await readJson(req);
      const account = store.createAccount(config.quotaLimitTokens);
      await store.flush();
      sendJson(res, 200, {
        token: account.token,
        accountId: account.accountId,
        quotaLimitTokens: account.quotaLimitTokens,
      });
      return;
    }

    // ---- 以下路由全部需要 Beecode 身份 ----
    const account = authenticate(req);
    if (!account) {
      sendError(res, 401, ErrorCodes.UNAUTHENTICATED, "Missing or invalid Beecode token; run `beecode login`");
      return;
    }

    if (method === "GET" && path === "/v1/quota") {
      sendJson(res, 200, {
        accountId: account.accountId,
        quotaLimitTokens: account.quotaLimitTokens,
        quotaUsedTokens: account.quotaUsedTokens,
      });
      return;
    }

    if (method === "POST" && path === "/v1/cli/sessions") {
      const body = expectRecord(await readJson(req), "request body");
      const title = optionalTitle(body.title);
      const now = new Date().toISOString();
      const session: Session = {
        id: `ses_${randomUUID()}`,
        surface: CLI_SURFACE, // 固定 surface，客户端不可覆盖
        accountId: account.accountId,
        title: title || "New CLI Session",
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      store.putSession({ session, messages: [], turns: [] });
      await store.flush();
      sendJson(res, 201, session);
      return;
    }

    if (method === "GET" && path === "/v1/cli/sessions") {
      const sessions = store
        .listSessions(account.accountId, CLI_SURFACE)
        .map((r) => r.session)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      sendJson(res, 200, sessions);
      return;
    }

    const sessionMatch = path.match(/^\/v1\/cli\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]!);
      const record = store.getSession(sessionId);
      if (!record || record.session.accountId !== account.accountId || record.session.surface !== CLI_SURFACE) {
        // 其他 surface / 其他账号：统一按不存在处理，不泄漏存在性
        sendError(res, 404, ErrorCodes.SESSION_NOT_FOUND, "CLI session not found");
        return;
      }

      if (method === "GET") {
        const snapshot: SessionSnapshot = {
          session: record.session,
          messages: record.messages,
          turns: record.turns,
        };
        sendJson(res, 200, snapshot);
        return;
      }

      if (method === "PUT") {
        const body = expectRecord(await readJson(req), "request body");
        const expectedVersion = positiveInteger(body.expectedVersion, "expectedVersion");
        const messages = parseMessages(body.messages);
        const turns = body.turns === undefined ? record.turns : parseTurns(body.turns);
        validateSnapshotOwnership(sessionId, messages, turns);
        if (expectedVersion !== record.session.version) {
          // 并发写入：拒绝覆盖，不自动合并（设计文档 10.2）
          sendError(
            res,
            409,
            ErrorCodes.SESSION_VERSION_CONFLICT,
            `Session version conflict: expected ${expectedVersion}, current ${record.session.version}; reload the session`,
          );
          return;
        }
        const now = new Date().toISOString();
        const sessionInput = body.session === undefined ? undefined : expectRecord(body.session, "session");
        const title = sessionInput ? optionalTitle(sessionInput.title) : undefined;
        const updated: Session = {
          ...record.session,
          // surface/accountId 不允许客户端覆盖
          surface: CLI_SURFACE,
          accountId: account.accountId,
          title: title ?? record.session.title,
          version: record.session.version + 1,
          updatedAt: now,
        };
        store.putSession({ session: updated, messages, turns });
        await store.flush();
        sendJson(res, 200, updated);
        return;
      }
    }

    // ---- Model Gateway：标准化模型流（SSE）----
    if (method === "POST" && path === "/v1/model/stream") {
      const request = parseModelRequest(await readJson(req));
      const reservation = estimateTokenReservation(request);
      const alreadyReserved = reservedTokensByAccount.get(account.accountId) ?? 0;
      if (account.quotaUsedTokens + alreadyReserved + reservation > account.quotaLimitTokens) {
        sendError(res, 402, ErrorCodes.QUOTA_EXCEEDED, "Beecode model quota exceeded for this account");
        return;
      }
      reservedTokensByAccount.set(account.accountId, alreadyReserved + reservation);

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      const abort = new AbortController();
      res.on("close", () => abort.abort());
      let chargedTokens = 0;
      try {
        for await (const event of provider.stream(request, abort.signal)) {
          if (event.type === "usage") {
            const additionalTokens = Math.max(0, event.usage.totalTokens - chargedTokens);
            store.addUsage(account.accountId, additionalTokens);
            chargedTokens = event.usage.totalTokens;
          }
          writeSse(res, event);
          if (event.type === "finish" || event.type === "error") break;
        }
      } catch (err) {
        const error: ModelStreamEvent = {
          type: "error",
          error: {
            code: ErrorCodes.MODEL_STREAM_ERROR,
            message: "Model provider stream failed",
            retryable: true,
          },
        };
        writeSse(res, error);
      } finally {
        const currentReservation = reservedTokensByAccount.get(account.accountId) ?? reservation;
        const remainingReservation = Math.max(0, currentReservation - reservation);
        if (remainingReservation === 0) reservedTokensByAccount.delete(account.accountId);
        else reservedTokensByAccount.set(account.accountId, remainingReservation);
        await store.flush();
        res.end();
      }
      return;
    }

    sendError(res, 404, ErrorCodes.INVALID_REQUEST, `Unknown route: ${method} ${path}`);
  }

  function authenticate(req: IncomingMessage) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return undefined;
    return store.findAccountByToken(header.slice("Bearer ".length));
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let sizeBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.byteLength;
    if (sizeBytes > MAX_REQUEST_BODY_BYTES) {
      throw new BeecodeError(ErrorCodes.INVALID_REQUEST, `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Request body must contain valid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, status: number, code: string, message: string, retryable = false): void {
  sendJson(res, status, { error: { code, message, retryable } });
}

function writeSse(res: ServerResponse, event: ModelStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, `${name} must be a positive integer`);
  }
  return value as number;
}

function optionalTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Session title must be a string");
  }
  const title = value.trim();
  if (title.length > MAX_SESSION_TITLE_LENGTH) {
    throw new BeecodeError(
      ErrorCodes.INVALID_REQUEST,
      `Session title exceeds ${MAX_SESSION_TITLE_LENGTH} characters`,
    );
  }
  return title;
}

function validateSnapshotOwnership(sessionId: string, messages: Message[], turns: Turn[]): void {
  if (messages.some((message) => message.sessionId !== sessionId)) {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Every message must belong to the requested session");
  }
  if (turns.some((turn) => turn.sessionId !== sessionId)) {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Every turn must belong to the requested session");
  }
  const turnIds = new Set(turns.map((turn) => turn.id));
  if (messages.some((message) => message.turnId !== undefined && !turnIds.has(message.turnId))) {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Message references a turn missing from the snapshot");
  }
}

function estimateTokenReservation(request: ModelRequest): number {
  const inputBytes = Buffer.byteLength(
    JSON.stringify({ messages: request.messages, systemPrompt: request.systemPrompt, tools: request.tools }),
    "utf8",
  );
  return inputBytes + (request.maxOutputTokens ?? 4096);
}
