import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspacePicker } from "../../../src/features/workspaces/WorkspacePicker.js";

afterEach(() => {
  Reflect.deleteProperty(window, "showDirectoryPicker");
});

describe("WorkspacePicker", () => {
  it("selects a directory handle without uploading its files, then removes it", async () => {
    const directory = {
      kind: "directory" as const,
      name: "project",
      values: vi.fn(() => (async function* () {})()),
      getDirectoryHandle: vi.fn(),
      getFileHandle: vi.fn(),
    };
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: vi.fn().mockResolvedValue(directory),
    });
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(<WorkspacePicker onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "添加工作空间" }));
    expect(onChange).toHaveBeenCalledWith({
      reference: { id: expect.stringMatching(/^browser_workspace_/), name: "project" },
      directory,
    });
    expect(directory.values).not.toHaveBeenCalled();

    view.rerender(<WorkspacePicker workspace={onChange.mock.calls[0]?.[0]} onChange={onChange} />);
    expect(screen.getByRole("status", { name: "当前工作空间" }).textContent).toContain("project");
    await user.click(screen.getByRole("button", { name: "移除工作空间" }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it("disables local Workspace selection when the browser API is unavailable", () => {
    render(<WorkspacePicker onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "添加工作空间" }).hasAttribute("disabled")).toBe(true);
  });
});
