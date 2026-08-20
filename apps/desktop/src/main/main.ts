import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { AuthManager } from "./auth-manager.js";
import { CredentialStore } from "./credential-store.js";
import { registerDesktopIpc } from "./ipc.js";
import { RuntimeMetadataStore } from "./runtime-metadata.js";
import { RuntimeSupervisor } from "./runtime-supervisor.js";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const DESKTOP_SCHEME = "ai.beecode.desktop";
const backendUrl = process.env.BEECODE_BACKEND_URL ?? "http://127.0.0.1:8787";
const singleInstance = app.requestSingleInstanceLock();

if (!singleInstance) {
  app.quit();
} else {
  void startDesktop();
}

async function startDesktop(): Promise<void> {
  let mainWindow: BrowserWindow | undefined;
  let auth: AuthManager | undefined;
  let runtime: RuntimeSupervisor | undefined;
  let removeIpc: (() => void) | undefined;
  let quitting = false;
  const pendingDeepLinks: string[] = [];

  const acceptDeepLink = (value: string): void => {
    if (!value.startsWith(`${DESKTOP_SCHEME}://`)) return;
    if (auth) void auth.handleCallback(value);
    else pendingDeepLinks.push(value);
  };

  app.on("open-url", (event, url) => {
    event.preventDefault();
    acceptDeepLink(url);
  });
  app.on("second-instance", (_event, commandLine) => {
    const deepLink = commandLine.find((argument) => argument.startsWith(`${DESKTOP_SCHEME}://`));
    if (deepLink) acceptDeepLink(deepLink);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  await app.whenReady();
  app.setAsDefaultProtocolClient(DESKTOP_SCHEME);

  const credentials = new CredentialStore(join(app.getPath("userData"), "credentials.v1"));
  const metadata = new RuntimeMetadataStore(join(app.getPath("userData"), "runtime-metadata.json"));
  auth = new AuthManager({
    backendUrl,
    credentials,
    openExternal: (url) => shell.openExternal(url),
  });
  runtime = new RuntimeSupervisor({
    entryPoint: join(__dirname, "runtime.js"),
    backendUrl,
    appVersion: app.getVersion(),
    getAccessToken: () => auth?.getAccessToken() ?? Promise.resolve(undefined),
    getLastRuntimeId: () => metadata.loadLastRuntimeId(),
    saveLastRuntimeId: (runtimeId) => metadata.saveLastRuntimeId(runtimeId),
  });

  await auth.initialize();
  mainWindow = createMainWindow();
  // Publish Runtime handshaking before Renderer observes authenticated state.
  const removeAuthRuntimeSync = auth.onStatus((_status, accessToken) => {
    if (runtime?.getStatus().state === "ready") void runtime.updateAuth(accessToken);
  });
  removeIpc = registerDesktopIpc({ window: mainWindow, auth, runtime });
  await runtime.start();
  for (const deepLink of pendingDeepLinks.splice(0)) void auth.handleCallback(deepLink);

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      removeIpc?.();
      if (auth && runtime) removeIpc = registerDesktopIpc({ window: mainWindow, auth, runtime });
    } else {
      mainWindow.show();
    }
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    removeIpc?.();
    removeAuthRuntimeSync();
    void runtime?.stop().finally(() => app.quit());
  });
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: "#f6f7f8",
    title: "Beecode",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const current = window.webContents.getURL();
    if (current && new URL(url).origin !== new URL(current).origin) event.preventDefault();
  });
  window.once("ready-to-show", () => window.show());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
  return window;
}
