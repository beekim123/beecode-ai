import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderAdapter } from "./provider/adapter.js";
import { FakeProviderAdapter } from "./provider/fake.js";
import { AnthropicProviderAdapter } from "./provider/anthropic.js";
import { OpenAiProviderAdapter } from "./provider/openai.js";

export interface BackendConfig {
  host: string;
  port: number;
  quotaLimitTokens: number;
  provider: "fake" | "anthropic" | "openai";
  webOrigin: string;
  publicBaseUrl: string;
  iosOAuthRedirectUri: string;
  cookieSecure: boolean;
  devAuthEnabled: boolean;
  browserSessionTtlSeconds: number;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  maxConcurrentWebTurnsPerAccount: number;
  maxConcurrentIOSTurnsPerAccount: number;
  devLoginSecret?: string;
  anthropicApiKey?: string;
  anthropicModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl?: string;
  dataFile?: string;
}

export type BackendConfigFile = Partial<BackendConfig>;

export function createProvider(config: BackendConfig): ProviderAdapter {
  if (config.provider === "anthropic") {
    if (!config.anthropicApiKey) {
      throw new Error("BEECODE_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
    }
    return new AnthropicProviderAdapter({ apiKey: config.anthropicApiKey, model: config.anthropicModel });
  }
  if (config.provider === "openai") {
    if (!config.openaiApiKey || !config.openaiModel) {
      throw new Error("BEECODE_PROVIDER=openai requires OPENAI_API_KEY and OPENAI_MODEL");
    }
    return new OpenAiProviderAdapter({
      apiKey: config.openaiApiKey,
      model: config.openaiModel,
      baseUrl: config.openaiBaseUrl,
    });
  }
  return new FakeProviderAdapter();
}

const projectConfigFileName = "backend-config.json";

/**
 * 配置文件路径的解析顺序：BEECODE_BACKEND_CONFIG > 项目根目录的
 * backend-config.json（向上查找 pnpm-workspace.yaml 定位项目根）>
 * ~/.beecode/backend-config.json。
 */
export async function resolveBackendConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  startDirectory: string = process.cwd(),
): Promise<string> {
  if (env.BEECODE_BACKEND_CONFIG) {
    return env.BEECODE_BACKEND_CONFIG;
  }
  const projectPath = join(await findProjectRoot(startDirectory), projectConfigFileName);
  if (await fileExists(projectPath)) {
    return projectPath;
  }
  return join(homedir(), ".beecode", "backend-config.json");
}

/**
 * Resolves the backend config from the JSON config file and environment.
 * Environment variables override file values; a missing file is not an error.
 */
export async function loadBackendConfig(
  env: NodeJS.ProcessEnv = process.env,
  configPath?: string,
): Promise<BackendConfig> {
  const fileConfig = await readBackendConfigFile(configPath ?? (await resolveBackendConfigPath(env)));
  return resolveConfig(fileConfig, env);
}

async function findProjectRoot(startDirectory: string): Promise<string> {
  let directory = startDirectory;
  for (;;) {
    if (await fileExists(join(directory, "pnpm-workspace.yaml"))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return startDirectory;
    }
    directory = parent;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readBackendConfigFile(configPath: string): Promise<BackendConfigFile> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch (error: unknown) {
    if (isErrorWithCode(error) && error.code === "ENOENT") {
      return {};
    }
    throw new Error(`Unable to read backend config file ${configPath}`, { cause: error });
  }
  return parseBackendConfigFile(raw, configPath);
}

export function parseBackendConfigFile(raw: string, source: string): BackendConfigFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Backend config file ${source} is not valid JSON`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Backend config file ${source} must contain a JSON object`);
  }

  const config: BackendConfigFile = {};
  for (const [key, value] of Object.entries(parsed)) {
    switch (key) {
      case "host":
      case "devLoginSecret":
      case "anthropicApiKey":
      case "anthropicModel":
      case "openaiApiKey":
      case "openaiModel":
      case "openaiBaseUrl":
      case "dataFile":
      case "webOrigin":
      case "publicBaseUrl":
      case "iosOAuthRedirectUri":
        config[key] = expectString(value, key, source);
        break;
      case "cookieSecure":
      case "devAuthEnabled":
        config[key] = expectBoolean(value, key, source);
        break;
      case "port":
        config.port = expectInteger(value, key, source, 1, 65_535);
        break;
      case "quotaLimitTokens":
        config.quotaLimitTokens = expectInteger(value, key, source, 1, Number.MAX_SAFE_INTEGER);
        break;
      case "browserSessionTtlSeconds":
      case "accessTokenTtlSeconds":
      case "refreshTokenTtlSeconds":
      case "authorizationCodeTtlSeconds":
      case "maxConcurrentWebTurnsPerAccount":
      case "maxConcurrentIOSTurnsPerAccount":
        config[key] = expectInteger(value, key, source, 1, Number.MAX_SAFE_INTEGER);
        break;
      case "provider":
        if (value !== "fake" && value !== "anthropic" && value !== "openai") {
          throw new Error(`Backend config file ${source}: provider must be fake, anthropic or openai`);
        }
        config.provider = value;
        break;
      default:
        throw new Error(`Backend config file ${source} contains unknown key "${key}"`);
    }
  }
  return config;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  return resolveConfig({}, env);
}

