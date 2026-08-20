import { once } from "node:events";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FakeProviderAdapter,
  InMemoryBackendStore,
  createBackendServer,
} from "@beecode/backend";
import type { ModelRequest } from "@beecode/protocol";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

const require = createRequire(join(process.cwd(), "package.json"));
const ELECTRON_EXECUTABLE = require("electron") as string;
const DESKTOP_DIRECTORY = process.cwd();

test.describe("compiled Desktop vertical slice", () => {
  let backend: Server;
  let backendUrl: string;
  let oauthTokenRequests = 0;
  let userDataDirectory: string;
  let workspaceDirectory: string;

  test.beforeAll(async () => {
    backend = createBackendServer(
      new InMemoryBackendStore(),
      new E2EProvider(),
      {
        quotaLimitTokens: 100_000,
        accessTokenTtlSeconds: 2,
        publicBaseUrl: "http://api.test",
        webOrigin: "http://web.test",
      },
      {
        log: (record) => {
          if (record.method === "POST" && record.path === "/oauth/token" && record.status === 200) {
            oauthTokenRequests += 1;
          }
        },
      },
    );
    await new Promise<void>((resolve, reject) => {
      backend.once("error", reject);
      backend.listen(0, "127.0.0.1", resolve);
    });
    const address = backend.address();
    if (!address || typeof address === "string") throw new TypeError("Expected a TCP Backend address");
    backendUrl = `http://127.0.0.1:${address.port}`;
    userDataDirectory = await mkdtemp(join(tmpdir(), "beecode-desktop-e2e-"));
    workspaceDirectory = join(userDataDirectory, "workspace");
    await mkdir(workspaceDirectory);
    await writeFile(join(workspaceDirectory, "README.md"), "desktop E2E workspace", "utf8");
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      backend.close((error) => error ? reject(error) : resolve());
    });
    await rm(userDataDirectory, { recursive: true, force: true });
  });

  test("login, calculator, cancellation, and crash recovery", async () => {
    const diagnostics: string[] = [];
    let desktop = await launchDesktop(userDataDirectory, backendUrl);

    try {
      let page = await desktop.firstWindow();
      observePage(page, diagnostics);
      await expectUserDataPath(desktop, userDataDirectory);
      await authenticateIfNeeded(desktop, page, backendUrl);
      await expect(page.locator(".runtime-indicator")).toHaveText("Runtime 可用");
      await expect(page.getByRole("alert")).toHaveCount(0);

      await page.getByRole("button", { name: "新建会话" }).first().click();
      await expect(page.getByRole("textbox", { name: "消息" })).toBeEnabled();

      await page.getByRole("textbox", { name: "消息" }).fill("计算 1+1");
      await page.getByRole("button", { name: "发送" }).click();
      await expect(page.locator(".tool-call")).toContainText("calculator");
      await expect(page.locator(".tool-result")).toContainText('"value": 2');
      await expect(page.locator(".message.assistant p")).toContainText("1+1 = 2");
      await expect.poll(async () => (await latestTurn(page))?.status).toBe("completed");

      await desktop.evaluate(({ dialog }, directoryPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directoryPath] });
      }, workspaceDirectory);
      await expect.poll(async () => {
        const workspaceBox = await page.getByRole("button", { name: "添加工作空间" }).boundingBox();
        const composerBox = await page.getByRole("textbox", { name: "消息" }).boundingBox();
        return Boolean(
          workspaceBox && composerBox && workspaceBox.y + workspaceBox.height <= composerBox.y,
        );
      }).toBe(true);
      await page.getByRole("button", { name: "添加工作空间" }).click();
      await expect(page.getByRole("status", { name: "当前工作空间" })).toContainText("workspace");
      await expect(page.getByRole("status", { name: "当前工作空间" })).toContainText("1 files");

      await page.getByRole("textbox", { name: "消息" }).fill("读取 README.md");
      await page.getByRole("button", { name: "发送" }).click();
      await expect(page.locator(".tool-call").filter({ hasText: "read_file" })).toBeVisible();
      await expect(page.locator(".tool-result").filter({ hasText: "read_file result" }))
        .toContainText("desktop E2E workspace");
      await expect.poll(async () => (await latestTurn(page))?.status).toBe("completed");
      await page.getByRole("button", { name: "移除工作空间" }).click();
      await expect(page.getByRole("status", { name: "当前工作空间" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "添加工作空间" })).toBeVisible();

      const longMessage = Array.from(
        { length: 80 },
        (_, index) => `历史消息第 ${index + 1} 行，用于验证聊天记录的独立滚动区域。`,
      ).join("\n");
      await page.getByRole("textbox", { name: "消息" }).fill(longMessage);
      await page.getByRole("button", { name: "发送" }).click();
      await expect.poll(async () => (await latestTurn(page))?.status).toBe("completed");
      const scrollMetrics = await page.evaluate(() => {
        const feed = document.querySelector<HTMLElement>(".message-feed");
        if (!feed) throw new TypeError("Expected the message feed");
        window.scrollTo(0, 1_000);
        return {
          documentScrollTop: window.scrollY,
          feedScrollTop: feed.scrollTop,
          feedScrollHeight: feed.scrollHeight,
          feedClientHeight: feed.clientHeight,
          distanceFromLatest: feed.scrollHeight - feed.scrollTop - feed.clientHeight,
        };
      });
      expect(scrollMetrics.documentScrollTop).toBe(0);
      expect(scrollMetrics.feedScrollHeight).toBeGreaterThan(scrollMetrics.feedClientHeight);
      expect(scrollMetrics.feedScrollTop).toBeGreaterThan(0);
      expect(scrollMetrics.distanceFromLatest).toBeLessThan(2);
      await expect(page.getByRole("alert")).toHaveCount(0);

      await page.getByRole("textbox", { name: "消息" }).fill("等待取消");
      await page.getByRole("button", { name: "发送" }).click();
      await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
      await page.getByRole("button", { name: "取消" }).click();
      await expect.poll(async () => (await latestTurn(page))?.status).toBe("cancelled");

      await page.getByRole("textbox", { name: "消息" }).fill("保持运行直到崩溃");
      await page.getByRole("button", { name: "发送" }).click();
      await expect(page.getByRole("button", { name: "取消" })).toBeVisible();
      await expect.poll(async () => (await latestTurn(page))?.status).toMatch(
        /^(queued|running|model_streaming|tool_running)$/,
      );

      const crashedProcess = desktop.process();
      const exited = once(crashedProcess, "exit");
      crashedProcess.kill("SIGKILL");
      await exited;

      desktop = await launchDesktop(userDataDirectory, backendUrl);
      page = await desktop.firstWindow();
      observePage(page, diagnostics);
      await authenticateIfNeeded(desktop, page, backendUrl);
      await expect(page.locator(".runtime-indicator")).toHaveText("Runtime 可用");
      await expect.poll(async () => (await latestTurn(page))?.status).toBe("failed");
      await expect.poll(async () => (await latestTurn(page))?.error?.code).toBe(
        "RUNTIME_INTERRUPTED",
      );

      await page.reload();
      await expect(page.locator(".tool-result").filter({ hasText: "calculator result" }))
        .toContainText('"value": 2');
      await expect.poll(() => oauthTokenRequests).toBeGreaterThan(1);
      expect(diagnostics).toEqual([]);
    } finally {
      await desktop.close().catch(() => undefined);
    }
  });
});

