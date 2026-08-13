import { describe, expect, it } from "vitest";
import { BEECODE_CSRF_HEADER_VALUE } from "@beecode/protocol";
import {
  isAllowedBrowserWriteRequest,
  isAllowedRequestOrigin,
} from "../../src/middleware/origin.js";

describe("request origin policy", () => {
  it("accepts the configured origin and equivalent loopback aliases", () => {
    const base = {
      webOrigin: "http://localhost:5173",
      requestUrl: "http://127.0.0.1:8787/v1/web/sessions",
    };

    expect(isAllowedRequestOrigin({ ...base, origin: "http://localhost:5173" })).toBe(true);
    expect(isAllowedRequestOrigin({ ...base, origin: "http://127.0.0.1:5173" })).toBe(true);
    expect(isAllowedRequestOrigin({ ...base, origin: "http://[::1]:5173" })).toBe(true);
  });

  it("does not broaden the allowlist beyond matching loopback scheme and port", () => {
    const base = {
      webOrigin: "http://localhost:5173",
      requestUrl: "http://127.0.0.1:8787/v1/web/sessions",
    };

    expect(isAllowedRequestOrigin({ ...base, origin: "http://127.0.0.1:5174" })).toBe(false);
    expect(isAllowedRequestOrigin({ ...base, origin: "https://127.0.0.1:5173" })).toBe(false);
    expect(isAllowedRequestOrigin({ ...base, origin: "http://example.test:5173" })).toBe(false);
    expect(isAllowedRequestOrigin({ ...base, origin: "null" })).toBe(false);
  });

  it("allows same-origin API forms and requests without an Origin header", () => {
    const base = {
      webOrigin: "https://app.example.test",
      requestUrl: "https://api.example.test/oauth/authorize",
    };

    expect(isAllowedRequestOrigin({ ...base, origin: "https://api.example.test" })).toBe(true);
    expect(isAllowedRequestOrigin({ ...base, origin: undefined })).toBe(true);
    expect(isAllowedRequestOrigin({ ...base, origin: "https://other.example.test" })).toBe(false);
  });

  it("accepts the explicit CSRF header when a browser extension rewrites Origin", () => {
    const base = {
      origin: "chrome-extension://invalid",
      webOrigin: "http://127.0.0.1:5173",
      requestUrl: "http://127.0.0.1:8787/v1/web/sessions",
    };

    expect(isAllowedBrowserWriteRequest({ ...base, csrfHeader: undefined })).toBe(false);
    expect(isAllowedBrowserWriteRequest({ ...base, csrfHeader: "invalid" })).toBe(false);
    expect(
      isAllowedBrowserWriteRequest({ ...base, csrfHeader: BEECODE_CSRF_HEADER_VALUE }),
    ).toBe(true);
  });
});
