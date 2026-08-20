import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  AlertCircle,
  Calculator,
  CircleStop,
  FileText,
  LogIn,
  LogOut,
  MessageSquarePlus,
  Plus,
  RefreshCw,
  Send,
} from "lucide-react";
import type {
  Message,
  Session,
  SessionSnapshot,
  ToolCall,
  Turn,
  WorkspaceSummary,
} from "@beecode/protocol";
import type { DesktopAuthStatus, DesktopRuntimeStatus } from "../preload/api.js";
import { applyAgentEvent } from "./session-projection.js";
import { WorkspaceControl } from "./WorkspaceControl.js";

const emptyAuth: DesktopAuthStatus = { state: "unauthenticated", persistence: "memory_only" };
const emptyRuntime: DesktopRuntimeStatus = { state: "stopped" };

export function App(): JSX.Element {
  const [auth, setAuth] = useState(emptyAuth);
  const [runtime, setRuntime] = useState(emptyRuntime);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [snapshot, setSnapshot] = useState<SessionSnapshot>();
  const [draft, setDraft] = useState("计算 1+1");
  const [pendingText, setPendingText] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null);
  const [error, setError] = useState<string>();
  const selectedRef = useRef<string | undefined>(undefined);
  const messageFeedRef = useRef<HTMLDivElement>(null);
  const followsLatestRef = useRef(true);

  const loadSessions = useCallback(async () => {
    const page = await window.beecode.runtime.listSessions();
    setSessions(page.items);
    const remembered = localStorage.getItem("beecode.desktop.selectedSession");
    const rememberedId = remembered && page.items.some((session) => session.id === remembered)
      ? remembered
      : undefined;
    setSelectedId((current) => {
      if (current && page.items.some((session) => session.id === current)) return current;
      return rememberedId ?? page.items[0]?.id;
    });
  }, []);

  useEffect(() => {
    const removeAuth = window.beecode.auth.onStatus(setAuth);
    const removeRuntime = window.beecode.runtime.onStatus(setRuntime);
    const removeEvents = window.beecode.runtime.onEvent((event) => {
      if (event.sessionId !== selectedRef.current) return;
      setSnapshot((current) => current ? applyAgentEvent(current, event) : current);
    });
    void Promise.all([window.beecode.auth.getStatus(), window.beecode.runtime.getStatus()]).then(
      ([authStatus, runtimeStatus]) => {
        setAuth(authStatus);
        setRuntime(runtimeStatus);
      },
    );
    return () => {
      removeAuth();
      removeRuntime();
      removeEvents();
    };
  }, []);

  useEffect(() => {
    if (auth.state !== "authenticated" || runtime.state !== "ready") return;
    let active = true;
    void loadSessions().then(
      () => {
        if (active) setError(undefined);
      },
      (reason: unknown) => {
        if (active) setError(messageFrom(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [auth.state, runtime.state, loadSessions]);

  useEffect(() => {
    if (runtime.state !== "ready") {
      setWorkspace(null);
      return;
    }
    let active = true;
    void window.beecode.workspace.get().then(
      (current) => {
        if (active) setWorkspace(current);
      },
      (reason: unknown) => {
        if (active) setError(messageFrom(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [runtime.state]);

  useEffect(() => {
    selectedRef.current = selectedId;
    followsLatestRef.current = true;
    if (!selectedId || auth.state !== "authenticated" || runtime.state !== "ready") {
      setSnapshot(undefined);
      return;
    }
    localStorage.setItem("beecode.desktop.selectedSession", selectedId);
    let active = true;
    void (async () => {
      await window.beecode.runtime.subscribe(selectedId);
      const value = await window.beecode.runtime.getSessionSnapshot(selectedId);
      if (active) setSnapshot(value);
    })().catch((reason: unknown) => {
      if (active) setError(messageFrom(reason));
    });
    return () => {
      active = false;
      void window.beecode.runtime.unsubscribe(selectedId).catch(() => undefined);
    };
  }, [selectedId, auth.state, runtime.state]);

  useLayoutEffect(() => {
    const feed = messageFeedRef.current;
    if (!feed || !followsLatestRef.current) return;
    feed.scrollTop = feed.scrollHeight;
  }, [selectedId, pendingText, snapshot?.messages.length, snapshot?.live?.sequence]);

  const activeTurn = useMemo(
    () => snapshot?.turns.find((turn) => isActive(turn.status)),
    [snapshot],
  );
  const canSubmit =
    auth.state === "authenticated" &&
    runtime.state === "ready" &&
    Boolean(selectedId) &&
    draft.trim().length > 0 &&
    !busy &&
    !activeTurn;
  const workspaceDisabled = runtime.state !== "ready" || Boolean(activeTurn);

  const createSession = async (): Promise<void> => {
    setError(undefined);
    try {
      const created = await window.beecode.runtime.createSession("Desktop Session");
      await loadSessions();
      setSelectedId(created.id);
    } catch (reason: unknown) {
      setError(messageFrom(reason));
    }
  };

  const submit = async (): Promise<void> => {
    if (!selectedId || !canSubmit) return;
    const text = draft.trim();
    followsLatestRef.current = true;
    setBusy(true);
    setPendingText(text);
    setDraft("");
    setError(undefined);
    try {
      await window.beecode.runtime.submitMessage(selectedId, text);
      setSnapshot(await window.beecode.runtime.getSessionSnapshot(selectedId));
      await loadSessions();
    } catch (reason: unknown) {
      setError(messageFrom(reason));
      setDraft(text);
    } finally {
      setPendingText(undefined);
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!selectedId || !activeTurn) return;
    try {
      await window.beecode.runtime.cancelTurn(selectedId, activeTurn.id);
    } catch (reason: unknown) {
      setError(messageFrom(reason));
    }
  };

  const selectWorkspace = async (): Promise<void> => {
    if (workspaceDisabled || workspaceBusy) return;
    setWorkspaceBusy(true);
    setError(undefined);
    try {
      setWorkspace(await window.beecode.workspace.select());
    } catch (reason: unknown) {
      setError(messageFrom(reason));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const clearWorkspace = async (): Promise<void> => {
    if (workspaceDisabled || workspaceBusy) return;
    setWorkspaceBusy(true);
    setError(undefined);
    try {
      await window.beecode.workspace.clear();
      setWorkspace(null);
    } catch (reason: unknown) {
      setError(messageFrom(reason));
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const toolNames = useMemo(() => collectToolNames(snapshot?.messages ?? []), [snapshot?.messages]);

  if (auth.state !== "authenticated") {
    return (
      <main className="auth-shell">
        <section className="auth-panel" aria-labelledby="auth-title">
          <div className="brand-mark"><Calculator size={21} aria-hidden="true" /></div>
          <h1 id="auth-title">Beecode Desktop</h1>
          <p>{auth.state === "authorizing" ? "请在系统浏览器中完成授权" : "登录后开始本地 Agent 会话"}</p>
          {auth.error && <ErrorBanner message={auth.error.message} />}
          <button
            className="primary-command"
            onClick={() => void window.beecode.auth.login()}
            disabled={auth.state === "authorizing"}
          >
            <LogIn size={17} aria-hidden="true" />
            {auth.state === "authorizing" ? "等待授权" : "登录"}
          </button>
          {auth.persistence === "memory_only" && <small>本机安全存储不可用，本次登录不会持久化。</small>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="brand"><Calculator size={18} aria-hidden="true" /><strong>Beecode</strong></div>
          <button
            className="icon-button"
            title="新建会话"
            aria-label="新建会话"
            onClick={() => void createSession()}
            disabled={runtime.state !== "ready"}
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </header>
        <nav className="session-list" aria-label="Desktop 会话">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === selectedId ? "session-row selected" : "session-row"}
              onClick={() => setSelectedId(session.id)}
            >
              <MessageSquarePlus size={15} aria-hidden="true" />
              <span>{session.title}</span>
            </button>
          ))}
          {sessions.length === 0 && <p className="empty-sidebar">还没有会话</p>}
        </nav>
        <footer className="account-footer">
          <RuntimeIndicator status={runtime} />
          <button
            className="icon-button"
            title="退出登录"
            aria-label="退出登录"
            onClick={() => void window.beecode.auth.logout()}
          >
            <LogOut size={17} aria-hidden="true" />
          </button>
        </footer>
      </aside>

      <section className="conversation">
        <header className="conversation-header">
          <div>
            <h1>{snapshot?.session.title ?? "Desktop Session"}</h1>
            <span>{snapshot ? `已同步 v${snapshot.session.version}` : runtimeLabel(runtime.state)}</span>
          </div>
          <div className="conversation-actions">
            {runtime.state === "unavailable" && (
              <button className="secondary-command" onClick={() => void window.beecode.runtime.retry()}>
                <RefreshCw size={16} aria-hidden="true" />重试 Runtime
              </button>
            )}
          </div>
        </header>

        <div
          className="message-feed"
          aria-live="polite"
          ref={messageFeedRef}
          onScroll={(event) => {
            const feed = event.currentTarget;
            followsLatestRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 64;
          }}
        >
          {!selectedId && (
            <div className="empty-state">
              <MessageSquarePlus size={24} aria-hidden="true" />
              <p>创建一个 Desktop Session 开始。</p>
              <button className="primary-command" onClick={() => void createSession()}>
                <Plus size={17} aria-hidden="true" />新建会话
              </button>
            </div>
          )}
          {snapshot?.messages.map((message) => (
            <MessageView key={message.id} message={message} toolNames={toolNames} />
          ))}
          {pendingText && <div className="message user pending"><p>{pendingText}</p><small>正在提交</small></div>}
          {error && <ErrorBanner message={error} />}
        </div>

        <div className="composer-stack">
          <div className="composer-context">
            <WorkspaceControl
              workspace={workspace}
              busy={workspaceBusy}
              disabled={workspaceDisabled}
              onSelect={() => void selectWorkspace()}
              onClear={() => void clearWorkspace()}
            />
          </div>
          <footer className="composer">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="输入消息…"
              aria-label="消息"
              name="message"
              autoComplete="off"
              disabled={!selectedId || runtime.state !== "ready"}
              rows={2}
            />
            {activeTurn ? (
              <button className="stop-command" onClick={() => void cancel()} title="取消当前 Turn">
                <CircleStop size={18} aria-hidden="true" />取消
              </button>
            ) : (
              <button className="send-command" onClick={() => void submit()} disabled={!canSubmit} title="发送" aria-label="发送">
                <Send size={18} aria-hidden="true" />
              </button>
            )}
          </footer>
        </div>
      </section>
    </main>
  );
}

function MessageView({
  message,
  toolNames,
}: {
  message: Message;
  toolNames: ReadonlyMap<string, string>;
}): JSX.Element {
  if (message.role === "tool") {
    return <>{message.parts.map((part) => {
      if (part.type !== "tool_result") return null;
      const toolName = toolNames.get(part.toolCallId) ?? "tool";
      return (
        <div className="tool-result" key={part.id}>
          <ToolIcon name={toolName} />
          <div>
            <strong>{toolName} result</strong>
            <pre>{formatValue(part.result.ok ? part.result.output : part.result.error)}</pre>
          </div>
        </div>
      );
    })}</>;
  }
  return (
    <article className={`message ${message.role}`}>
      {message.parts.map((part) => {
        if (part.type === "text") return <p key={part.id}>{part.text}</p>;
        if (part.type === "tool_call") return <ToolCallView key={part.id} toolCall={part.toolCall} />;
        return null;
      })}
    </article>
  );
}

function ToolCallView({ toolCall }: { toolCall: ToolCall }): JSX.Element {
  return (
    <div className="tool-call">
      <ToolIcon name={toolCall.name} />
      <div><strong>{toolCall.name}</strong><span>{toolCall.status}</span><pre>{formatValue(toolCall.input)}</pre></div>
    </div>
  );
}

function ToolIcon({ name }: { name: string }): JSX.Element {
  return name === "read_file"
    ? <FileText size={16} aria-hidden="true" />
    : <Calculator size={16} aria-hidden="true" />;
}

function RuntimeIndicator({ status }: { status: DesktopRuntimeStatus }): JSX.Element {
  return <div className={`runtime-indicator ${status.state}`} role="status" aria-live="polite"><span />{runtimeLabel(status.state)}</div>;
}

function ErrorBanner({ message }: { message: string }): JSX.Element {
  return <div className="error-banner" role="alert"><AlertCircle size={17} aria-hidden="true" /><span>{message}</span></div>;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "null";
}

function runtimeLabel(state: DesktopRuntimeStatus["state"]): string {
  const labels: Record<DesktopRuntimeStatus["state"], string> = {
    stopped: "Runtime 已停止",
    starting: "Runtime 启动中",
    handshaking: "Runtime 连接中",
    ready: "Runtime 可用",
    stopping: "Runtime 关闭中",
    reconnecting: "Runtime 重连中",
    unavailable: "Runtime 不可用",
  };
  return labels[state];
}

function isActive(status: Turn["status"]): boolean {
  return status === "queued" || status === "running" || status === "model_streaming" || status === "tool_running";
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Desktop operation failed";
}

function collectToolNames(messages: Message[]): ReadonlyMap<string, string> {
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool_call") toolNames.set(part.toolCall.id, part.toolCall.name);
    }
  }
  return toolNames;
}
