import { randomUUID } from "node:crypto";
import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  BeecodeError,
  DESKTOP_IPC_PROTOCOL_VERSION,
  ErrorCodes,
  parseDesktopIpcFrame,
  type DesktopIpcRequestFrame,
} from "@beecode/protocol";
import { DESKTOP_CHANNELS, DesktopAuthStatusSchema } from "../preload/api.js";
import type { AuthManager } from "./auth-manager.js";
import type { RuntimeSupervisor } from "./runtime-supervisor.js";

interface RegisterDesktopIpcOptions {
  window: BrowserWindow;
  auth: AuthManager;
  runtime: RuntimeSupervisor;
}

export function registerDesktopIpc(options: RegisterDesktopIpcOptions): () => void {
  const { window, auth, runtime } = options;
  const handlers = [
    DESKTOP_CHANNELS.authStatus,
    DESKTOP_CHANNELS.authLogin,
    DESKTOP_CHANNELS.authLogout,
    DESKTOP_CHANNELS.runtimeRequest,
    DESKTOP_CHANNELS.runtimeStatus,
    DESKTOP_CHANNELS.runtimeRetry,
    DESKTOP_CHANNELS.workspaceSelect,
  ];

  ipcMain.handle(DESKTOP_CHANNELS.authStatus, (event) => {
    requireTrustedSender(event, window);
    return success(DesktopAuthStatusSchema.parse(auth.getStatus()));
  });
  ipcMain.handle(DESKTOP_CHANNELS.authLogin, async (event) => {
    requireTrustedSender(event, window);
    return settle(() => auth.startLogin());
  });
  ipcMain.handle(DESKTOP_CHANNELS.authLogout, async (event) => {
    requireTrustedSender(event, window);
    return settle(() => auth.logout());
  });
  ipcMain.handle(DESKTOP_CHANNELS.runtimeRequest, async (event, value: unknown) => {
    requireTrustedSender(event, window);
    return settle(async () => {
      const frame = parseRendererRequest(value);
      return dispatchRuntimeRequest(runtime, frame);
    });
  });
  ipcMain.handle(DESKTOP_CHANNELS.runtimeStatus, (event) => {
    requireTrustedSender(event, window);
    return success(runtime.getStatus());
  });
  ipcMain.handle(DESKTOP_CHANNELS.runtimeRetry, async (event) => {
    requireTrustedSender(event, window);
    return settle(() => runtime.retry());
  });
  ipcMain.handle(DESKTOP_CHANNELS.workspaceSelect, async (event) => {
    requireTrustedSender(event, window);
    return settle(async () => {
      const selection = await dialog.showOpenDialog(window, {
        title: "选择工作空间",
        properties: ["openDirectory"],
      });
      const directoryPath = selection.filePaths[0];
      if (selection.canceled || !directoryPath) {
        return runtime.request("workspace.get", {});
      }
      return runtime.request("workspace.configure", { directoryPath });
    });
  });

  const removeRuntimeEvent = runtime.onEvent((frame) => {
    if (window.isDestroyed() || frame.event !== "agent.event") return;
    window.webContents.send(DESKTOP_CHANNELS.runtimeEvent, frame.payload);
  });
  const removeRuntimeStatus = runtime.onStatus((status) => {
    if (window.isDestroyed()) return;
    window.webContents.send(DESKTOP_CHANNELS.runtimeEvent, status);
  });
  const removeAuthStatus = auth.onStatus((status) => {
    if (window.isDestroyed()) return;
    window.webContents.send(DESKTOP_CHANNELS.authEvent, status);
  });

  return () => {
    for (const channel of handlers) ipcMain.removeHandler(channel);
    removeRuntimeEvent();
    removeRuntimeStatus();
    removeAuthStatus();
  };
}

function parseRendererRequest(value: unknown): DesktopIpcRequestFrame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Desktop request must be an object");
  }
  const record = value as Record<string, unknown>;
  const frame = parseDesktopIpcFrame({
    protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
    kind: "request",
    requestId: `renderer_${randomUUID()}`,
    method: record.method,
    payload: record.payload,
  });
  if (frame.kind !== "request") {
    throw new BeecodeError(ErrorCodes.INVALID_REQUEST, "Desktop request was invalid");
  }
  return frame;
}

function dispatchRuntimeRequest(runtime: RuntimeSupervisor, frame: DesktopIpcRequestFrame): Promise<unknown> {
  switch (frame.method) {
    case "session.create":
      return runtime.request(frame.method, frame.payload);
    case "session.list":
      return runtime.request(frame.method, frame.payload);
    case "session.getSnapshot":
      return runtime.request(frame.method, frame.payload);
    case "session.update":
      return runtime.request(frame.method, frame.payload);
    case "session.subscribe":
      return runtime.request(frame.method, frame.payload);
    case "session.unsubscribe":
      return runtime.request(frame.method, frame.payload);
    case "turn.submit":
      return runtime.request(frame.method, frame.payload);
    case "turn.cancel":
      return runtime.request(frame.method, frame.payload);
    case "runtime.getCapabilities":
      return runtime.request(frame.method, frame.payload);
    case "workspace.get":
      return runtime.request(frame.method, frame.payload);
    case "workspace.configure":
      return runtime.request(frame.method, frame.payload);
    case "workspace.clear":
      return runtime.request(frame.method, frame.payload);
  }
}

function requireTrustedSender(event: IpcMainInvokeEvent, window: BrowserWindow): void {
  if (window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new BeecodeError(ErrorCodes.FORBIDDEN, "Desktop IPC sender is not trusted");
  }
  const senderUrl = new URL(event.senderFrame.url);
  if (senderUrl.protocol !== "file:" && senderUrl.hostname !== "127.0.0.1" && senderUrl.hostname !== "localhost") {
    throw new BeecodeError(ErrorCodes.FORBIDDEN, "Desktop IPC origin is not trusted");
  }
}

async function settle<TValue>(operation: () => Promise<TValue>): Promise<
  { ok: true; value: TValue } | { ok: false; error: ReturnType<BeecodeError["toShape"]> }
> {
  try {
    return success(await operation());
  } catch (error: unknown) {
    const normalized = error instanceof BeecodeError
      ? error
      : new BeecodeError(ErrorCodes.INTERNAL, "Desktop operation failed");
    return { ok: false, error: normalized.toShape() };
  }
}

function success<TValue>(value: TValue): { ok: true; value: TValue } {
  return { ok: true, value };
}
