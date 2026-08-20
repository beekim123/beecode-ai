import { createHash, randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const calculatorAnswer = /^\s*1\s*\+\s*1\s*=\s*2\s*$/;
const backendUrl = `http://127.0.0.1:${process.env.BEECODE_E2E_BACKEND_PORT ?? "8787"}`;
const webUrl = `http://127.0.0.1:${process.env.BEECODE_E2E_WEB_PORT ?? "5173"}`;

test("reads one requested browser Workspace file without uploading the directory", async ({ page }) => {
  await page.addInitScript(() => {
    const fileHandle = {
      kind: "file",
      name: "README.md",
      getFile: () => Promise.resolve(new File(["browser workspace e2e"], "README.md")),
    };
    const directoryHandle = {
      kind: "directory",
      name: "e2e-project",
      values: () => (async function* () { yield fileHandle; })(),
      getDirectoryHandle: () => Promise.reject(new DOMException("Not found", "NotFoundError")),
      getFileHandle: (name: string) => name === "README.md"
        ? Promise.resolve(fileHandle)
        : Promise.reject(new DOMException("Not found", "NotFoundError")),
    };
    Object.defineProperty(window, "showDirectoryPicker", {
      configurable: true,
      value: () => Promise.resolve(directoryHandle),
    });
  });
  await login(page);
  const consoleProblems = monitorConsoleProblems(page);
  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page).toHaveURL(/\/app\/session\/[^/]+$/);

  let turnBody: Record<string, unknown> | undefined;
  let toolResultBody: Record<string, unknown> | undefined;
  await page.route("**/v1/web/sessions/*/turns", async (route) => {
    if (route.request().method() === "POST") turnBody = route.request().postDataJSON();
    await route.continue();
  });
  await page.route("**/v1/web/sessions/*/turns/*/tool-calls/*/result", async (route) => {
    toolResultBody = route.request().postDataJSON();
    await route.continue();
  });

  await page.getByRole("button", { name: "添加工作空间" }).click();
  await expect(page.getByRole("status", { name: "当前工作空间" })).toContainText("e2e-project");
  await page.getByRole("textbox", { name: "给 Beecode 发送消息" }).fill("读取 README.md");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByRole("button", { name: "查看 read_file 详情" })).toContainText("已完成");
  await expect(
    page.locator('[data-message-role="tool"]').getByText(/browser workspace e2e/),
  ).toBeVisible();
  expect(turnBody).toMatchObject({
    text: "读取 README.md",
    workspace: { id: expect.stringMatching(/^browser_workspace_/), name: "e2e-project" },
  });
  expect(Object.keys(turnBody?.workspace as Record<string, unknown>)).toEqual(["id", "name"]);
  expect(JSON.stringify(turnBody)).not.toContain("browser workspace e2e");
  expect(JSON.stringify(toolResultBody)).toContain("browser workspace e2e");
  expect(consoleProblems).toEqual([]);
});

