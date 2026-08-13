import {
  BrainCircuit,
  Calculator,
  Check,
  ChevronRight,
  Clock3,
  LoaderCircle,
  SendHorizontal,
  Sparkles,
  TriangleAlert,
  UserRound,
  Wrench,
} from "lucide-react";
import type { Message, ToolCall, Turn } from "@beecode/protocol";
import { localizedErrorMessage } from "../../lib/localization.js";
import { MarkdownContent } from "./MarkdownContent.js";

export type ConversationActivityStatus =
  | "submitting"
  | "queued"
  | "running"
  | "model_streaming"
  | "tool_running";

interface MessageListProps {
  messages: Message[];
  turns: Turn[];
  pendingMessageId?: string;
  activityStatus?: ConversationActivityStatus;
  activeToolName?: string;
  onSelectTool(toolCall: ToolCall): void;
}

export function MessageList({
  messages,
  turns,
  pendingMessageId,
  activityStatus,
  activeToolName,
  onSelectTool,
}: MessageListProps): React.JSX.Element {
  if (messages.length === 0 && !activityStatus) {
    return (
      <div className="empty-conversation">
        <div className="empty-glyph"><Calculator size={23} aria-hidden="true" /></div>
        <h2>给 Beecode 一个明确的任务</h2>
        <p>例如输入“计算 1+1”，体验一次完整的 Agent 工具调用流程。</p>
      </div>
    );
  }

  return (
    <ol className="message-list" aria-label="对话消息">
      {messages.map((message) => (
        <li
          className={`message message-${message.role}${message.id === pendingMessageId ? " pending" : ""}`}
          data-message-id={message.id}
          data-message-role={message.role}
          key={message.id}
        >
          <div className="message-author" aria-hidden="true">
            {message.role === "user" ? <UserRound size={15} /> : message.role === "assistant" ? "B" : <Calculator size={15} />}
          </div>
          <div className="message-content">
            <span className="message-label">
              {message.role === "user" ? "你" : message.role === "assistant" ? "Beecode" : "工具结果"}
              {message.id === pendingMessageId ? (
                <span className="message-pending-state">
                  <LoaderCircle size={11} aria-hidden="true" /> 发送中…
                </span>
              ) : null}
            </span>
            {message.parts.map((part) => {
              if (part.type === "text") {
                return message.role === "assistant"
                  ? <MarkdownContent key={part.id} text={part.text} />
                  : <p key={part.id} className="message-text">{part.text}</p>;
              }
              if (part.type === "tool_call") {
                return <ToolActivity key={part.id} toolCall={part.toolCall} onSelect={() => onSelectTool(part.toolCall)} />;
              }
              return (
                <pre className={`tool-result ${part.result.ok ? "success" : "failure"}`} key={part.id}>
                  {JSON.stringify(part.result.ok ? part.result.output : part.result.error, null, 2)}
                </pre>
              );
            })}
          </div>
        </li>
      ))}
      {activityStatus ? (
        <ConversationActivity status={activityStatus} toolName={activeToolName} />
      ) : null}
      {turns.map((turn) =>
        turn.status === "failed" || turn.status === "cancelled" ? (
          <li className={`turn-notice ${turn.status}`} key={`notice_${turn.id}`} role="status">
            <TriangleAlert size={16} aria-hidden="true" />
            <div><strong>{turn.status === "failed" ? turn.error?.code ?? "任务失败" : "任务已取消"}</strong><span>{turn.error ? localizedErrorMessage(turn.error) : "已保留确认过的输出。"}</span></div>
          </li>
        ) : null,
      )}
    </ol>
  );
}

function ConversationActivity({
  status,
  toolName,
}: {
  status: ConversationActivityStatus;
  toolName?: string;
}): React.JSX.Element {
  const content = activityContent(status, toolName);
  return (
    <li
      className={`agent-activity ${status}`}
      role="status"
      aria-label="Beecode 运行状态"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="agent-activity-icon" aria-hidden="true">{content.icon}</span>
      <span className="agent-activity-copy">
        <strong>{content.title}</strong>
        <small>{content.detail}</small>
      </span>
      <LoaderCircle className="agent-activity-spinner" size={16} aria-hidden="true" />
    </li>
  );
}

function activityContent(
  status: ConversationActivityStatus,
  toolName: string | undefined,
): { title: string; detail: string; icon: React.JSX.Element } {
  switch (status) {
    case "submitting":
      return {
        title: "正在发送消息",
        detail: "等待后端接收消息。",
        icon: <SendHorizontal size={16} />,
      };
    case "queued":
      return {
        title: "已进入队列",
        detail: "后端已接收消息，正在准备任务。",
        icon: <Clock3 size={16} />,
      };
    case "running":
      return {
        title: "正在思考",
        detail: "Beecode 正在规划下一步。",
        icon: <BrainCircuit size={16} />,
      };
    case "model_streaming":
      return {
        title: "正在生成回复",
        detail: "回复内容正在实时返回。",
        icon: <Sparkles size={16} />,
      };
    case "tool_running":
      return {
        title: toolName ? `正在运行 ${toolName}` : "正在运行后端工具",
        detail: "工具完成后，Beecode 会继续处理。",
        icon: <Wrench size={16} />,
      };
  }
}

function ToolActivity({ toolCall, onSelect }: { toolCall: ToolCall; onSelect(): void }): React.JSX.Element {
  const isPending = toolCall.status === "requested" || toolCall.status === "running";
  return (
    <button className="tool-activity" type="button" onClick={onSelect} aria-label={`查看 ${toolCall.name} 详情`}>
      <span className={`tool-status-dot ${toolCall.status}`} aria-hidden="true">
        {isPending ? <LoaderCircle size={15} /> : toolCall.status === "completed" ? <Check size={15} /> : <TriangleAlert size={15} />}
      </span>
      <span className="tool-activity-copy"><strong>{toolCall.name}</strong><small>{toolStatusLabel(toolCall.status)}</small></span>
      {toolCall.status === "completed" ? <code>{compactOutput(toolCall.output)}</code> : null}
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

function compactOutput(value: unknown): string {
  if (typeof value === "object" && value !== null && "value" in value) return String(value.value);
  const serialized = JSON.stringify(value);
  return serialized && serialized.length > 40 ? `${serialized.slice(0, 37)}…` : serialized ?? "完成";
}

function toolStatusLabel(status: ToolCall["status"]): string {
  switch (status) {
    case "requested": return "等待运行";
    case "running": return "正在后端运行";
    case "completed": return "已完成";
    case "failed": return "失败";
    case "rejected": return "已拒绝";
  }
}
