import type { Context, Env } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { BeecodeError, ErrorCodes, type ErrorCode } from "@beecode/protocol";
import type { BackendEnv } from "../app-context.js";

export function sendApiError<TEnv extends Env>(
  context: Context<TEnv>,
  status: ContentfulStatusCode,
  code: ErrorCode,
  message: string,
  retryable = false,
): Response {
  return context.json(
    {
      error: { code, message, retryable },
      requestId: context.get("requestId"),
    },
    status,
  );
}

export function handleAppError(error: unknown, context: Context<BackendEnv>): Response {
  if (error instanceof TypeError || error instanceof SyntaxError) {
    return sendApiError(context, 400, ErrorCodes.INVALID_REQUEST, error.message);
  }
  if (error instanceof HTTPException && error.status >= 400 && error.status < 500) {
    return sendApiError(context, error.status, ErrorCodes.INVALID_REQUEST, error.message);
  }

  const beecode = BeecodeError.fromUnknown(error);
  const status = statusForError(beecode.code);
  const message = status === 500 ? "Internal backend error" : beecode.message;
  return sendApiError(context, status, beecode.code, message, beecode.retryable);
}

export function invalidRequest<TEnv extends Env>(context: Context<TEnv>, message: string): Response {
  return sendApiError(context, 400, ErrorCodes.INVALID_REQUEST, message);
}

function statusForError(code: ErrorCode): ContentfulStatusCode {
  switch (code) {
    case ErrorCodes.UNAUTHENTICATED:
    case ErrorCodes.TOKEN_EXPIRED:
    case ErrorCodes.TOKEN_REVOKED:
      return 401;
    case ErrorCodes.FORBIDDEN:
    case ErrorCodes.AUTHORIZATION_DENIED:
      return 403;
    case ErrorCodes.QUOTA_EXCEEDED:
      return 402;
    case ErrorCodes.SESSION_NOT_FOUND:
      return 404;
    case ErrorCodes.SESSION_VERSION_CONFLICT:
    case ErrorCodes.TURN_ALREADY_ACTIVE:
    case ErrorCodes.IDEMPOTENCY_CONFLICT:
      return 409;
    case ErrorCodes.MODEL_UNAVAILABLE:
    case ErrorCodes.MODEL_TIMEOUT:
    case ErrorCodes.MODEL_STREAM_ERROR:
    case ErrorCodes.RUNTIME_INTERRUPTED:
    case ErrorCodes.STREAM_DISCONNECTED:
    case ErrorCodes.SYNC_FAILED:
      return 503;
    case ErrorCodes.INVALID_REQUEST:
    case ErrorCodes.AUTHORIZATION_PENDING:
    case ErrorCodes.AUTHORIZATION_EXPIRED:
    case ErrorCodes.SURFACE_UNAVAILABLE:
    case ErrorCodes.TOOL_NOT_FOUND:
    case ErrorCodes.TOOL_INPUT_INVALID:
    case ErrorCodes.TOOL_EXECUTION_FAILED:
    case ErrorCodes.TURN_CANCELLED:
    case ErrorCodes.TURN_LIMIT_EXCEEDED:
      return 400;
    case ErrorCodes.INTERNAL:
      return 500;
  }
}
