import { ArrowDown, Menu, PanelRightClose, PanelRightOpen, Pencil, RotateCw, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BeecodeError, ErrorCodes, type SessionSnapshot, type ToolCall, type Turn } from "@beecode/protocol";
import type { ConnectionState } from "@beecode/client-sdk";
import { agentClient, webTransport } from "../../lib/api.js";
import { localizedErrorMessage, localizedSessionTitle } from "../../lib/localization.js";
import { navigate } from "../../lib/navigation.js";
import { Composer } from "./Composer.js";
import { MessageList, type ConversationActivityStatus } from "./MessageList.js";
import {
  appendOptimisticUserMessage,
  applyAgentEnvelope,
  discardOptimisticUserMessage,
  reconcileAcceptedTurn,
  type OptimisticUserMessageInput,
} from "./session-reducer.js";

interface SessionViewProps {
  sessionId: string;
  onMenu(): void;
  onSessionChanged(): void;
}

interface PendingSubmission extends OptimisticUserMessageInput {
  idempotencyKey: string;
}

export function SessionView({ sessionId, onMenu, onSessionChanged }: SessionViewProps): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>();
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<BeecodeError>();
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectedTool, setSelectedTool] = useState<ToolCall>();
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [pendingMessageId, setPendingMessageId] = useState<string>();
  const [hasNewActivity, setHasNewActivity] = useState(false);
  const pendingSubmission = useRef<PendingSubmission | undefined>(undefined);
  const submissionInFlight = useRef(false);
  const conversationScroll = useRef<HTMLDivElement>(null);
  const shouldFollowConversation = useRef(true);
  const forceFollowConversation = useRef(false);

  const loadSnapshot = useCallback(async () => {
    try {
      const next = await webTransport.getSessionSnapshot(sessionId);
      setSnapshot(restorePendingSubmission(next, pendingSubmission.current));
      setError(undefined);
    } catch (caught: unknown) {
      const beecode = BeecodeError.fromUnknown(caught);
      setError(beecode);
      if (beecode.code === ErrorCodes.SESSION_NOT_FOUND) navigate("/app");
    }
  }, [sessionId]);

  useEffect(() => {
    setSnapshot(undefined);
    setSelectedTool(undefined);
    setError(undefined);
    setPendingMessageId(undefined);
    setHasNewActivity(false);
    pendingSubmission.current = undefined;
    submissionInFlight.current = false;
    shouldFollowConversation.current = true;
    return webTransport.subscribeWithRecovery(sessionId, {
      onSnapshot: (next) => {
        setSnapshot(restorePendingSubmission(next, pendingSubmission.current));
        setTitleDraft(localizedSessionTitle(next.session.title));
      },
      onEvent: (envelope) => {
        setSnapshot((current) => current ? applyAgentEnvelope(current, envelope) : current);
        const type = envelope.event.type;
        if (type === "turn.completed" || type === "turn.failed" || type === "turn.cancelled") {
          void webTransport.getSessionSnapshot(sessionId)
            .then((next) => setSnapshot(restorePendingSubmission(next, pendingSubmission.current)))
            .catch(() => undefined);
          onSessionChanged();
        }
      },
      onConnectionState: setConnection,
      onError: setError,
    });
  }, [onSessionChanged, sessionId]);

  const activeTurn = useMemo(
    () => snapshot?.turns.find((turn) => activeStatus(turn.status) !== undefined),
    [snapshot?.turns],
  );
  const activityStatus = activeTurn ? activeStatus(activeTurn.status) : isSending ? "submitting" : undefined;
  const activeToolName = useMemo(
    () => activityStatus === "tool_running" && snapshot ? findActiveToolName(snapshot) : undefined,
    [activityStatus, snapshot],
  );
  const latestTool = useMemo(() => snapshot ? firstTool(snapshot) : undefined, [snapshot]);

  useEffect(() => {
    const element = conversationScroll.current;
    if (!element) return;
    const shouldScroll = forceFollowConversation.current || shouldFollowConversation.current;
    forceFollowConversation.current = false;
    if (!shouldScroll) {
      setHasNewActivity(true);
      return;
    }
    const frame = requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
      setHasNewActivity(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [activityStatus, snapshot?.messages]);

  async function submit(): Promise<void> {
    const text = draft.trim();
    if (!text || activeTurn || connection !== "connected" || submissionInFlight.current) return;
    const idempotencyKey = crypto.randomUUID();
    const optimisticMessageId = `pending_${idempotencyKey}`;
    const submission: PendingSubmission = {
      id: optimisticMessageId,
      idempotencyKey,
      sessionId,
      text,
      createdAt: new Date().toISOString(),
    };
    submissionInFlight.current = true;
    pendingSubmission.current = submission;
    forceFollowConversation.current = true;
    shouldFollowConversation.current = true;
    setPendingMessageId(optimisticMessageId);
    setSnapshot((current) => current ? appendOptimisticUserMessage(current, submission) : current);
    setDraft("");
    setIsSending(true);
    setError(undefined);
    try {
      const { turn } = await agentClient.submitMessage(sessionId, text, idempotencyKey);
      pendingSubmission.current = undefined;
      setSnapshot((current) => current
        ? reconcileAcceptedTurn(current, turn, optimisticMessageId, text)
        : current);
      setPendingMessageId(undefined);
      onSessionChanged();
    } catch (caught: unknown) {
      pendingSubmission.current = undefined;
      setSnapshot((current) => current
        ? discardOptimisticUserMessage(current, optimisticMessageId)
        : current);
      setPendingMessageId(undefined);
      setDraft(text);
      setError(BeecodeError.fromUnknown(caught));
    } finally {
      submissionInFlight.current = false;
      setIsSending(false);
    }
  }

  function handleConversationScroll(): void {
    const element = conversationScroll.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const isNearBottom = distanceFromBottom < 80;
    shouldFollowConversation.current = isNearBottom;
    if (isNearBottom) setHasNewActivity(false);
  }

  function scrollToLatest(): void {
    const element = conversationScroll.current;
    if (!element) return;
    shouldFollowConversation.current = true;
    setHasNewActivity(false);
    element.scrollTo({
      top: element.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  async function cancel(): Promise<void> {
    if (!activeTurn) return;
    try {
      await agentClient.cancelTurn(sessionId, activeTurn.id);
    } catch (caught: unknown) {
      setError(BeecodeError.fromUnknown(caught));
    }
  }

  async function saveTitle(): Promise<void> {
    if (!snapshot || titleDraft.trim() === snapshot.session.title) {
      setIsRenaming(false);
      return;
    }
    try {
      const session = await agentClient.updateSession({
        sessionId,
        expectedVersion: snapshot.session.version,
        title: titleDraft.trim(),
      });
      setSnapshot((current) => current ? { ...current, session } : current);
      setIsRenaming(false);
      onSessionChanged();
    } catch (caught: unknown) {
      const beecode = BeecodeError.fromUnknown(caught);
      setError(beecode);
      if (beecode.code === ErrorCodes.SESSION_VERSION_CONFLICT) await loadSnapshot();
    }
  }

  if (!snapshot) {
    return (
      <main className="conversation-main">
        <HeaderSkeleton onMenu={onMenu} />
        <div className="conversation-notices" />
        <div className="conversation-scroll skeleton-stack" aria-label="正在加载会话">
          <span /><span /><span />
        </div>
      </main>
    );
  }

  return (
    <>
      <main className="conversation-main">
        <header className="conversation-header">
          <button className="icon-button mobile-only" type="button" onClick={onMenu} aria-label="打开会话侧栏"><Menu size={19} /></button>
          <div className="conversation-title">
            {isRenaming ? (
              <input
                aria-label="会话标题"
                autoFocus
                value={titleDraft}
                maxLength={200}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={() => void saveTitle()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveTitle();
                  if (event.key === "Escape") setIsRenaming(false);
                }}
              />
            ) : (
              <button type="button" onClick={() => setIsRenaming(true)}>
                <h1>{localizedSessionTitle(snapshot.session.title)}</h1><Pencil size={13} aria-hidden="true" />
              </button>
            )}
            <span className={activityStatus ? "conversation-state active" : "conversation-state"}>
              {activityStatus ? <span className="conversation-state-dot" aria-hidden="true" /> : null}
              {turnLabel(activityStatus)}
            </span>
          </div>
          <div className="header-actions">
            {selectedTool || latestTool ? (
              <button
                className="icon-button tooltip-button"
                type="button"
                data-tooltip={selectedTool ? "关闭工具详情" : "打开工具详情"}
                onClick={() => setSelectedTool(selectedTool ? undefined : latestTool)}
                aria-label={selectedTool ? "关闭工具详情" : "打开工具详情"}
              >
                {selectedTool ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
            ) : null}
          </div>
        </header>

        <div className="conversation-notices">
          {connection !== "connected" ? (
            <div className={`connection-notice ${connection}`} role="status">
              <WifiOff size={15} aria-hidden="true" />
              <span>{connection === "unauthenticated" ? "登录状态已失效，请重新登录。" : "正在重新连接运行环境，暂时无法发送消息。"}</span>
            </div>
          ) : null}
          {error ? (
            <div className="error-notice" role="alert">
              <div><strong>{error.code}</strong><span>{localizedErrorMessage(error)}</span></div>
              <button type="button" onClick={() => { setError(undefined); void loadSnapshot(); }}><RotateCw size={15} /> 重试</button>
            </div>
          ) : null}
        </div>

        <div className="conversation-scroll-shell">
          <div className="conversation-scroll" ref={conversationScroll} onScroll={handleConversationScroll}>
            <MessageList
              messages={snapshot.messages}
              turns={snapshot.turns}
              pendingMessageId={pendingMessageId}
              activityStatus={activityStatus}
              activeToolName={activeToolName}
              onSelectTool={setSelectedTool}
            />
          </div>
          {hasNewActivity ? (
            <button className="jump-latest-button" type="button" onClick={scrollToLatest}>
              <ArrowDown size={14} aria-hidden="true" /> 查看最新消息
            </button>
          ) : null}
        </div>
        <Composer
          value={draft}
          isRunning={Boolean(activeTurn)}
          isConnected={connection === "connected"}
          isSending={isSending}
          onChange={setDraft}
          onSubmit={() => void submit()}
          onCancel={() => void cancel()}
        />
      </main>
      {selectedTool ? <ToolDetailPanel tool={selectedTool} onClose={() => setSelectedTool(undefined)} /> : null}
    </>
  );
}

function HeaderSkeleton({ onMenu }: { onMenu(): void }): React.JSX.Element {
  return <header className="conversation-header"><button className="icon-button mobile-only" onClick={onMenu} type="button" aria-label="打开会话侧栏"><Menu size={19} /></button><div className="title-skeleton" /></header>;
}

function ToolDetailPanel({ tool, onClose }: { tool: ToolCall; onClose(): void }): React.JSX.Element {
  return (
    <aside className="detail-panel" aria-label={`${tool.name} 详情`}>
      <header><div><span className="eyebrow">工具详情</span><h2>{tool.name}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭工具详情"><X size={18} /></button></header>
      <section><h3>状态</h3><span className={`status-chip ${tool.status}`}>{toolStatusLabel(tool.status)}</span></section>
      <section><h3>输入</h3><pre>{JSON.stringify(tool.input, null, 2)}</pre></section>
      <section><h3>{tool.error ? "错误" : "输出"}</h3><pre>{JSON.stringify(tool.error ?? tool.output ?? null, null, 2)}</pre></section>
    </aside>
  );
}

function firstTool(snapshot: SessionSnapshot): ToolCall | undefined {
  for (let messageIndex = snapshot.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = snapshot.messages[messageIndex];
    if (!message) continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (part?.type === "tool_call") return part.toolCall;
    }
  }
  return undefined;
}

function turnLabel(status: string | undefined): string {
  if (!status) return "就绪";
  switch (status) {
    case "submitting": return "发送中…";
    case "queued": return "排队中…";
    case "running": return "思考中…";
    case "model_streaming": return "回复中…";
    case "tool_running": return "正在使用工具…";
    default: return "处理中…";
  }
}

function toolStatusLabel(status: ToolCall["status"]): string {
  switch (status) {
    case "requested": return "等待运行";
    case "running": return "运行中";
    case "completed": return "已完成";
    case "failed": return "失败";
    case "rejected": return "已拒绝";
  }
}

function activeStatus(status: Turn["status"]): ConversationActivityStatus | undefined {
  switch (status) {
    case "queued":
    case "running":
    case "model_streaming":
    case "tool_running":
      return status;
    case "completed":
    case "failed":
    case "cancelled":
      return undefined;
  }
}

function findActiveToolName(snapshot: SessionSnapshot): string | undefined {
  for (let messageIndex = snapshot.messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = snapshot.messages[messageIndex];
    if (!message) continue;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex];
      if (
        part?.type === "tool_call" &&
        (part.toolCall.status === "requested" || part.toolCall.status === "running")
      ) {
        return part.toolCall.name;
      }
    }
  }
  return undefined;
}

function restorePendingSubmission(
  snapshot: SessionSnapshot,
  submission: PendingSubmission | undefined,
): SessionSnapshot {
  if (!submission) return snapshot;
  const activeUserMessageIds = new Set(
    snapshot.turns
      .filter((turn) => activeStatus(turn.status) !== undefined)
      .map((turn) => turn.userMessageId),
  );
  const hasAuthoritativeMessage = snapshot.messages.some((message) =>
    message.role === "user" &&
    activeUserMessageIds.has(message.id) &&
    message.parts.some((part) => part.type === "text" && part.text === submission.text));
  return hasAuthoritativeMessage
    ? snapshot
    : appendOptimisticUserMessage(snapshot, submission);
}
