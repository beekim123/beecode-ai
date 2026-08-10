import type { GatewayMessage, Message, Part } from "@beecode/protocol";

/** 持久化领域消息 → 模型上下文（Session 重启恢复历史时使用） */
export function toGatewayHistory(messages: Message[]): GatewayMessage[] {
  const toolNameByCallId = new Map<string, string>();
  const history: GatewayMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const content = textOf(message.parts);
      if (content) history.push({ role: "user", content });
      continue;
    }
    if (message.role === "assistant") {
      const toolCalls: { id: string; name: string; input: unknown }[] = [];
      for (const part of message.parts) {
        if (part.type === "tool_call") {
          toolCalls.push({ id: part.toolCall.id, name: part.toolCall.name, input: part.toolCall.input });
          toolNameByCallId.set(part.toolCall.id, part.toolCall.name);
        }
      }
      history.push({
        role: "assistant",
        content: textOf(message.parts),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
      continue;
    }
    // role === "tool"
    for (const part of message.parts) {
      if (part.type !== "tool_result") continue;
      const name = toolNameByCallId.get(part.toolCallId) ?? "unknown";
      const content = part.result.ok
        ? JSON.stringify(part.result.output ?? null)
        : JSON.stringify({ error: part.result.error });
      history.push({ role: "tool", toolCallId: part.toolCallId, name, content });
    }
  }
  return history;
}

function textOf(parts: Part[]): string {
  return parts
    .filter((p): p is Extract<Part, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("");
}
