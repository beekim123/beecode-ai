import { describe, expect, it } from "vitest";
import {
  BrowserWorkspaceOperationResultSchema,
  BrowserWorkspaceToolRequestSchema,
  SubmitTurnRequestSchema,
  SubmitBrowserWorkspaceToolResultRequestSchema,
  SubmitWebTurnRequestSchema,
  ReplaceDesktopSessionSnapshotRequestSchema,
  parseDesktopSurfacePolicy,
  parseAgentEventEnvelope,
  parseCapabilitySet,
  parseModelRequest,
  parseModelStreamEvent,
  parseSession,
  parseSessionSnapshot,
  phase2OpenApiDocument,
  DESKTOP_IPC_PROTOCOL_VERSION,
  parseDesktopIpcFrame,
  parseDesktopIpcMethodResult,
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
    expect(phase2OpenApiDocument.paths["/v1/desktop/sessions"].get.operationId).toBe(
      "listDesktopSessions",
    );
    expect(phase2OpenApiDocument.paths["/v1/desktop/sessions"].get.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(
      phase2OpenApiDocument.paths["/v1/desktop/sessions/{sessionId}/snapshot"].put
        .operationId,
    ).toBe("replaceDesktopSessionSnapshot");
    expect(
      phase2OpenApiDocument.paths[
        "/v1/web/sessions/{sessionId}/turns/{turnId}/tool-calls/{toolCallId}/result"
      ].post.operationId,
    ).toBe("submitBrowserWorkspaceToolResult");
    expect(
      SubmitTurnRequestSchema.safeParse({ text: "计算 1+1", idempotencyKey: "request-0001" }).success,
    ).toBe(true);
  });

  it("validates Desktop policy and strict snapshot sync requests", () => {
    expect(
      parseDesktopSurfacePolicy({
        surface: "desktop",
        allowedTools: ["calculator"],
        allowedFeatures: {
          localWorkspace: false,
          shell: false,
          git: false,
          attachments: false,
        },
        limits: { maxTurnSteps: 8, maxInputBytes: 1024, maxSnapshotBytes: 4096 },
      }).surface,
    ).toBe("desktop");
    expect(
      ReplaceDesktopSessionSnapshotRequestSchema.safeParse({
        expectedVersion: 1,
        runtimeId: "runtime_1",
        messages: [],
        turns: [],
        surface: "web",
      }).success,
    ).toBe(false);
  });

  it("validates the Desktop IPC boundary and method results", () => {
    const request = parseDesktopIpcFrame({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "request",
      requestId: "request_1",
      method: "turn.cancel",
      payload: { sessionId: "session_1", turnId: "turn_1" },
    });
    expect(request.kind).toBe("request");
    expect(parseDesktopIpcMethodResult("turn.cancel", null)).toBeNull();
    const workspaceRequest = parseDesktopIpcFrame({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "request",
      requestId: "request_workspace",
      method: "workspace.configure",
      payload: { directoryPath: "/tmp/project" },
    });
    expect(workspaceRequest).toMatchObject({
      kind: "request",
      method: "workspace.configure",
    });
    expect(
      parseDesktopIpcMethodResult("workspace.get", {
        id: "workspace_1",
        name: "project",
        fileCount: 2,
      }),
    ).toEqual({ id: "workspace_1", name: "project", fileCount: 2 });

    expect(() =>
      parseDesktopIpcFrame({
        protocolVersion: 2,
        kind: "request",
        requestId: "request_2",
        method: "shell.execute",
        payload: { command: "echo unsafe" },
      }),
    ).toThrow(/Invalid Desktop IPC/);
    expect(() =>
      parseDesktopIpcFrame({
        protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        kind: "request",
        requestId: "request_3",
        method: "session.getSnapshot",
        payload: { sessionId: "session_1", token: "must-not-pass" },
      }),
    ).toThrow(/Invalid Desktop IPC/);
    expect(() =>
      parseDesktopIpcFrame({
        protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        kind: "request",
        requestId: "request_workspace_relative",
        method: "workspace.configure",
        payload: { directoryPath: "relative/project" },
      }),
    ).toThrow(/directoryPath must be absolute/);
    expect(() =>
      parseDesktopIpcMethodResult("workspace.get", {
        id: "workspace_1",
        name: "project",
        fileCount: 2,
        directoryPath: "/tmp/project",
      }),
    ).toThrow(/Invalid Desktop IPC/);
  });

  it("accepts only an opaque browser Workspace reference and validates delegated results", () => {
    expect(
      SubmitWebTurnRequestSchema.safeParse({
        text: "read the workspace",
        idempotencyKey: "request-workspace-0001",
        workspace: { id: "browser_workspace_1", name: "project" },
      }).success,
    ).toBe(true);
    expect(
      SubmitWebTurnRequestSchema.safeParse({
        text: "read the workspace",
        idempotencyKey: "request-workspace-0001",
        workspace: {
          id: "browser_workspace_1",
          name: "project",
          files: [{ path: "README.md", sizeBytes: 5, content: "hello" }],
        },
      }).success,
    ).toBe(false);
    expect(
      BrowserWorkspaceToolRequestSchema.safeParse({
        turnId: "turn_1",
        toolCallId: "tool_1",
        workspaceId: "browser_workspace_1",
        operation: { kind: "read", path: "../secret.txt" },
      }).success,
    ).toBe(false);
    expect(
      BrowserWorkspaceOperationResultSchema.safeParse({
        ok: true,
        output: { kind: "file", path: "README.md", sizeBytes: 5, content: "hello" },
      }).success,
    ).toBe(true);
    expect(
      BrowserWorkspaceOperationResultSchema.safeParse({
        ok: true,
        output: { kind: "file", path: "README.md", sizeBytes: 4, content: "hello" },
      }).success,
    ).toBe(false);
    expect(
      SubmitBrowserWorkspaceToolResultRequestSchema.safeParse({
        workspaceId: "browser_workspace_1",
        result: { ok: false, error: { code: "permission_denied" } },
      }).success,
    ).toBe(true);
    expect(
      SubmitBrowserWorkspaceToolResultRequestSchema.safeParse({
        workspaceId: "browser_workspace_1",
        result: { ok: false, error: { code: "server_error", message: "raw" } },
      }).success,
    ).toBe(false);
    expect(
      SubmitTurnRequestSchema.safeParse({
        text: "read the workspace",
        idempotencyKey: "request-ios-0001",
        workspace: { id: "browser_workspace_1", name: "project" },
      }).success,
    ).toBe(false);
  });
});
