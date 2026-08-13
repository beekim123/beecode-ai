import { Archive, Menu, Moon, Sun, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BeecodeError,
  type AccountSummary,
  type CapabilitySet,
  type QuotaSnapshot,
  type Session,
} from "@beecode/protocol";
import { agentClient, webTransport } from "../lib/api.js";
import {
  capabilityLabel,
  capabilityReasonLabel,
  localizedErrorMessage,
  localizedSessionTitle,
  runtimeLocationLabel,
  surfaceLabel,
} from "../lib/localization.js";
import { navigate } from "../lib/navigation.js";
import { SessionSidebar } from "../components/SessionSidebar.js";
import { SessionView } from "../features/sessions/SessionView.js";

interface WorkspaceProps {
  account: AccountSummary;
  pathname: string;
}

export function Workspace({ account, pathname }: WorkspaceProps): React.JSX.Element {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [quota, setQuota] = useState<QuotaSnapshot>();
  const [capabilities, setCapabilities] = useState<CapabilitySet>();
  const [error, setError] = useState<BeecodeError>();
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => preferredTheme());
  const [archiveCandidate, setArchiveCandidate] = useState<Session>();
  const [isArchiving, setIsArchiving] = useState(false);
  const archiveReturnFocus = useRef<HTMLElement | null>(null);
  const selectedSessionId = sessionIdFromPath(pathname);

  const refreshWorkspace = useCallback(async () => {
    try {
      const [nextSessions, nextQuota, nextCapabilities] = await Promise.all([
        agentClient.listSessions(),
        webTransport.getQuota(),
        agentClient.getCapabilities(),
      ]);
      setSessions(nextSessions);
      setQuota(nextQuota);
      setCapabilities(nextCapabilities);
      setError(undefined);
    } catch (caught: unknown) {
      setError(BeecodeError.fromUnknown(caught));
    } finally {
      setLoading(false);
    }
  }, []);
  const handleSessionChanged = useCallback(() => {
    void refreshWorkspace();
  }, [refreshWorkspace]);

  useEffect(() => { void refreshWorkspace(); }, [refreshWorkspace]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("beecode:theme:v1", theme);
  }, [theme]);

  async function createSession(): Promise<void> {
    setError(undefined);
    try {
      const session = await agentClient.createSession();
      setSessions((current) => [session, ...current]);
      navigate(`/app/session/${encodeURIComponent(session.id)}`);
      setSidebarOpen(false);
    } catch (caught: unknown) {
      setError(BeecodeError.fromUnknown(caught));
    }
  }

  async function logout(): Promise<void> {
    setError(undefined);
    setLoggingOut(true);
    try {
      await webTransport.logout();
      window.location.assign("/login");
    } catch (caught: unknown) {
      setError(BeecodeError.fromUnknown(caught));
    } finally {
      setLoggingOut(false);
    }
  }

  function requestArchive(session: Session): void {
    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    archiveReturnFocus.current = activeElement
      ?.closest(".session-row")
      ?.querySelector<HTMLElement>(".session-actions-trigger") ?? activeElement;
    setArchiveCandidate(session);
  }

  function closeArchiveDialog(): void {
    if (isArchiving) return;
    setArchiveCandidate(undefined);
    requestAnimationFrame(() => {
      if (archiveReturnFocus.current?.isConnected) archiveReturnFocus.current.focus();
    });
  }

  async function archiveSession(): Promise<void> {
    if (!archiveCandidate || isArchiving) return;
    setIsArchiving(true);
    setError(undefined);
    try {
      const archived = await agentClient.updateSession({
        sessionId: archiveCandidate.id,
        expectedVersion: archiveCandidate.version,
        status: "archived",
      });
      setSessions((current) => current.map((session) => session.id === archived.id ? archived : session));
      setArchiveCandidate(undefined);
      if (selectedSessionId === archived.id) navigate("/app");
    } catch (caught: unknown) {
      setError(BeecodeError.fromUnknown(caught));
    } finally {
      setIsArchiving(false);
    }
  }

  if (loading) return <WorkspaceSkeleton />;
  if (!quota || !capabilities) {
    return <WorkspaceFailure error={error} onRetry={() => void refreshWorkspace()} />;
  }

  return (
    <>
      <div
        className={`app-shell ${sidebarCollapsed ? "sidebar-is-collapsed" : ""}`}
        inert={archiveCandidate ? true : undefined}
      >
        {error ? <WorkspaceError error={error} onDismiss={() => setError(undefined)} /> : null}
        {sidebarOpen ? <button className="sidebar-scrim" type="button" onClick={() => setSidebarOpen(false)} aria-label="关闭会话侧栏" /> : null}
        <SessionSidebar
          account={account}
          quota={quota}
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          isOpen={sidebarOpen}
          isCollapsed={sidebarCollapsed}
          showArchived={showArchived}
          onCreate={() => void createSession()}
          onClose={() => setSidebarOpen(false)}
          onCollapse={() => setSidebarCollapsed((current) => !current)}
          onArchive={requestArchive}
          onToggleArchived={() => setShowArchived((current) => !current)}
        />
        {pathname === "/settings/account" ? (
          <AccountSettings account={account} quota={quota} capabilities={capabilities} loggingOut={loggingOut} onLogout={() => void logout()} onMenu={() => setSidebarOpen(true)} onTheme={() => setTheme((current) => current === "dark" ? "light" : "dark")} theme={theme} />
        ) : selectedSessionId ? (
          <SessionView key={selectedSessionId} sessionId={selectedSessionId} onMenu={() => setSidebarOpen(true)} onSessionChanged={handleSessionChanged} />
        ) : (
          <SessionLanding onMenu={() => setSidebarOpen(true)} onCreate={() => void createSession()} />
        )}
      </div>
      {archiveCandidate ? (
        <ArchiveSessionDialog
          session={archiveCandidate}
          isArchiving={isArchiving}
          onCancel={closeArchiveDialog}
          onConfirm={() => void archiveSession()}
        />
      ) : null}
    </>
  );
}

