import { Archive, Braces, ChevronLeft, MessageSquarePlus, MoreHorizontal, PanelLeftClose, Settings, X } from "lucide-react";
import { useState } from "react";
import type { AccountSummary, QuotaSnapshot, Session } from "@beecode/protocol";
import { localizedSessionTitle } from "../lib/localization.js";
import { navigate } from "../lib/navigation.js";

interface SessionSidebarProps {
  account: AccountSummary;
  quota: QuotaSnapshot;
  sessions: Session[];
  selectedSessionId?: string;
  isOpen: boolean;
  isCollapsed: boolean;
  showArchived: boolean;
  onCreate(): void;
  onClose(): void;
  onCollapse(): void;
  onArchive(session: Session): void;
  onToggleArchived(): void;
}

export function SessionSidebar(props: SessionSidebarProps): React.JSX.Element {
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string>();
  const quotaPercent = Math.min(100, Math.round((props.quota.quotaUsedTokens / props.quota.quotaLimitTokens) * 100));
  const visibleSessions = props.sessions.filter((session) => props.showArchived || session.status === "active");
  return (
    <aside className={`session-sidebar ${props.isOpen ? "open" : ""} ${props.isCollapsed ? "collapsed" : ""}`} aria-label="会话侧栏">
      <div className="sidebar-topline">
        <button className="brand-button" type="button" onClick={() => navigate("/app")} aria-label="返回会话列表">
          <span className="brand-mark compact"><Braces size={18} aria-hidden="true" /></span><strong>Beecode</strong>
        </button>
        <button className="icon-button mobile-only" type="button" onClick={props.onClose} aria-label="关闭会话侧栏"><X size={18} /></button>
      </div>
      <button className="new-session-button" type="button" onClick={props.onCreate}>
        <MessageSquarePlus size={17} aria-hidden="true" /><span>新建会话</span>
      </button>
      <div className="session-section-heading">
        <span>会话</span>
        <button type="button" onClick={props.onToggleArchived}>{props.showArchived ? "只看活跃" : "查看已归档"}</button>
      </div>
      <nav className="session-nav" aria-label="Agent 会话">
        {visibleSessions.length === 0 ? <p className="sidebar-empty">暂无会话</p> : null}
        {visibleSessions.map((session) => {
          const isSelected = session.id === props.selectedSessionId;
          const isMenuOpen = openMenuSessionId === session.id;
          const title = localizedSessionTitle(session.title);
          return (
            <div
              className={`session-row${isSelected ? " selected" : ""}${isMenuOpen ? " menu-open" : ""}`}
              key={session.id}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpenMenuSessionId(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && isMenuOpen) {
                  event.preventDefault();
                  setOpenMenuSessionId(undefined);
                  event.currentTarget.querySelector<HTMLButtonElement>(".session-actions-trigger")?.focus();
                }
              }}
            >
              <button
                className={`session-link${isSelected ? " selected" : ""}`}
                type="button"
                onClick={() => {
                  setOpenMenuSessionId(undefined);
                  navigate(`/app/session/${encodeURIComponent(session.id)}`);
                  props.onClose();
                }}
              >
                {session.status === "archived" ? <Archive size={14} aria-hidden="true" /> : <span className="session-bullet" aria-hidden="true" />}
                <span><strong>{title}</strong><small>{relativeTime(session.updatedAt)}</small></span>
              </button>
              {session.status === "active" ? (
                <button
                  className="session-actions-trigger tooltip-button"
                  type="button"
                  data-tooltip="会话操作"
                  aria-label={`${title}的操作`}
                  aria-expanded={isMenuOpen}
                  aria-haspopup="menu"
                  aria-controls={`session-actions-${session.id}`}
                  onClick={() => {
                    if (isMenuOpen) {
                      setOpenMenuSessionId(undefined);
                      return;
                    }
                    setOpenMenuSessionId(session.id);
                    requestAnimationFrame(() => {
                      document.getElementById(`archive-session-${session.id}`)?.focus();
                    });
                  }}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              ) : null}
              {isMenuOpen ? (
                <div
                  className="session-actions-menu"
                  id={`session-actions-${session.id}`}
                  role="menu"
                  aria-label={`${title}的操作`}
                >
                  <button
                    id={`archive-session-${session.id}`}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setOpenMenuSessionId(undefined);
                      props.onArchive(session);
                    }}
                  >
                    <Archive size={15} aria-hidden="true" /> 归档会话
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-account">
        <button className="account-link" type="button" onClick={() => navigate("/settings/account")}>
          <span className="account-avatar">{props.account.accountId.slice(-2).toUpperCase()}</span>
          <span><strong>{shortAccount(props.account.accountId)}</strong><small>已使用 {quotaPercent}% 额度</small></span>
          <Settings size={15} aria-hidden="true" />
        </button>
        <div className="quota-track" aria-label={`已使用 ${quotaPercent}% 额度`}><span style={{ width: `${quotaPercent}%` }} /></div>
      </div>
      <button className="sidebar-collapse" type="button" onClick={props.onCollapse} aria-label={props.isCollapsed ? "展开侧栏" : "收起侧栏"}>
        {props.isCollapsed ? <ChevronLeft size={16} /> : <PanelLeftClose size={16} />}<span>收起</span>
      </button>
    </aside>
  );
}

function relativeTime(timestamp: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(timestamp)) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}小时` : `${Math.floor(hours / 24)}天`;
}

function shortAccount(accountId: string): string {
  return accountId.length > 15 ? `${accountId.slice(0, 8)}…${accountId.slice(-4)}` : accountId;
}
