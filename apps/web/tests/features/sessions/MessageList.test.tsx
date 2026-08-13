import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Message } from "@beecode/protocol";
import { MessageList } from "../../../src/features/sessions/MessageList.js";

const timestamp = "2026-08-10T00:00:00.000Z";

describe("MessageList", () => {
  it("separates user and assistant messages and exposes live backend activity", () => {
    const messages: Message[] = [
      {
        id: "pending_1",
        sessionId: "ses_1",
        role: "user",
        parts: [{ id: "part_user", type: "text", text: "Show this immediately" }],
        createdAt: timestamp,
      },
      {
        id: "msg_assistant",
        sessionId: "ses_1",
        role: "assistant",
        parts: [{ id: "part_assistant", type: "text", text: "Working on it" }],
        createdAt: timestamp,
      },
    ];

    render(
      <MessageList
        messages={messages}
        turns={[]}
        pendingMessageId="pending_1"
        activityStatus="running"
        onSelectTool={vi.fn()}
      />,
    );

    expect(screen.getByText("Show this immediately").closest("li")?.className).toContain("message-user");
    expect(screen.getByText("Show this immediately").closest("li")?.className).toContain("pending");
    expect(screen.getByText("Working on it").closest("li")?.className).toContain("message-assistant");
    expect(screen.getByText("发送中…")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Beecode 运行状态" }).textContent).toContain(
      "正在思考Beecode 正在规划下一步。",
    );
  });

  it("names the active backend tool in the running state", () => {
    render(
      <MessageList
        messages={[]}
        turns={[]}
        activityStatus="tool_running"
        activeToolName="calculator"
        onSelectTool={vi.fn()}
      />,
    );

    expect(screen.getByRole("status", { name: "Beecode 运行状态" }).textContent).toContain(
      "正在运行 calculator",
    );
  });

  it("renders assistant Markdown without executing raw HTML", () => {
    const messages: Message[] = [
      {
        id: "msg_markdown",
        sessionId: "ses_1",
        role: "assistant",
        parts: [{
          id: "part_markdown",
          type: "text",
          text: "## Markdown 标题\n\n这是 **重点内容**。\n\n- 第一项\n- 第二项\n\n```ts\nconst ready = true;\n```\n\n<script>alert('xss')</script>",
        }],
        createdAt: timestamp,
      },
    ];

    const view = render(
      <MessageList messages={messages} turns={[]} onSelectTool={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { name: "Markdown 标题" }).tagName).toBe("H2");
    expect(screen.getByText("重点内容").tagName).toBe("STRONG");
    expect(screen.getByText("第一项").closest("li")).toBeTruthy();
    expect(screen.getByText("const ready = true;").closest("pre")).toBeTruthy();
    expect(view.container.querySelector("script")).toBeNull();
  });
});
