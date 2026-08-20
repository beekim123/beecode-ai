import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "@beecode/protocol";
import type { RecoveryHandlers } from "@beecode/client-sdk";
import type { BrowserWorkspace } from "../../../src/features/workspaces/browser-workspace.js";

const apiMocks = vi.hoisted(() => ({
  subscribeWithRecovery: vi.fn(),
  submitBrowserWorkspaceToolResult: vi.fn(),
}));

vi.mock("../../../src/lib/api.js", () => ({
  agentClient: {
    cancelTurn: vi.fn(),
    submitMessage: vi.fn(),
    updateSession: vi.fn(),
  },
  webTransport: {
    getSessionSnapshot: vi.fn(),
    subscribeWithRecovery: apiMocks.subscribeWithRecovery,
    submitBrowserWorkspaceToolResult: apiMocks.submitBrowserWorkspaceToolResult,
  },
}));

import { SessionView } from "../../../src/features/sessions/SessionView.js";

const timestamp = "2026-08-19T00:00:00.000Z";

describe("SessionView browser Workspace delegation", () => {
  it("answers a recovered read_file request from the selected directory handle", async () => {
    apiMocks.submitBrowserWorkspaceToolResult.mockResolvedValue(undefined);
    apiMocks.subscribeWithRecovery.mockImplementation((_sessionId: string, handlers: RecoveryHandlers) => {
      handlers.onSnapshot(snapshot());
      handlers.onConnectionState?.("connected");
      return vi.fn();
    });
    const bytes = new TextEncoder().encode("hello");
    const workspace = {
      reference: { id: "browser_workspace_1", name: "project" },
      directory: {
        kind: "directory",
        name: "project",
        values: vi.fn(() => (async function* () {})()),
        getDirectoryHandle: vi.fn(),
        getFileHandle: vi.fn().mockResolvedValue({
          kind: "file",
          name: "README.md",
          getFile: vi.fn().mockResolvedValue({
            size: bytes.byteLength,
            arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0)),
          }),
        }),
      },
    } as unknown as BrowserWorkspace;

    render(
      <SessionView
        sessionId="ses_1"
        workspace={workspace}
        onWorkspaceChange={vi.fn()}
        onMenu={vi.fn()}
        onSessionChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(apiMocks.submitBrowserWorkspaceToolResult).toHaveBeenCalledWith(
      "ses_1",
      {
        turnId: "turn_1",
        toolCallId: "tool_1",
        workspaceId: "browser_workspace_1",
        operation: { kind: "read", path: "README.md" },
      },
      {
        ok: true,
        output: { kind: "file", path: "README.md", sizeBytes: 5, content: "hello" },
      },
    ));
  });
});

function snapshot(): SessionSnapshot {
  return {
    session: {
      id: "ses_1",
      surface: "web",
      accountId: "acct_1",
      title: "Workspace",
      status: "active",
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    messages: [],
    turns: [{
      id: "turn_1",
      sessionId: "ses_1",
      index: 1,
      status: "tool_running",
      userMessageId: "msg_1",
    }],
    live: {
      sequence: 3,
      activeTurnId: "turn_1",
      browserWorkspaceRequests: [{
        turnId: "turn_1",
        toolCallId: "tool_1",
        workspaceId: "browser_workspace_1",
        operation: { kind: "read", path: "README.md" },
      }],
    },
  };
}
