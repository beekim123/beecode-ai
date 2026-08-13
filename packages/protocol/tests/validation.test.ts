import { describe, expect, it } from "vitest";
import {
  SubmitTurnRequestSchema,
  parseAgentEventEnvelope,
  parseCapabilitySet,
  parseModelRequest,
  parseModelStreamEvent,
  parseSession,
  parseSessionSnapshot,
  phase2OpenApiDocument,
} from "../src/index.js";

const now = "2026-08-06T00:00:00.000Z";

describe("protocol validation", () => {
  it("migrates legacy session snapshots without turns", () => {
    const snapshot = parseSessionSnapshot({
      session: {
        id: "ses_1",
        surface: "cli",
        accountId: "acct_1",
        title: "legacy",
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      messages: [
        {
          id: "msg_1",
          sessionId: "ses_1",
          turnId: "turn_missing_from_legacy_data",
          role: "user",
          parts: [{ id: "part_1", type: "text", text: "legacy" }],
          createdAt: now,
        },
      ],
    });

    expect(snapshot.turns).toEqual([]);
    expect(snapshot.messages[0]?.turnId).toBeUndefined();
  });

  it("rejects malformed model events before they enter Agent Core", () => {
    expect(() => parseModelStreamEvent({ type: "finish", reason: "unknown" })).toThrow(
      /modelEvent\.reason/,
    );
    expect(() => parseModelStreamEvent({ type: "usage", usage: { totalTokens: -1 } })).toThrow();
  });

  it("parses model request limits and rejects invalid messages", () => {
    expect(
      parseModelRequest({
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        maxOutputTokens: 128,
      }).maxOutputTokens,
    ).toBe(128);
    expect(() => parseModelRequest({ messages: [{ role: "root" }], tools: [] })).toThrow(
      /modelRequest\.messages\.0\.role/,
    );
  });

  it("accepts every product surface and rejects unknown surfaces", () => {
    for (const surface of ["cli", "web", "desktop", "android", "ios"] as const) {
      expect(
        parseSession({
          id: `ses_${surface}`,
          surface,
          accountId: "acct_1",
          title: surface,
          status: "active",
          version: 1,
          createdAt: now,
          updatedAt: now,
        }).surface,
      ).toBe(surface);
    }

    expect(() =>
      parseSession({
        id: "ses_unknown",
        surface: "watch",
        accountId: "acct_1",
        title: "unknown",
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
    ).toThrow(/surface/);
  });

  it("validates capability explanations and event envelope ownership", () => {
    expect(
      parseCapabilitySet({
        surface: "web",
        runtimeLocation: "backend",
        tools: [{ name: "calculator", description: "Calculate", available: true }],
        features: {
          localWorkspace: { available: false, reason: "surface_policy" },
          shell: { available: false, reason: "surface_policy" },
          git: { available: false, reason: "surface_policy" },
          attachments: { available: false, reason: "surface_policy" },
        },
        limits: { maxTurnSteps: 8, maxInputBytes: 1024 },
      }).runtimeLocation,
    ).toBe("backend");

    expect(() =>
      parseCapabilitySet({
        surface: "web",
        runtimeLocation: "backend",
        tools: [],
        features: {
          localWorkspace: { available: false },
          shell: { available: false, reason: "surface_policy" },
          git: { available: false, reason: "surface_policy" },
          attachments: { available: false, reason: "surface_policy" },
        },
        limits: { maxTurnSteps: 8, maxInputBytes: 1024 },
      }),
    ).toThrow(/require a reason/);

    expect(() =>
      parseAgentEventEnvelope({
        eventId: "evt_1",
        sessionId: "ses_1",
        turnId: "turn_1",
        sequence: 1,
        occurredAt: now,
        event: { type: "turn.cancelled", sessionId: "ses_other", turnId: "turn_1" },
      }),
    ).toThrow(/sessionId must match/);
  });

  it("publishes an OpenAPI 3.1 contract with unique stable operationIds", () => {
    const operationIds: string[] = [];
    for (const pathItem of Object.values(phase2OpenApiDocument.paths)) {
      for (const [method, operation] of Object.entries(pathItem)) {
        if (method === "parameters" || typeof operation !== "object" || operation === null) continue;
        if ("operationId" in operation && typeof operation.operationId === "string") {
          operationIds.push(operation.operationId);
        }
      }
    }

    expect(phase2OpenApiDocument.openapi).toBe("3.1.0");
    expect(operationIds.length).toBeGreaterThan(10);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(phase2OpenApiDocument.components.schemas.AgentEventEnvelope).toBeDefined();
    expect(JSON.stringify(phase2OpenApiDocument.components.schemas)).not.toContain("#/$defs/");
    expect(phase2OpenApiDocument.paths["/v1/ios/sessions"].get.operationId).toBe(
      "listIOSSessions",
    );
    expect(phase2OpenApiDocument.paths["/v1/ios/sessions"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(
      SubmitTurnRequestSchema.safeParse({ text: "计算 1+1", idempotencyKey: "request-0001" }).success,
    ).toBe(true);
  });
});
