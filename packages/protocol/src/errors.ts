import type { BeecodeErrorShape } from "./domain.js";

/**
 * 稳定错误码。所有端共用；新增错误码优先复用既有语义。
 * 见设计文档第 12 节：所有错误都需要稳定错误码和可读消息。
 */
export const ErrorCodes = {
  // 认证与额度
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  // 模型链路
  MODEL_UNAVAILABLE: "MODEL_UNAVAILABLE",
  MODEL_TIMEOUT: "MODEL_TIMEOUT",
  MODEL_STREAM_ERROR: "MODEL_STREAM_ERROR",
  // 工具
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  TOOL_INPUT_INVALID: "TOOL_INPUT_INVALID",
  TOOL_EXECUTION_FAILED: "TOOL_EXECUTION_FAILED",
  // Turn / Session
  TURN_CANCELLED: "TURN_CANCELLED",
  TURN_LIMIT_EXCEEDED: "TURN_LIMIT_EXCEEDED",
  SESSION_NOT_FOUND: "SESSION_NOT_FOUND",
  SESSION_VERSION_CONFLICT: "SESSION_VERSION_CONFLICT",
  SYNC_FAILED: "SYNC_FAILED",
  // 通用
  INVALID_REQUEST: "INVALID_REQUEST",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class BeecodeError extends Error implements BeecodeErrorShape {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "BeecodeError";
    this.code = code;
    this.retryable = retryable;
  }

  toShape(): BeecodeErrorShape {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }

  static fromUnknown(err: unknown): BeecodeError {
    if (err instanceof BeecodeError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new BeecodeError(ErrorCodes.INTERNAL, message);
  }

  static fromShape(shape: BeecodeErrorShape, fallbackCode: ErrorCode = ErrorCodes.INTERNAL): BeecodeError {
    const code = isErrorCode(shape.code) ? shape.code : fallbackCode;
    return new BeecodeError(code, shape.message, shape.retryable);
  }

  static shape(err: unknown): BeecodeErrorShape {
    return BeecodeError.fromUnknown(err).toShape();
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.values(ErrorCodes).some((code) => code === value);
}
