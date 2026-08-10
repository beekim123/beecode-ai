import type { AgentEvent, Message, ToolCall } from "@beecode/protocol";

/**
 * CLI 展示层：只消费 Client SDK 的快照与事件，不修改 Session、不执行工具。
 * 输出写入注入的 sink，便于进程级测试断言。
 */
export class TerminalRenderer {
  private midText = false;

  constructor(private readonly write: (text: string) => void) {}

  renderEvent(event: AgentEvent): void {
    switch (event.type) {
      case "turn.started":
        this.write("\n");
        this.midText = false;
        return;
      case "message.delta":
        if (!this.midText) {
          this.write("Agent: ");
          this.midText = true;
        }
        this.write(event.textDelta);
        return;
      case "tool.requested":
        this.endText();
        this.write(`Tool: ${event.toolCall.name}(${formatInput(event.toolCall.input)})\n`);
        return;
      case "tool.started":
        return;
      case "tool.completed":
        this.endText();
        this.write(`Result: ${formatOutput(event.toolCall)}\n`);
        return;
      case "tool.failed":
        this.write(`Tool error: ${event.toolCall.error?.message ?? "unknown error"}\n`);
        return;
      case "turn.completed": {
        this.endText();
        const usage = event.usage ? ` · tokens: ${event.usage.totalTokens}` : "";
        this.write(`\n[done${usage}]\n`);
        return;
      }
      case "turn.failed":
        this.endText();
        this.write(`\n[failed: ${event.error.code}] ${event.error.message}\n`);
        return;
      case "turn.cancelled":
        this.endText();
        this.write("\n[cancelled]\n");
        return;
    }
  }

  /** 打开 Session 时渲染完整历史快照（不回放事件） */
  renderHistory(messages: Message[]): void {
    for (const message of messages) {
      if (message.role === "user") {
        this.write(`You: ${textOf(message)}\n\n`);
      } else if (message.role === "assistant") {
        for (const part of message.parts) {
          if (part.type === "text" && part.text) this.write(`Agent: ${part.text}\n`);
          if (part.type === "tool_call") {
            this.write(`Tool: ${part.toolCall.name}(${formatInput(part.toolCall.input)})\n`);
          }
        }
      } else {
        for (const part of message.parts) {
          if (part.type === "tool_result") {
            this.write(
              part.result.ok
                ? `Result: ${formatToolResultOutput(part.result.output)}\n`
                : `Tool error: ${part.result.error?.message ?? "unknown error"}\n`,
            );
          }
        }
      }
    }
    if (messages.length > 0) this.write("\n");
  }

  private endText(): void {
    if (this.midText) {
      this.write("\n");
      this.midText = false;
    }
  }
}

function textOf(message: Message): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("");
}

function formatInput(input: unknown): string {
  return JSON.stringify(input);
}

function formatOutput(toolCall: ToolCall): string {
  return formatToolResultOutput(toolCall.output);
}

function formatToolResultOutput(output: unknown): string {
  if (output && typeof output === "object" && "value" in output) {
    return String((output as { value: unknown }).value);
  }
  return JSON.stringify(output ?? null);
}