class E2EProvider extends FakeProviderAdapter {
  override async *stream(request: ModelRequest, signal: AbortSignal) {
    const lastMessage = request.messages.at(-1);
    if (lastMessage?.role === "user" && lastMessage.content.includes("README.md")) {
      yield {
        type: "tool_call" as const,
        toolCall: { id: "tc_desktop_read_file", name: "read_file", input: { path: "README.md" } },
      };
      yield { type: "finish" as const, reason: "tool_calls" as const };
      return;
    }
    if (
      lastMessage?.role === "user" &&
      (lastMessage.content.includes("等待取消") || lastMessage.content.includes("保持运行"))
    ) {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true });
        if (signal.aborted) resolve();
      });
      return;
    }
    yield* super.stream(request, signal);
  }
}

async function launchDesktop(
  userDataDirectory: string,
  backendUrl: string,
): Promise<ElectronApplication> {
  return electron.launch({
    executablePath: ELECTRON_EXECUTABLE,
    args: [DESKTOP_DIRECTORY, `--user-data-dir=${userDataDirectory}`],
    env: {
      ...launchEnvironment(),
      BEECODE_BACKEND_URL: backendUrl,
    },
  });
}

async function authenticateIfNeeded(
  desktop: ElectronApplication,
  page: Page,
  backendUrl: string,
): Promise<void> {
  const login = page.getByRole("button", { name: "登录", exact: true });
  const authStatus = await page.evaluate(() => window.beecode.auth.getStatus());
  if (authStatus.state === "authenticated") {
    await expect(login).not.toBeVisible();
    return;
  }
  await expect(login).toBeVisible();

  await desktop.evaluate(({ shell }) => {
    const state = globalThis as typeof globalThis & { beecodeOpenedExternalUrl?: string };
    state.beecodeOpenedExternalUrl = undefined;
    shell.openExternal = async (url: string) => {
      state.beecodeOpenedExternalUrl = url;
    };
  });
  await login.click();
  const readAuthorizeUrl = () => desktop.evaluate(() => (
    globalThis as typeof globalThis & { beecodeOpenedExternalUrl?: string }
  ).beecodeOpenedExternalUrl);
  await expect.poll(readAuthorizeUrl).not.toBeUndefined();
  const authorizeUrl = await readAuthorizeUrl();
  if (typeof authorizeUrl !== "string") throw new TypeError("Expected an OAuth authorize URL");

  const callbackUrl = await authorizeDesktop(backendUrl, authorizeUrl);
  await desktop.evaluate(({ app }, value) => {
    app.emit("open-url", { preventDefault() {} } as never, value);
  }, callbackUrl);
  await expect(login).not.toBeVisible();
}

