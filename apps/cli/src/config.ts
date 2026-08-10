import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** CLI 本地配置：只保存 Beecode 访问令牌，绝不保存供应商密钥 */

export interface CliConfig {
  backendUrl: string;
  token: string;
  accountId: string;
}

export function beecodeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.BEECODE_HOME ?? join(homedir(), ".beecode");
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(beecodeHome(env), "config.json");
}

export async function loadConfig(env: NodeJS.ProcessEnv = process.env): Promise<CliConfig | undefined> {
  try {
    const raw = await readFile(configPath(env), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.token !== "string" ||
      record.token.length === 0 ||
      typeof record.backendUrl !== "string" ||
      typeof record.accountId !== "string"
    ) {
      return undefined;
    }
    const url = new URL(record.backendUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return { token: record.token, backendUrl: url.toString().replace(/\/$/, ""), accountId: record.accountId };
  } catch {
    return undefined;
  }
}

export async function saveConfig(config: CliConfig, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await mkdir(beecodeHome(env), { recursive: true, mode: 0o700 });
  await chmod(beecodeHome(env), 0o700);
  await writeFile(configPath(env), JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  await chmod(configPath(env), 0o600);
}

export const DEFAULT_BACKEND_URL = "http://127.0.0.1:8787";
