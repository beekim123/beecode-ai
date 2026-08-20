import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { safeStorage } from "electron";

export interface DesktopTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
}

interface PersistedCredentials {
  version: 1;
  encrypted: string;
}

export class CredentialStore {
  private memory: DesktopTokens | undefined;

  constructor(private readonly path: string) {}

  get persistence(): "encrypted" | "memory_only" {
    return safeStorage.isEncryptionAvailable() ? "encrypted" : "memory_only";
  }

  async load(): Promise<DesktopTokens | undefined> {
    if (this.memory) return structuredClone(this.memory);
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    try {
      const persisted = JSON.parse(await readFile(this.path, "utf8")) as PersistedCredentials;
      if (persisted.version !== 1 || typeof persisted.encrypted !== "string") return undefined;
      const raw = safeStorage.decryptString(Buffer.from(persisted.encrypted, "base64"));
      const tokens = parseTokens(JSON.parse(raw));
      this.memory = tokens;
      return structuredClone(tokens);
    } catch (error: unknown) {
      if (isErrorCode(error, "ENOENT")) return undefined;
      await this.clear();
      return undefined;
    }
  }

  async save(tokens: DesktopTokens): Promise<void> {
    this.memory = structuredClone(tokens);
    if (!safeStorage.isEncryptionAvailable()) return;
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens)).toString("base64");
    const temporaryPath = `${this.path}.tmp`;
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, encrypted } satisfies PersistedCredentials)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporaryPath, this.path);
  }

  async clear(): Promise<void> {
    this.memory = undefined;
    try {
      await unlink(this.path);
    } catch (error: unknown) {
      if (!isErrorCode(error, "ENOENT")) throw error;
    }
  }
}

function parseTokens(value: unknown): DesktopTokens {
  if (typeof value !== "object" || value === null) throw new TypeError("Invalid credential data");
  const record = value as Record<string, unknown>;
  if (
    typeof record.accessToken !== "string" ||
    typeof record.refreshToken !== "string" ||
    typeof record.expiresAt !== "number" ||
    typeof record.accountId !== "string"
  ) {
    throw new TypeError("Invalid credential data");
  }
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    expiresAt: record.expiresAt,
    accountId: record.accountId,
  };
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code;
}
