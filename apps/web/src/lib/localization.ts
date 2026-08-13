import { isErrorCode, type ErrorCode } from "@beecode/protocol";

const errorMessages: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "登录状态已失效，请重新登录。",
  FORBIDDEN: "当前操作没有权限，请检查访问来源或账号权限。",
  QUOTA_EXCEEDED: "账号额度已用完，请稍后重试或调整额度。",
  AUTHORIZATION_PENDING: "授权尚未完成，请继续等待。",
  AUTHORIZATION_DENIED: "授权已被拒绝。",
  AUTHORIZATION_EXPIRED: "授权请求已过期，请重新发起。",
  TOKEN_EXPIRED: "登录凭证已过期，请重新登录。",
  TOKEN_REVOKED: "登录凭证已失效，请重新登录。",
  MODEL_UNAVAILABLE: "模型服务暂时不可用，请稍后重试。",
  MODEL_TIMEOUT: "模型响应超时，请重试。",
  MODEL_STREAM_ERROR: "模型回复流中断，请重试。",
  TOOL_NOT_FOUND: "未找到需要调用的工具。",
  TOOL_INPUT_INVALID: "工具输入不符合要求。",
  TOOL_EXECUTION_FAILED: "工具执行失败。",
  TURN_CANCELLED: "任务已取消。",
  TURN_LIMIT_EXCEEDED: "本次任务已达到最大执行步数。",
  TURN_ALREADY_ACTIVE: "当前会话已有任务正在运行。",
  IDEMPOTENCY_CONFLICT: "请求标识发生冲突，请重新发送。",
  RUNTIME_INTERRUPTED: "运行环境已中断，请重试。",
  SESSION_NOT_FOUND: "未找到该会话。",
  SESSION_VERSION_CONFLICT: "会话已在其他位置更新，请刷新后重试。",
  SURFACE_UNAVAILABLE: "当前界面不支持这项能力。",
  STREAM_DISCONNECTED: "实时连接已断开，正在尝试恢复。",
  SYNC_FAILED: "会话同步失败，请重试。",
  INVALID_REQUEST: "请求内容不符合要求。",
  INTERNAL: "发生内部错误，请重试。",
};

const capabilityLabels: Record<string, string> = {
  localWorkspace: "本地工作区",
  shell: "终端命令",
  git: "Git 操作",
  attachments: "附件",
};

const capabilityReasonLabels: Record<string, string> = {
  surface_policy: "当前界面不可用",
  runtime_missing: "运行环境未启动",
  not_configured: "尚未配置",
  not_authorized: "尚未授权",
};

export function localizedErrorMessage(error: { code: string; message: string }): string {
  return isErrorCode(error.code) ? errorMessages[error.code] : error.message;
}

export function localizedSessionTitle(title: string): string {
  return title === "New Web Session" ? "新会话" : title;
}

export function capabilityLabel(name: string): string {
  return capabilityLabels[name] ?? name;
}

export function capabilityReasonLabel(reason: string | undefined): string {
  return reason ? capabilityReasonLabels[reason] ?? reason : "不可用";
}

export function runtimeLocationLabel(location: string): string {
  return location === "backend" ? "后端" : location === "local" ? "本地" : location;
}

export function surfaceLabel(surface: string): string {
  return surface === "web" ? "网页端" : surface === "cli" ? "命令行" : surface;
}
