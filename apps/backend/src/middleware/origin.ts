import { createMiddleware } from "hono/factory";
import {
  BEECODE_CSRF_HEADER_NAME,
  BEECODE_CSRF_HEADER_VALUE,
  ErrorCodes,
} from "@beecode/protocol";
import type { BackendEnv } from "../app-context.js";
import { sendApiError } from "./error-handler.js";

export function requireAllowedOrigin(webOrigin: string) {
  return createMiddleware<BackendEnv>(async (context, next) => {
    const origin = context.req.header("origin");
    const csrfHeader = context.req.header(BEECODE_CSRF_HEADER_NAME);
    if (!isAllowedBrowserWriteRequest({ csrfHeader, origin, webOrigin, requestUrl: context.req.url })) {
      return sendApiError(context, 403, ErrorCodes.FORBIDDEN, "Request origin is not allowed");
    }
    await next();
  });
}

export function isAllowedBrowserWriteRequest(input: {
  csrfHeader: string | undefined;
  origin: string | undefined;
  webOrigin: string;
  requestUrl: string;
}): boolean {
  return (
    input.csrfHeader === BEECODE_CSRF_HEADER_VALUE ||
    isAllowedRequestOrigin(input)
  );
}

export function isAllowedRequestOrigin(input: {
  origin: string | undefined;
  webOrigin: string;
  requestUrl: string;
}): boolean {
  if (!input.origin) return true;
  const candidate = parseUrl(input.origin);
  const configured = parseUrl(input.webOrigin);
  const request = parseUrl(input.requestUrl);
  if (!candidate || !configured || !request) return false;
  if (candidate.origin === configured.origin || candidate.origin === request.origin) return true;

  // Browsers treat localhost, 127.0.0.1, and ::1 as different origins. During local
  // development they are equivalent only when scheme and effective port also match.
  return (
    candidate.protocol === configured.protocol &&
    candidate.port === configured.port &&
    isLoopbackHostname(candidate.hostname) &&
    isLoopbackHostname(configured.hostname)
  );
}

function parseUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