async function authorizeDesktop(backendUrl: string, authorizeUrl: string): Promise<string> {
  const login = await fetch(
    `${backendUrl}/v1/auth/login/development?loginHint=desktop-e2e%40example.test`,
    { redirect: "manual" },
  );
  expect(login.status).toBe(302);
  const identityCallback = login.headers.get("location");
  if (!identityCallback) throw new TypeError("Expected an identity callback URL");
  const callbackLocation = new URL(identityCallback);
  const browserSession = await fetch(
    `${backendUrl}${callbackLocation.pathname}${callbackLocation.search}`,
    { redirect: "manual" },
  );
  expect(browserSession.status).toBe(302);
  const cookie = browserSession.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new TypeError("Expected a browser session cookie");

  const authorization = new URL(authorizeUrl);
  const accepted = await fetch(`${backendUrl}/oauth/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: {
      cookie,
      origin: "http://web.test",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requiredSearchParam(authorization, "client_id"),
      redirect_uri: requiredSearchParam(authorization, "redirect_uri"),
      code_challenge: requiredSearchParam(authorization, "code_challenge"),
      state: requiredSearchParam(authorization, "state"),
      decision: "allow",
    }),
  });
  expect(accepted.status).toBe(302);
  const callbackUrl = accepted.headers.get("location");
  if (!callbackUrl) throw new TypeError("Expected a Desktop OAuth callback URL");
  return callbackUrl;
}

async function latestTurn(page: Page) {
  return page.evaluate(async () => {
    const sessions = await window.beecode.runtime.listSessions();
    const session = sessions.items[0];
    if (!session) return undefined;
    const snapshot = await window.beecode.runtime.getSessionSnapshot(session.id);
    return snapshot.turns.at(-1);
  });
}

async function expectUserDataPath(
  desktop: ElectronApplication,
  expectedPath: string,
): Promise<void> {
  const actualPath = await desktop.evaluate(({ app }) => app.getPath("userData"));
  expect(await realpath(actualPath)).toBe(await realpath(expectedPath));
}

function observePage(page: Page, diagnostics: string[]): void {
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      diagnostics.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
}

function requiredSearchParam(url: URL, name: string): string {
  const value = url.searchParams.get(name);
  if (!value) throw new TypeError(`Expected OAuth ${name}`);
  return value;
}

function launchEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}
