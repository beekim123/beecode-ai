// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceControl } from "../../src/renderer/WorkspaceControl.js";

afterEach(cleanup);

describe("WorkspaceControl", () => {
  it("selects, replaces, and removes a Workspace through explicit commands", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onClear = vi.fn();
    const view = render(
      <WorkspaceControl
        workspace={null}
        disabled={false}
        busy={false}
        onSelect={onSelect}
        onClear={onClear}
      />,
    );

    await user.click(screen.getByRole("button", { name: "添加工作空间" }));
    expect(onSelect).toHaveBeenCalledOnce();

    view.rerender(
      <WorkspaceControl
        workspace={{ id: "workspace_1", name: "project", fileCount: 12 }}
        disabled={false}
        busy={false}
        onSelect={onSelect}
        onClear={onClear}
      />,
    );
    expect(screen.getByRole("status", { name: "当前工作空间" }).textContent).toContain("project");
    expect(screen.getByRole("status", { name: "当前工作空间" }).textContent).toContain("12 files");
    await user.click(screen.getByRole("button", { name: "更换工作空间" }));
    await user.click(screen.getByRole("button", { name: "移除工作空间" }));

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("disables Workspace changes while a Turn is active", () => {
    render(
      <WorkspaceControl
        workspace={{ id: "workspace_1", name: "project", fileCount: 1 }}
        disabled
        busy={false}
        onSelect={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect((screen.getByRole("button", { name: "更换工作空间" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "移除工作空间" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
