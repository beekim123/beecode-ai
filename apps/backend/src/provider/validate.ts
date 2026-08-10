import { BeecodeError, ErrorCodes } from "@beecode/protocol";

/** Provider 流的边界校验：供应商私有负载一律视为不可信输入。 */

export function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw providerProtocolError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw providerProtocolError(`${path} must be an array`);
  }
  return value;
}

export function requireString(value: unknown, path: string): string {
  if (typeof value !== "string") throw providerProtocolError(`${path} must be a string`);
  return value;
}

export function requireIndex(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw providerProtocolError(`${path} must be a non-negative integer`);
  }
  return value as number;
}

export function optionalTokenCount(value: unknown, path: string): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw providerProtocolError(`${path} must be a non-negative integer`);
  }
  return value as number;
}

export function providerProtocolError(reason: string): BeecodeError {
  return new BeecodeError(ErrorCodes.MODEL_STREAM_ERROR, `Invalid model provider stream: ${reason}`);
}