test("runs calculator, restores after refresh, and shares the account across browsers", async ({
  browser,
  page,
}, testInfo) => {
  await login(page);
  const consoleErrors = monitorConsoleProblems(page);

  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page).toHaveURL(/\/app\/session\/[^/]+$/);
  const sessionUrl = page.url();
  const sessionId = decodeURIComponent(new URL(sessionUrl).pathname.split("/").at(-1) ?? "");

  const workspaceBox = await page.getByRole("button", { name: "添加工作空间" }).boundingBox();
  const composerBox = await page.getByRole("textbox", { name: "给 Beecode 发送消息" }).boundingBox();
  if (!workspaceBox || !composerBox) throw new Error("Workspace and composer must be measurable");
  expect(workspaceBox.y + workspaceBox.height).toBeLessThanOrEqual(composerBox.y);

  await page.getByRole("textbox", { name: "给 Beecode 发送消息" }).fill("计算 1+1");
  await page.getByRole("button", { name: "发送消息" }).click();

  await expect(page.getByRole("button", { name: "查看 calculator 详情" })).toContainText(
    "已完成",
  );
  await expect(page.getByText(calculatorAnswer)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("calculator-desktop.png"), fullPage: true });

  await page.reload();
  await expect(page.getByText(calculatorAnswer)).toBeVisible();
  await expect(page.getByRole("button", { name: "查看 calculator 详情" })).toContainText("2");

  const secondContext = await browser.newContext();
  try {
    const secondPage = await secondContext.newPage();
    await login(secondPage);
    const secondConsoleErrors = monitorConsoleProblems(secondPage);
    await secondPage.goto(sessionUrl);
    await expect(secondPage.getByText(calculatorAnswer)).toBeVisible();
    expect(secondConsoleErrors).toEqual([]);
  } finally {
    await secondContext.close();
  }

  const accessToken = await authorizeCliForCurrentAccount(page.context());
  const cliRead = await page.context().request.get(`/v1/cli/sessions/${sessionId}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(cliRead.status()).toBe(404);
  expect(consoleErrors).toEqual([]);
});

test("shows the sent message and backend activity before a slow turn request resolves", async ({ page }, testInfo) => {
  await login(page);
  const consoleProblems = monitorConsoleProblems(page);
  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page).toHaveURL(/\/app\/session\/[^/]+$/);

  let releaseTurnRequest = (): void => undefined;
  const turnRequestGate = new Promise<void>((resolve) => {
    releaseTurnRequest = resolve;
  });
  await page.route("**/v1/web/sessions/*/turns", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await turnRequestGate;
    await route.continue();
  });

  const messageText = "UX regression: show this before the backend responds";
  const composer = page.getByRole("textbox", { name: "给 Beecode 发送消息" });
  try {
    await composer.fill(messageText);
    await page.getByRole("button", { name: "发送消息" }).click();

    const optimisticMessage = page
      .locator('[data-message-role="user"]')
      .filter({ hasText: messageText });
    await expect(composer).toHaveValue("");
    await expect(optimisticMessage).toBeVisible();
    await expect(optimisticMessage).toHaveClass(/pending/);
    await expect(page.getByRole("status", { name: "Beecode 运行状态" })).toContainText(
      "正在发送消息",
    );
    await expect(page.getByRole("button", { name: "正在发送消息" })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("optimistic-message.png"), fullPage: true });

    releaseTurnRequest();
    await expect(optimisticMessage).not.toHaveClass(/pending/);
    await expect(page.locator('[data-message-role="assistant"]').last()).toBeVisible({ timeout: 30_000 });

    const userBox = await optimisticMessage.boundingBox();
    const assistantBox = await page.locator('[data-message-role="assistant"]').last().boundingBox();
    if (!userBox || !assistantBox) throw new Error("Conversation messages must have measurable layouts");
    expect(userBox.x).toBeGreaterThan(assistantBox.x);
    expect(consoleProblems).toEqual([]);
  } finally {
    releaseTurnRequest();
  }
});

test("keeps archive in the session menu and explains that history is retained", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page).toHaveURL(/\/app\/session\/[^/]+$/);
  await expect(page.getByRole("button", { name: "归档会话" })).toHaveCount(0);

  const sessionActions = page.getByRole("button", { name: "新会话的操作" }).first();
  await expect(sessionActions).toHaveAttribute("data-tooltip", "会话操作");
  await sessionActions.click();
  await page.getByRole("menuitem", { name: "归档会话" }).click();

  const dialog = page.getByRole("dialog", { name: "归档“新会话”？" });
  await expect(dialog).toContainText("归档不会删除对话");
  await dialog.getByRole("button", { name: "保留会话" }).click();
  await expect(dialog).toBeHidden();
});

test("routes a direct CLI authorization request through Web login and consent", async ({ page }) => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = new URL("/oauth/authorize", backendUrl);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: "beecode-cli",
    redirect_uri: "http://127.0.0.1:49152/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: randomBytes(16).toString("base64url"),
  }).toString();

  await page.goto(authorize.toString());
  await expect(page).toHaveURL((url) => url.origin === webUrl && url.pathname === "/login");
  await page.getByRole("link", { name: "使用开发账号登录" }).click();
  await expect(page).toHaveURL((url) => url.origin === webUrl && url.pathname === "/oauth/authorize");
  await expect(page.getByRole("heading", { name: /授权此命令行客户端？|Authorize this CLI\?/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /授权|Authorize/ })).toBeVisible();
});

test.describe("mobile workspace", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("uses a non-overflowing session drawer and supports dark mode", async ({ page }, testInfo) => {
    await login(page);
    const consoleErrors = monitorConsoleProblems(page);

    await page.getByRole("button", { name: "打开会话侧栏" }).click();
    const sidebar = page.getByRole("complementary", { name: "会话侧栏" });
    await expect(sidebar).toBeVisible();
    await expect.poll(async () => sidebar.evaluate((element) => element.getBoundingClientRect().x)).toBe(0);
    await sidebar.getByRole("button", { name: "关闭会话侧栏" }).click();
    await expect.poll(async () => sidebar.evaluate((element) => element.getBoundingClientRect().right)).toBeLessThan(0);

    const widths = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    expect(widths.document).toBe(widths.viewport);
    expect(widths.body).toBe(widths.viewport);

    await page.goto("/settings/account");
    await page.getByRole("button", { name: "切换为深色主题" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.screenshot({ path: testInfo.outputPath("account-mobile-dark.png"), fullPage: true });
    expect(consoleErrors).toEqual([]);
  });
});

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  const login = page.getByRole("link", { name: "使用开发账号登录" });
  if (!/\/app(?:\/|$)/.test(new URL(page.url()).pathname)) {
    await expect(login).toBeVisible();
    await login.click();
  }
  await expect(page).toHaveURL(/\/app(?:\/|$)/);
  await expect(page.getByRole("main")).toBeVisible();
}

async function authorizeCliForCurrentAccount(context: BrowserContext): Promise<string> {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = "http://127.0.0.1:49152/callback";
  const state = randomBytes(16).toString("base64url");
  const authorize = await context.request.post("/oauth/authorize", {
    form: {
      client_id: "beecode-cli",
      redirect_uri: redirectUri,
      code_challenge: challenge,
      state,
      decision: "allow",
    },
    headers: { origin: webUrl },
    maxRedirects: 0,
  });
  expect(authorize.status()).toBe(302);
  const callback = new URL(authorize.headers().location ?? "");
  expect(callback.searchParams.get("state")).toBe(state);

  const token = await context.request.post("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") ?? "",
      client_id: "beecode-cli",
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
  });
  expect(token.ok()).toBe(true);
  const body = (await token.json()) as { access_token: string };
  return body.access_token;
}

function monitorConsoleProblems(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      errors.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