function resolveConfig(file: BackendConfigFile, env: NodeJS.ProcessEnv): BackendConfig {
  const provider = env.BEECODE_PROVIDER ?? file.provider ?? "fake";
  if (provider !== "fake" && provider !== "anthropic" && provider !== "openai") {
    throw new Error("BEECODE_PROVIDER must be fake, anthropic or openai");
  }
  const host = env.BEECODE_BACKEND_HOST ?? file.host ?? "127.0.0.1";
  const port = parseInteger(env.BEECODE_BACKEND_PORT, file.port ?? 8787, "BEECODE_BACKEND_PORT", 1, 65_535);
  const devLoginSecret = env.BEECODE_DEV_LOGIN_SECRET ?? file.devLoginSecret;
  const devAuthEnabled = parseBoolean(
    env.BEECODE_DEV_AUTH_ENABLED,
    file.devAuthEnabled ?? isLoopbackHost(host),
    "BEECODE_DEV_AUTH_ENABLED",
  );
  if (devAuthEnabled && !isLoopbackHost(host) && !devLoginSecret) {
    throw new Error("BEECODE_DEV_LOGIN_SECRET is required when the backend listens beyond loopback");
  }
  return {
    host,
    port,
    quotaLimitTokens: parseInteger(
      env.BEECODE_QUOTA_LIMIT_TOKENS,
      file.quotaLimitTokens ?? 1_000_000,
      "BEECODE_QUOTA_LIMIT_TOKENS",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    provider,
    webOrigin: parseHttpUrl(env.BEECODE_WEB_ORIGIN ?? file.webOrigin ?? "http://127.0.0.1:5173", "BEECODE_WEB_ORIGIN"),
    publicBaseUrl: parseHttpUrl(
      env.BEECODE_PUBLIC_BASE_URL ?? file.publicBaseUrl ?? `http://${host}:${port}`,
      "BEECODE_PUBLIC_BASE_URL",
    ),
    iosOAuthRedirectUri: parseIOSRedirectUri(
      env.BEECODE_IOS_OAUTH_REDIRECT_URI ??
        file.iosOAuthRedirectUri ??
        "ai.beecode.ios://oauth/callback",
    ),
    cookieSecure: parseBoolean(env.BEECODE_COOKIE_SECURE, file.cookieSecure ?? false, "BEECODE_COOKIE_SECURE"),
    devAuthEnabled,
    browserSessionTtlSeconds: parseInteger(
      env.BEECODE_BROWSER_SESSION_TTL_SECONDS,
      file.browserSessionTtlSeconds ?? 30 * 24 * 60 * 60,
      "BEECODE_BROWSER_SESSION_TTL_SECONDS",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    accessTokenTtlSeconds: parseInteger(
      env.BEECODE_ACCESS_TOKEN_TTL_SECONDS,
      file.accessTokenTtlSeconds ?? 15 * 60,
      "BEECODE_ACCESS_TOKEN_TTL_SECONDS",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    refreshTokenTtlSeconds: parseInteger(
      env.BEECODE_REFRESH_TOKEN_TTL_SECONDS,
      file.refreshTokenTtlSeconds ?? 30 * 24 * 60 * 60,
      "BEECODE_REFRESH_TOKEN_TTL_SECONDS",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    authorizationCodeTtlSeconds: parseInteger(
      env.BEECODE_AUTHORIZATION_CODE_TTL_SECONDS,
      file.authorizationCodeTtlSeconds ?? 5 * 60,
      "BEECODE_AUTHORIZATION_CODE_TTL_SECONDS",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    maxConcurrentWebTurnsPerAccount: parseInteger(
      env.BEECODE_MAX_CONCURRENT_WEB_TURNS_PER_ACCOUNT,
      file.maxConcurrentWebTurnsPerAccount ?? 4,
      "BEECODE_MAX_CONCURRENT_WEB_TURNS_PER_ACCOUNT",
      1,
      100,
    ),
    maxConcurrentIOSTurnsPerAccount: parseInteger(
      env.BEECODE_MAX_CONCURRENT_IOS_TURNS_PER_ACCOUNT,
      file.maxConcurrentIOSTurnsPerAccount ?? 4,
      "BEECODE_MAX_CONCURRENT_IOS_TURNS_PER_ACCOUNT",
      1,
      100,
    ),
    devLoginSecret,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? file.anthropicApiKey,
    anthropicModel: env.ANTHROPIC_MODEL ?? file.anthropicModel,
    openaiApiKey: env.OPENAI_API_KEY ?? file.openaiApiKey,
    openaiModel: env.OPENAI_MODEL ?? file.openaiModel,
    openaiBaseUrl: env.OPENAI_BASE_URL ?? file.openaiBaseUrl,
    dataFile: env.BEECODE_BACKEND_DATA ?? file.dataFile,
  };
}

function parseBoolean(raw: string | undefined, fallback: boolean, name: string): boolean {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseHttpUrl(value: string, name: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.toString().replace(/\/$/, "");
}

function parseIOSRedirectUri(value: string): string {
  const url = new URL(value);
  if (!url.protocol.endsWith(":" ) || url.protocol === "http:" || url.protocol === "https:") {
    throw new Error("BEECODE_IOS_OAUTH_REDIRECT_URI must use a custom application scheme");
  }
  if (url.search || url.hash) {
    throw new Error("BEECODE_IOS_OAUTH_REDIRECT_URI cannot contain a query or fragment");
  }
  return url.toString();
}

function parseInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function expectString(value: unknown, key: string, source: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Backend config file ${source}: ${key} must be a non-empty string`);
  }
  return value;
}

function expectInteger(value: unknown, key: string, source: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Backend config file ${source}: ${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function expectBoolean(value: unknown, key: string, source: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Backend config file ${source}: ${key} must be a boolean`);
  }
  return value;
}

function isErrorWithCode(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