function ArchiveSessionDialog({
  session,
  isArchiving,
  onCancel,
  onConfirm,
}: {
  session: Session;
  isArchiving: boolean;
  onCancel(): void;
  onConfirm(): void;
}): React.JSX.Element {
  const dialog = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelButton.current?.focus();
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialog.current) return;
    const controls = [...dialog.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="archive-dialog"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="archive-dialog-title"
        aria-describedby="archive-dialog-description"
      >
        <span className="archive-dialog-icon" aria-hidden="true"><Archive size={19} /></span>
        <div>
          <p className="eyebrow">归档会话</p>
          <h2 id="archive-dialog-title">归档“{localizedSessionTitle(session.title)}”？</h2>
          <p id="archive-dialog-description">
            归档不会删除对话。该会话会移出活跃列表，之后仍可在“查看已归档”中找到。
          </p>
        </div>
        <div className="archive-dialog-actions">
          <button ref={cancelButton} type="button" disabled={isArchiving} onClick={onCancel}>保留会话</button>
          <button className="archive-confirm-button" type="button" disabled={isArchiving} onClick={onConfirm}>
            {isArchiving ? "正在归档…" : "归档会话"}
          </button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceError({ error, onDismiss }: { error: BeecodeError; onDismiss(): void }): React.JSX.Element {
  return (
    <div className="workspace-error" role="alert">
      <div><strong>{error.code}</strong><span>{localizedErrorMessage(error)}</span></div>
      <button type="button" onClick={onDismiss} aria-label="关闭错误提示"><X size={16} /></button>
    </div>
  );
}

function WorkspaceFailure({ error, onRetry }: { error: BeecodeError | undefined; onRetry(): void }): React.JSX.Element {
  return (
    <main className="fatal-state">
      <p className="eyebrow">工作台不可用</p>
      <h1>无法加载 Agent 工作台</h1>
      <p>{error ? localizedErrorMessage(error) : "后端没有返回工作台数据。"}</p>
      <button className="primary-button" type="button" onClick={onRetry}>重试</button>
    </main>
  );
}

function SessionLanding({ onMenu, onCreate }: { onMenu(): void; onCreate(): void }): React.JSX.Element {
  return <main className="conversation-main"><header className="conversation-header"><button className="icon-button mobile-only" type="button" onClick={onMenu} aria-label="打开会话侧栏"><Menu size={19} /></button><div className="conversation-title"><h1>工作台</h1><span>选择或创建一个会话</span></div></header><div className="conversation-notices" /><div className="session-landing"><p className="eyebrow">后端 Agent 运行环境</p><h2>专注处理持续进行的工作</h2><p>创建网页会话，运行工具、实时查看进度，并在刷新后恢复可靠的最终结果。</p><button className="primary-button" type="button" onClick={onCreate}>创建第一个会话</button></div></main>;
}

function AccountSettings({ account, quota, capabilities, loggingOut, onLogout, onMenu, onTheme, theme }: { account: AccountSummary; quota: QuotaSnapshot; capabilities: CapabilitySet; loggingOut: boolean; onLogout(): void; onMenu(): void; onTheme(): void; theme: string }): React.JSX.Element {
  return (
    <main className="conversation-main settings-main">
      <header className="conversation-header"><button className="icon-button mobile-only" type="button" onClick={onMenu} aria-label="打开会话侧栏"><Menu size={19} /></button><div className="conversation-title"><h1>账号与运行环境</h1><span>身份、额度和界面能力</span></div></header>
      <div className="settings-content">
        <section><p className="eyebrow">账号</p><h2>{account.accountId}</h2><dl><div><dt>创建时间</dt><dd>{new Date(account.createdAt).toLocaleString("zh-CN")}</dd></div><div><dt>运行位置</dt><dd>{runtimeLocationLabel(capabilities.runtimeLocation)}</dd></div><div><dt>当前界面</dt><dd>{surfaceLabel(capabilities.surface)}</dd></div></dl></section>
        <section><p className="eyebrow">额度</p><h2>{quota.quotaUsedTokens.toLocaleString("zh-CN")} <small>/ {quota.quotaLimitTokens.toLocaleString("zh-CN")} Token</small></h2><div className="quota-track large"><span style={{ width: `${Math.min(100, quota.quotaUsedTokens / quota.quotaLimitTokens * 100)}%` }} /></div><p>当前预留 {quota.quotaReservedTokens.toLocaleString("zh-CN")} Token。</p></section>
        <section><p className="eyebrow">网页端能力</p><ul className="capability-list">{capabilities.tools.map((tool) => <li key={tool.name}><strong>{tool.name}</strong><span>可用</span></li>)}{Object.entries(capabilities.features).map(([name, capability]) => <li key={name}><strong>{capabilityLabel(name)}</strong><span>{capability.available ? "可用" : capabilityReasonLabel(capability.reason)}</span></li>)}</ul></section>
        <section className="settings-actions"><button type="button" onClick={onTheme}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />} 切换为{theme === "dark" ? "浅色" : "深色"}主题</button><button className="danger-button" type="button" disabled={loggingOut} onClick={onLogout}>{loggingOut ? "正在退出…" : "退出登录"}</button></section>
      </div>
    </main>
  );
}

function WorkspaceSkeleton(): React.JSX.Element {
  return <div className="app-shell loading-shell" aria-label="正在加载工作台"><aside className="session-sidebar"><div className="skeleton-logo" /><div className="skeleton-button" />{[1,2,3,4].map((item) => <div className="skeleton-session" key={item} />)}</aside><main className="conversation-main"><header className="conversation-header"><div className="title-skeleton" /></header><div className="conversation-scroll skeleton-stack"><span /><span /><span /></div></main></div>;
}

function sessionIdFromPath(pathname: string): string | undefined {
  const match = /^\/app\/session\/([^/]+)$/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function preferredTheme(): "light" | "dark" {
  const stored = localStorage.getItem("beecode:theme:v1");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
