import { DEFAULT_BACKEND_URL, loadConfig, saveConfig } from "./config.js";
import { composeCli } from "./compose.js";
import { runRepl } from "./repl.js";

/**
 * beecode CLI 入口：
 *   beecode login   通过后端开发令牌建立身份
 *   beecode         打开最近 Session 或创建新 Session，进入交互模式
 */
async function main(argv: string[]): Promise<void> {
  const command = argv[2];
  const backendUrl = process.env.BEECODE_BACKEND_URL ?? DEFAULT_BACKEND_URL;

  if (command === "login") {
    await login(backendUrl);
    return;
  }
  if (command === undefined) {
    await chat(backendUrl);
    return;
  }
  process.stderr.write(`Unknown command: ${command}\nUsage: beecode [login]\n`);
  process.exitCode = 2;
}

async function login(backendUrl: string): Promise<void> {
  let response: Response;
  try {
    const devLoginSecret = process.env.BEECODE_DEV_LOGIN_SECRET;
    response = await fetch(`${backendUrl}/v1/auth/dev-token`, {
      method: "POST",
      headers: devLoginSecret ? { "x-beecode-dev-secret": devLoginSecret } : undefined,
    });
  } catch {
    process.stderr.write(`Cannot reach Beecode backend at ${backendUrl}. Is it running?\n`);
    process.exitCode = 1;
    return;
  }
  if (!response.ok) {
    process.stderr.write(`Login failed (HTTP ${response.status})\n`);
    process.exitCode = 1;
    return;
  }
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Login response is invalid");
  }
  const body = value as Record<string, unknown>;
  if (
    typeof body.token !== "string" ||
    typeof body.accountId !== "string" ||
    !Number.isInteger(body.quotaLimitTokens)
  ) {
    throw new Error("Login response is invalid");
  }
  await saveConfig({ backendUrl, token: body.token, accountId: body.accountId });
  process.stdout.write(
    `Logged in to ${backendUrl}\nAccount: ${body.accountId}\nQuota: ${body.quotaLimitTokens} tokens\n`,
  );
}

async function chat(backendUrl: string): Promise<void> {
  const config = await loadConfig();
  if (!config || config.backendUrl !== backendUrl) {
    process.stderr.write(`Not logged in to ${backendUrl}. Run \`beecode login\` first.\n`);
    process.exitCode = 1;
    return;
  }
  const { client } = composeCli({ config });
  await runRepl({ client, input: process.stdin, output: process.stdout });
}

void main(process.argv).catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
