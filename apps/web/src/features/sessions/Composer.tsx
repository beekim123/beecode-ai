import { LoaderCircle, Send, Square } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

interface ComposerProps {
  value: string;
  isRunning: boolean;
  isConnected: boolean;
  isSending: boolean;
  onChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
}

export function Composer(props: ComposerProps): React.JSX.Element {
  const composing = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const canSubmit = props.value.trim().length > 0 && props.isConnected && !props.isRunning && !props.isSending;

  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.max(36, Math.min(element.scrollHeight, 160))}px`;
  }, [props.value]);

  return (
    <div className="composer-wrap">
      <div className="composer">
        <label className="sr-only" htmlFor="message-composer">给 Beecode 发送消息</label>
        <textarea
          id="message-composer"
          ref={textarea}
          name="message"
          autoComplete="off"
          aria-describedby="message-composer-help"
          value={props.value}
          rows={1}
          placeholder={props.isConnected ? "给 Beecode 安排任务…" : "正在等待连接恢复…"}
          disabled={!props.isConnected}
          onChange={(event) => props.onChange(event.target.value)}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !composing.current) {
              event.preventDefault();
              if (canSubmit) props.onSubmit();
            }
          }}
        />
        {props.isRunning ? (
          <button className="composer-button stop" type="button" onClick={props.onCancel} aria-label="停止当前任务">
            <Square size={16} fill="currentColor" aria-hidden="true" />
          </button>
        ) : (
          <button
            className={`composer-button${props.isSending ? " sending" : ""}`}
            type="button"
            onClick={props.onSubmit}
            disabled={!canSubmit}
            aria-label={props.isSending ? "正在发送消息" : "发送消息"}
          >
            {props.isSending ? <LoaderCircle size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
          </button>
        )}
      </div>
      <div className="composer-meta" id="message-composer-help">
        <span>Enter 发送，Shift+Enter 换行</span>
        <span>{props.isSending ? "发送中…" : props.isRunning ? "Beecode 正在工作…" : "工具将在后端运行"}</span>
      </div>
    </div>
  );
}
