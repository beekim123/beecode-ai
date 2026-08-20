import { contextBridge, ipcRenderer } from "electron";
import {
  DESKTOP_CHANNELS,
  desktopResultParsers,
  parseRendererResponse,
  type DesktopApi,
} from "./api.js";

async function invoke(channel: string, value?: unknown): Promise<unknown> {
  return parseRendererResponse(await ipcRenderer.invoke(channel, value));
}

async function runtimeRequest(method: string, payload: unknown): Promise<unknown> {
  return invoke(DESKTOP_CHANNELS.runtimeRequest, { method, payload });
}

const api: DesktopApi = {
  auth: {
    async getStatus() {
      return desktopResultParsers.authStatus(await invoke(DESKTOP_CHANNELS.authStatus));
    },
    async login() {
      return desktopResultParsers.authStatus(await invoke(DESKTOP_CHANNELS.authLogin));
    },
    async logout() {
      return desktopResultParsers.authStatus(await invoke(DESKTOP_CHANNELS.authLogout));
    },
    onStatus(listener) {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        listener(desktopResultParsers.authStatus(value));
      };
      ipcRenderer.on(DESKTOP_CHANNELS.authEvent, handler);
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.authEvent, handler);
    },
  },
  runtime: {
    async getStatus() {
      return desktopResultParsers.runtimeStatus(await invoke(DESKTOP_CHANNELS.runtimeStatus));
    },
    async createSession(title) {
      return desktopResultParsers.createSession(
        await runtimeRequest("session.create", { ...(title ? { title } : {}) }),
      );
    },
    async listSessions() {
      return desktopResultParsers.listSessions(await runtimeRequest("session.list", {}));
    },
    async getSessionSnapshot(sessionId) {
      return desktopResultParsers.getSessionSnapshot(
        await runtimeRequest("session.getSnapshot", { sessionId }),
      );
    },
    async updateSession(input) {
      return desktopResultParsers.updateSession(
        await runtimeRequest("session.update", input),
      );
    },
    async subscribe(sessionId) {
      await runtimeRequest("session.subscribe", { sessionId });
    },
    async unsubscribe(sessionId) {
      await runtimeRequest("session.unsubscribe", { sessionId });
    },
    async submitMessage(sessionId, text) {
      return desktopResultParsers.submitMessage(
        await runtimeRequest("turn.submit", { sessionId, text }),
      );
    },
    async cancelTurn(sessionId, turnId) {
      await runtimeRequest("turn.cancel", { sessionId, turnId });
    },
    async getCapabilities() {
      return desktopResultParsers.getCapabilities(
        await runtimeRequest("runtime.getCapabilities", {}),
      );
    },
    async retry() {
      return desktopResultParsers.runtimeStatus(await invoke(DESKTOP_CHANNELS.runtimeRetry));
    },
    onEvent(listener) {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        try {
          listener(desktopResultParsers.agentEvent(value));
        } catch {
          // Invalid events never enter Renderer state.
        }
      };
      ipcRenderer.on(DESKTOP_CHANNELS.runtimeEvent, handler);
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.runtimeEvent, handler);
    },
    onStatus(listener) {
      const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
        try {
          listener(desktopResultParsers.runtimeStatus(value));
        } catch {
          // Agent events share the channel and are intentionally ignored here.
        }
      };
      ipcRenderer.on(DESKTOP_CHANNELS.runtimeEvent, handler);
      return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.runtimeEvent, handler);
    },
  },
  workspace: {
    async get() {
      return desktopResultParsers.optionalWorkspace(
        await runtimeRequest("workspace.get", {}),
      );
    },
    async select() {
      return desktopResultParsers.optionalWorkspace(
        await invoke(DESKTOP_CHANNELS.workspaceSelect),
      );
    },
    async clear() {
      await runtimeRequest("workspace.clear", {});
    },
  },
};

contextBridge.exposeInMainWorld("beecode", api);
