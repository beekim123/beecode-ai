import { createRefreshingFetch, ensureFreshCredentials } from "./auth/authenticated-fetch.js";
import { loginWithBrowser, revokeRefreshToken } from "./auth/browser-login.js";
import { FileCredentialStore } from "./auth/credential-store.js";
import { DEFAULT_BACKEND_URL } from "./config.js";
import { composeCli } from "./compose.js";
import { runRepl } from "./repl.js";
import { LocalWorkspaceSource } from "@beecode/tools";

async function main(argv: string[]): Promise<void> {
  const command = argv[2];
  const backendUrl = (process.env.BEECODE_BACKEND_URL ?? DEFAULT_BACKEND_URL).replace(/\/$/, "");
  const credentialStore = new FileCredentialStore();

  switch (command) {
    case "login":
      if (argv[3] === "--dev") await developmentLogin(backendUrl, credentialStore);
      else
        await loginWithBrowser({
          backendUrl,
          credentialStore,
          output: process.stdout,
          signal: abortSignalFromProcess(),
        });
      process.stdout.write(
        "Credential storage: local secure-file fallback (0700 directory, 0600 file).\n",
      );
      return;
    case "logout":
      await logout(backendUrl, credentialStore);
      return;
    case "whoami":
      await whoAmI(backendUrl, credentialStore);
      return;
    case "chat":
      await chat(backendUrl, credentialStore, parseWorkspacePath(argv.slice(3)));
      return;
    case "--workspace":
      await chat(backendUrl, credentialStore, requireWorkspacePath(argv[3], argv.slice(4)));
      return;
    case undefined:
      await chat(backendUrl, credentialStore, process.env.BEECODE_WORKSPACE);
      return;
    default:
      process.stderr.write(
        `Unknown command: ${command}\nUsage: beecode [chat [--workspace <directory>] | --workspace <directory> | login [--dev] | logout | whoami]\n`,
      );
      process.exitCode = 2;
  }
}

async function developmentLogin(backendUrl: string, credentialStore: FileCredentialStore): Promise<void> {
  const devLoginSecret = process.env.BEECODE_DEV_LOGIN_SECRET;
  const response = await fetch(`${backendUrl}/v1/auth/dev-token`, {
    method: "POST",
    headers: devLoginSecret ? { "x-beecode-dev-secret": devLoginSecret } : undefined,
  });
  if (!response.ok) throw new Error(`Development login failed (HTTP ${response.status})`);
  const body = await parseDevelopmentLogin(response);
  await credentialStore.save({ backendUrl, token: body.token, accountId: body.accountId });
  process.stdout.write(
    `Logged in to ${backendUrl} using development authentication\nAccount: ${body.accountId}\nQuota: ${body.quotaLimitTokens} tokens\n`,
  );
}

async function logout(backendUrl: string, credentialStore: FileCredentialStore): Promise<void> {
  const config = await credentialStore.load();
  if (!config || config.backendUrl !== backendUrl) {
    process.stdout.write("Already logged out.\n");
    return;
  }
  try {
    if (config.refreshToken) {
      await revokeRefreshToken({ backendUrl, refreshToken: config.refreshToken });
    }
  } finally {
    await credentialStore.clear();
  }
  process.stdout.write("Logged out.\n");
}

async function whoAmI(backendUrl: string, credentialStore: FileCredentialStore): Promise<void> {
  const config = await loadCurrentConfig(backendUrl, credentialStore);
  const fresh = await ensureFreshCredentials(config, credentialStore);
  const authenticatedFetch = createRefreshingFetch(fresh, credentialStore);
  const [accountResponse, quotaResponse] = await Promise.all([
    authenticatedFetch(`${backendUrl}/v1/me`),
    authenticatedFetch(`${backendUrl}/v1/quota`),
  ]);
  if (!accountResponse.ok || !quotaResponse.ok) {
    throw new Error(`Unable to load account (HTTP ${accountResponse.status}/${quotaResponse.status})`);
  }
  const account = (await accountResponse.json()) as { accountId: string };
  const quota = (await quotaResponse.json()) as {
    quotaLimitTokens: number;
    quotaUsedTokens: number;
  };
  process.stdout.write(
    `Account: ${account.accountId}\nQuota: ${quota.quotaUsedTokens}/${quota.quotaLimitTokens} tokens\n`,
  );
}

async function chat(
  backendUrl: string,
  credentialStore: FileCredentialStore,
  workspacePath?: string,
): Promise<void> {
  const config = await loadCurrentConfig(backendUrl, credentialStore);
  const fresh = await ensureFreshCredentials(config, credentialStore);
  const authenticatedFetch = createRefreshingFetch(fresh, credentialStore);
  const workspace = workspacePath ? new LocalWorkspaceSource() : undefined;
  const workspaceSummary = workspace && workspacePath
    ? await workspace.configure(workspacePath)
    : undefined;
  const { client } = composeCli({ config: fresh, fetchImpl: authenticatedFetch, workspace });
  await runRepl({
    client,
    input: process.stdin,
    output: process.stdout,
    workspace: workspaceSummary,
  });
}

function parseWorkspacePath(args: string[]): string | undefined {
  if (args.length === 0) return process.env.BEECODE_WORKSPACE;
  if (args[0] !== "--workspace") {
    throw new Error("Usage: beecode chat [--workspace <directory>]");
  }
  return requireWorkspacePath(args[1], args.slice(2));
}

function requireWorkspacePath(path: string | undefined, remaining: string[]): string {
  if (!path || remaining.length > 0) {
    throw new Error("Usage: beecode chat [--workspace <directory>]");
  }
  return path;
}

async function loadCurrentConfig(
  backendUrl: string,
  credentialStore: FileCredentialStore,
) {
  const config = await credentialStore.load();
  if (!config || config.backendUrl !== backendUrl) {
    throw new Error(`Not logged in to ${backendUrl}. Run \`beecode login\` first.`);
  }
  return config;
}

async function parseDevelopmentLogin(response: Response): Promise<{
  token: string;
  accountId: string;
  quotaLimitTokens: number;
}> {
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
  return body as { token: string; accountId: string; quotaLimitTokens: number };
}

function abortSignalFromProcess(): AbortSignal {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  controller.signal.addEventListener("abort", () => process.off("SIGINT", abort), { once: true });
  return controller.signal;
}

void main(process.argv).catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
