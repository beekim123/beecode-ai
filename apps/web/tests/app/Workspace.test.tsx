import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BeecodeError, ErrorCodes } from "@beecode/protocol";

const apiMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getCapabilities: vi.fn(),
  getQuota: vi.fn(),
  listSessions: vi.fn(),
  logout: vi.fn(),
  updateSession: vi.fn(),
}));

vi.mock("../../src/lib/api.js", () => ({
  agentClient: {
    createSession: apiMocks.createSession,
    getCapabilities: apiMocks.getCapabilities,
    listSessions: apiMocks.listSessions,
    updateSession: apiMocks.updateSession,
  },
  webTransport: { getQuota: apiMocks.getQuota, logout: apiMocks.logout },
}));

import { Workspace } from "../../src/app/Workspace.js";

const timestamp = "2026-08-10T00:00:00.000Z";

describe("Workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listSessions.mockResolvedValue([]);
    apiMocks.getQuota.mockResolvedValue({
      accountId: "acct_test",
      quotaLimitTokens: 10_000,
      quotaUsedTokens: 0,
      quotaReservedTokens: 0,
    });
    apiMocks.getCapabilities.mockResolvedValue({
      surface: "web",
      runtimeLocation: "backend",
      tools: [
        { name: "calculator", description: "Calculate", available: true },
        { name: "read_file", description: "Read Workspace files", available: true },
      ],
      features: {
        localWorkspace: { available: true },
        shell: { available: false, reason: "surface_policy" },
        git: { available: false, reason: "surface_policy" },
        attachments: { available: false, reason: "surface_policy" },
      },
      limits: { maxTurnSteps: 8, maxInputBytes: 1_024 },
    });
    apiMocks.logout.mockResolvedValue(undefined);
    apiMocks.updateSession.mockResolvedValue(undefined);
  });

  it("renders a handled product error when session creation is rejected", async () => {
    apiMocks.createSession.mockRejectedValue(
      new BeecodeError(ErrorCodes.FORBIDDEN, "Request origin is not allowed"),
    );
    const user = userEvent.setup();
    render(
      <Workspace
        account={{ accountId: "acct_test", createdAt: timestamp }}
        pathname="/app"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "创建第一个会话" }));

    expect((await screen.findByRole("alert")).textContent).toContain(ErrorCodes.FORBIDDEN);
    expect(screen.getByRole("alert").textContent).toContain("当前操作没有权限");
  });

  it("renders a handled product error when logout is rejected", async () => {
    apiMocks.logout.mockRejectedValue(
      new BeecodeError(ErrorCodes.FORBIDDEN, "Request origin is not allowed"),
    );
    const user = userEvent.setup();
    render(
      <Workspace
        account={{ accountId: "acct_test", createdAt: timestamp }}
        pathname="/settings/account"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "退出登录" }));

    expect(apiMocks.logout).toHaveBeenCalledOnce();
    expect((await screen.findByRole("alert")).textContent).toContain(ErrorCodes.FORBIDDEN);
    expect(screen.getByRole("alert").textContent).toContain("当前操作没有权限");
  });

  it("explains archive versus delete and waits for confirmation", async () => {
    const session = {
      id: "ses_archive",
      accountId: "acct_test",
      surface: "web" as const,
      title: "Keep this history",
      status: "active" as const,
      version: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    apiMocks.listSessions.mockResolvedValue([session]);
    apiMocks.updateSession.mockResolvedValue({ ...session, status: "archived", version: 4 });
    const user = userEvent.setup();
    render(
      <Workspace
        account={{ accountId: "acct_test", createdAt: timestamp }}
        pathname="/app"
      />,
    );

    await user.click(await screen.findByRole("button", { name: "Keep this history的操作" }));
    await user.click(screen.getByRole("menuitem", { name: "归档会话" }));

    const dialog = screen.getByRole("dialog", { name: "归档“Keep this history”？" });
    expect(within(dialog).getByText(/归档不会删除对话/)).toBeTruthy();
    expect(apiMocks.updateSession).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "归档会话" }));
    expect(apiMocks.updateSession).toHaveBeenCalledWith({
      sessionId: "ses_archive",
      expectedVersion: 3,
      status: "archived",
    });
  });
});
