import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@beecode/protocol";
import { SessionSidebar } from "../../src/components/SessionSidebar.js";

const session: Session = {
  id: "ses_1",
  accountId: "acct_test",
  surface: "web",
  title: "Conversation design",
  status: "active",
  version: 1,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

describe("SessionSidebar", () => {
  it("puts archive inside a clearly named session action menu", async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    render(
      <SessionSidebar
        account={{ accountId: "acct_test", createdAt: session.createdAt }}
        quota={{ accountId: "acct_test", quotaLimitTokens: 10_000, quotaUsedTokens: 0, quotaReservedTokens: 0 }}
        sessions={[session]}
        selectedSessionId={session.id}
        isOpen={false}
        isCollapsed={false}
        showArchived={false}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        onCollapse={vi.fn()}
        onArchive={onArchive}
        onToggleArchived={vi.fn()}
      />,
    );

    const actions = screen.getByRole("button", { name: "Conversation design的操作" });
    expect(actions.getAttribute("data-tooltip")).toBe("会话操作");
    expect(screen.queryByRole("menuitem", { name: "归档会话" })).toBeNull();

    await user.click(actions);
    await user.click(screen.getByRole("menuitem", { name: "归档会话" }));

    expect(onArchive).toHaveBeenCalledWith(session);
  });
});
