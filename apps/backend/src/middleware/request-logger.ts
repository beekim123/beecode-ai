import { createMiddleware } from "hono/factory";
import type { BackendEnv } from "../app-context.js";

export interface RequestLogRecord {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export type RequestLogSink = (record: RequestLogRecord) => void;

/** Logs an allowlisted record so credentials, cookies, prompts, and tool output never enter request logs. */
export function requestLogger(write: RequestLogSink) {
  return createMiddleware<BackendEnv>(async (context, next) => {
    const startedAt = performance.now();
    await next();
    try {
      write({
        requestId: context.get("requestId"),
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch {
      // Diagnostics must not alter the HTTP result.
    }
  });
}

