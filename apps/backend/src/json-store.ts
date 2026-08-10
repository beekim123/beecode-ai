import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSessionSnapshot } from "@beecode/protocol";
import type { AccountRecord, BackendData, SessionRecord } from "./store.js";
import { InMemoryBackendStore } from "./store.js";

/** JSON 文件持久化：进程重启后 Session/额度不丢失；原子写避免损坏 */
export class JsonFileBackendStore extends InMemoryBackendStore {
  private readonly filePath: string;
  private loaded = false;
  private flushQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string) {
    super();
    this.filePath = filePath;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await readFile(this.filePath, "utf8");
      this.data = parseBackendData(JSON.parse(raw));
      this.loaded = true;
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.loaded = true;
        return;
      }
      throw new Error(`Unable to load Beecode backend data from ${this.filePath}`, { cause: error });
    }
  }

  override flush(): Promise<void> {
    const serialized = JSON.stringify(this.data, null, 2);
    const write = this.flushQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, serialized, { encoding: "utf8", mode: 0o600 });
      await chmod(tmp, 0o600);
      await rename(tmp, this.filePath);
      await chmod(this.filePath, 0o600);
    });
    this.flushQueue = write.catch(() => undefined);
    return write;
  }
}

function parseBackendData(value: unknown): BackendData {
  if (!isRecord(value)) throw new TypeError("Backend data must be an object");
  if (!Array.isArray(value.accounts) || !Array.isArray(value.sessions)) {
    throw new TypeError("Backend data must contain accounts and sessions arrays");
  }
  return {
    accounts: value.accounts.map((account, index) => parseAccount(account, index)),
    sessions: value.sessions.map((session, index) => parseSessionRecord(session, index)),
  };
}

function parseAccount(value: unknown, index: number): AccountRecord {
  if (!isRecord(value)) throw new TypeError(`accounts[${index}] must be an object`);
  return {
    accountId: requiredString(value.accountId, `accounts[${index}].accountId`),
    token: requiredString(value.token, `accounts[${index}].token`),
    quotaLimitTokens: nonNegativeInteger(value.quotaLimitTokens, `accounts[${index}].quotaLimitTokens`, 1),
    quotaUsedTokens: nonNegativeInteger(value.quotaUsedTokens, `accounts[${index}].quotaUsedTokens`, 0),
    createdAt: requiredString(value.createdAt, `accounts[${index}].createdAt`),
  };
}

function parseSessionRecord(value: unknown, index: number): SessionRecord {
  if (!isRecord(value)) throw new TypeError(`sessions[${index}] must be an object`);
  return parseSessionSnapshot(value, `sessions[${index}]`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${path} must be a non-empty string`);
  return value;
}

function nonNegativeInteger(value: unknown, path: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${path} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
