import { ChevronDown, Folder, FolderOpen, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import {
  isBrowserWorkspaceSupported,
  selectBrowserWorkspace,
  type BrowserWorkspace,
} from "./browser-workspace.js";

interface WorkspacePickerProps {
  workspace?: BrowserWorkspace;
  disabled?: boolean;
  onChange(workspace: BrowserWorkspace | undefined): void;
}

export function WorkspacePicker({ workspace, disabled, onChange }: WorkspacePickerProps): React.JSX.Element {
  const [isPicking, setIsPicking] = useState(false);
  const [error, setError] = useState<string>();
  const isSupported = isBrowserWorkspaceSupported();

  async function pickWorkspace(): Promise<void> {
    if (!isSupported || disabled || isPicking) return;
    setIsPicking(true);
    setError(undefined);
    try {
      const selected = await selectBrowserWorkspace();
      if (selected) onChange(selected);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "无法打开本地工作空间");
    } finally {
      setIsPicking(false);
    }
  }

  return (
    <div className="workspace-picker">
      {workspace ? (
        <div className="workspace-selection" role="status" aria-label="当前工作空间">
          <button
            className="workspace-trigger"
            type="button"
            title="更换工作空间"
            aria-label="更换工作空间"
            disabled={disabled || isPicking}
            onClick={() => void pickWorkspace()}
          >
            {isPicking
              ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
              : <FolderOpen size={16} aria-hidden="true" />}
            <span>{workspace.reference.name}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <button
            className="workspace-clear"
            type="button"
            aria-label="移除工作空间"
            disabled={disabled || isPicking}
            onClick={() => onChange(undefined)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          className="workspace-trigger"
          type="button"
          title={isSupported ? "添加工作空间" : "当前浏览器不支持本地工作空间"}
          aria-label="添加工作空间"
          disabled={disabled || isPicking || !isSupported}
          onClick={() => void pickWorkspace()}
        >
          {isPicking
            ? <LoaderCircle className="spin" size={16} aria-hidden="true" />
            : <Folder size={16} aria-hidden="true" />}
          <span>{isSupported ? (isPicking ? "正在打开…" : "选择工作空间") : "本地工作空间不可用"}</span>
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      )}
      {error ? <span className="workspace-picker-error" role="alert">{error}</span> : null}
    </div>
  );
}
