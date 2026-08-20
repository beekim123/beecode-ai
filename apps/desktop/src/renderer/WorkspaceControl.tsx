import { ChevronDown, Folder, FolderOpen, LoaderCircle, X } from "lucide-react";
import type { WorkspaceSummary } from "@beecode/protocol";

interface WorkspaceControlProps {
  workspace: WorkspaceSummary | null;
  disabled: boolean;
  busy: boolean;
  onSelect(): void;
  onClear(): void;
}

export function WorkspaceControl({
  workspace,
  disabled,
  busy,
  onSelect,
  onClear,
}: WorkspaceControlProps): React.JSX.Element {
  return (
    <div className="workspace-control">
      {workspace ? (
        <div className="workspace-summary" role="status" aria-label="当前工作空间">
          <button
            className="workspace-trigger"
            type="button"
            title="更换工作空间"
            aria-label="更换工作空间"
            disabled={disabled || busy}
            onClick={onSelect}
          >
            {busy
              ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
              : <FolderOpen size={16} aria-hidden="true" />}
            <span title={workspace.name}>{workspace.name}</span>
            <small>{workspace.fileCount} files</small>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <button
            className="workspace-clear"
            type="button"
            title="移除工作空间"
            aria-label="移除工作空间"
            disabled={disabled || busy}
            onClick={onClear}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          className="workspace-trigger"
          type="button"
          title="添加工作空间"
          aria-label="添加工作空间"
          disabled={disabled || busy}
          onClick={onSelect}
        >
          {busy
            ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
            : <Folder size={16} aria-hidden="true" />}
          <span>{busy ? "正在打开…" : "选择工作空间"}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
