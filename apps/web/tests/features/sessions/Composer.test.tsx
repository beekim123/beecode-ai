import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Composer } from "../../../src/features/sessions/Composer.js";

describe("Composer", () => {
  it("renders Workspace context above the message input", () => {
    render(
      <Composer
        value=""
        isRunning={false}
        isConnected
        isSending={false}
        workspaceControl={<button type="button">选择工作空间</button>}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const workspaceControl = screen.getByRole("button", { name: "选择工作空间" });
    const messageInput = screen.getByRole("textbox", { name: "给 Beecode 发送消息" });
    expect(workspaceControl.compareDocumentPosition(messageInput) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0);
  });

  it("submits on Enter and keeps Shift+Enter for multiline input", async () => {
    const user = userEvent.setup();
    const submit = vi.fn();
    let value = "hello";
    const view = render(
      <Composer value={value} isRunning={false} isConnected={true} isSending={false} onChange={(next) => { value = next; }} onSubmit={submit} onCancel={vi.fn()} />,
    );
    const composer = screen.getByRole("textbox", { name: "给 Beecode 发送消息" });
    await user.click(composer);
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(submit).not.toHaveBeenCalled();
    view.rerender(
      <Composer value={value} isRunning={false} isConnected={true} isSending={false} onChange={(next) => { value = next; }} onSubmit={submit} onCancel={vi.fn()} />,
    );
    await user.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("shows Stop while a turn is active", async () => {
    const user = userEvent.setup();
    const cancel = vi.fn();
    render(<Composer value="" isRunning isConnected isSending={false} onChange={vi.fn()} onSubmit={vi.fn()} onCancel={cancel} />);
    await user.click(screen.getByRole("button", { name: "停止当前任务" }));
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("exposes a sending state while the backend is accepting the message", () => {
    render(<Composer value="" isRunning={false} isConnected isSending onChange={vi.fn()} onSubmit={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByRole("button", { name: "正在发送消息" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("发送中…")).toBeTruthy();
  });
});
