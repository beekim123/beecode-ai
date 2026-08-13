import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseSessionSnapshot } from "@beecode/protocol";
import type {
  AccessTokenRecord,
  AccountRecord,
  AuthorizationCodeRecord,
  BackendData,
  BrowserLoginStateRecord,
  BrowserSessionRecord,
  ExternalIdentityRecord,
  RefreshTokenRecord,
  SessionRecord,
  UsageLedgerRecord,
} from "./store.js";
import { hashSecret, InMemoryBackendStore } from "./store.js";

/** JSON compatibility store. Production deployments should bind a transactional repository. */
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
      const temporaryPath = `${this.filePath}.tmp`;
      await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.filePath);
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

  const parsedAccounts = value.accounts.map((account, index) => parseAccount(account, index));
  const migratedAccessTokens: AccessTokenRecord[] = parsedAccounts.flatMap(({ account, legacyToken }) =>
    legacyToken
      ? [
          {
            accountId: account.accountId,
            clientId: "legacy-development",
            tokenHash: hashSecret(legacyToken),
            createdAt: account.createdAt,
            expiresAt: "9999-12-31T23:59:59.999Z",
          },
        ]
      : [],
  );

  return {
    accounts: parsedAccounts.map(({ account }) => account),
    externalIdentities: parseOptionalArray(value.externalIdentities, parseExternalIdentity),
    browserLoginStates: parseOptionalArray(value.browserLoginStates, parseBrowserLoginState),
    browserSessions: parseOptionalArray(value.browserSessions, parseBrowserSession),
    accessTokens: [
      ...parseOptionalArray(value.accessTokens, parseAccessToken),
      ...migratedAccessTokens,
    ],
    authorizationCodes: parseOptionalArray(value.authorizationCodes, parseAuthorizationCode),
    refreshTokens: parseOptionalArray(value.refreshTokens, parseRefreshToken),
    usageLedger: parseOptionalArray(value.usageLedger, parseUsageLedger),
    sessions: value.sessions.map((session, index) => parseSessionRecord(session, index)),
  };
}

function parseAccount(
  value: unknown,
  index: number,
): { account: AccountRecord; legacyToken?: string } {
  if (!isRecord(value)) throw new TypeError(`accounts[${index}] must be an object`);
  const account: AccountRecord = {
    accountId: requiredString(value.accountId, `accounts[${index}].accountId`),
    quotaLimitTokens: integerAtLeast(value.quotaLimitTokens, `accounts[${index}].quotaLimitTokens`, 1),
    quotaUsedTokens: integerAtLeast(value.quotaUsedTokens, `accounts[${index}].quotaUsedTokens`, 0),
    createdAt: requiredString(value.createdAt, `accounts[${index}].createdAt`),
  };
  const legacyToken = typeof value.token === "string" && value.token.length > 0 ? value.token : undefined;
  return legacyToken ? { account, legacyToken } : { account };
}

function parseExternalIdentity(value: unknown, path: string): ExternalIdentityRecord {
  const record = requiredRecord(value, path);
  return {
    accountId: requiredString(record.accountId, `${path}.accountId`),
    provider: requiredString(record.provider, `${path}.provider`),
    providerSubject: requiredString(record.providerSubject, `${path}.providerSubject`),
    createdAt: requiredString(record.createdAt, `${path}.createdAt`),
  };
}

function parseBrowserLoginState(value: unknown, path: string): BrowserLoginStateRecord {
  const record = requiredRecord(value, path);
  return withOptionalString(
    {
      stateHash: requiredString(record.stateHash, `${path}.stateHash`),
      provider: requiredString(record.provider, `${path}.provider`),
      returnTo: requiredString(record.returnTo, `${path}.returnTo`),
      expiresAt: requiredString(record.expiresAt, `${path}.expiresAt`),
    },
    "usedAt",
    record.usedAt,
    path,
  );
}

function parseBrowserSession(value: unknown, path: string): BrowserSessionRecord {
  const record = requiredRecord(value, path);
  return withOptionalString(
    {
      accountId: requiredString(record.accountId, `${path}.accountId`),
      tokenHash: requiredString(record.tokenHash, `${path}.tokenHash`),
      expiresAt: requiredString(record.expiresAt, `${path}.expiresAt`),
      createdAt: requiredString(record.createdAt, `${path}.createdAt`),
    },
    "revokedAt",
    record.revokedAt,
    path,
  );
}

function parseAccessToken(value: unknown, path: string): AccessTokenRecord {
  const record = requiredRecord(value, path);
  return withOptionalString(
    {
      accountId: requiredString(record.accountId, `${path}.accountId`),
      clientId: requiredString(record.clientId, `${path}.clientId`),
      tokenHash: requiredString(record.tokenHash, `${path}.tokenHash`),
      expiresAt: requiredString(record.expiresAt, `${path}.expiresAt`),
      createdAt: requiredString(record.createdAt, `${path}.createdAt`),
    },
    "revokedAt",
    record.revokedAt,
    path,
  );
}

function parseAuthorizationCode(value: unknown, path: string): AuthorizationCodeRecord {
  const record = requiredRecord(value, path);
  return withOptionalString(
    {
      accountId: requiredString(record.accountId, `${path}.accountId`),
      clientId: requiredString(record.clientId, `${path}.clientId`),
      codeHash: requiredString(record.codeHash, `${path}.codeHash`),
      challenge: requiredString(record.challenge, `${path}.challenge`),
      redirectUri: requiredString(record.redirectUri, `${path}.redirectUri`),
      expiresAt: requiredString(record.expiresAt, `${path}.expiresAt`),
      createdAt: requiredString(record.createdAt, `${path}.createdAt`),
    },
    "usedAt",
    record.usedAt,
    path,
  );
}

function parseRefreshToken(value: unknown, path: string): RefreshTokenRecord {
  const record = requiredRecord(value, path);
  let parsed: RefreshTokenRecord = {
    accountId: requiredString(record.accountId, `${path}.accountId`),
    clientId: requiredString(record.clientId, `${path}.clientId`),
    familyId: requiredString(record.familyId, `${path}.familyId`),
    tokenHash: requiredString(record.tokenHash, `${path}.tokenHash`),
    expiresAt: requiredString(record.expiresAt, `${path}.expiresAt`),
    createdAt: requiredString(record.createdAt, `${path}.createdAt`),
  };
  parsed = withOptionalString(parsed, "revokedAt", record.revokedAt, path);
  return withOptionalString(parsed, "rotatedToHash", record.rotatedToHash, path);
}

function parseUsageLedger(value: unknown, path: string): UsageLedgerRecord {
  const record = requiredRecord(value, path);
  let parsed: UsageLedgerRecord = {
    accountId: requiredString(record.accountId, `${path}.accountId`),
    providerRequestId: requiredString(record.providerRequestId, `${path}.providerRequestId`),
    inputTokens: integerAtLeast(record.inputTokens, `${path}.inputTokens`, 0),
    outputTokens: integerAtLeast(record.outputTokens, `${path}.outputTokens`, 0),
    totalTokens: integerAtLeast(record.totalTokens, `${path}.totalTokens`, 0),
    createdAt: requiredString(record.createdAt, `${path}.createdAt`),
  };
  parsed = withOptionalString(parsed, "turnId", record.turnId, path);
  return parsed;
}

function parseSessionRecord(value: unknown, index: number): SessionRecord {
  if (!isRecord(value)) throw new TypeError(`sessions[${index}] must be an object`);
  const snapshot = parseSessionSnapshot(value, `sessions[${index}]`);
  const idempotencyKeys = value.idempotencyKeys;
  if (idempotencyKeys === undefined) return snapshot;
  if (!isRecord(idempotencyKeys)) {
    throw new TypeError(`sessions[${index}].idempotencyKeys must be an object`);
  }
  const parsed: Record<string, { turnId: string; textHash: string }> = {};
  for (const [key, entry] of Object.entries(idempotencyKeys)) {
    const idempotency = requiredRecord(entry, `sessions[${index}].idempotencyKeys.${key}`);
    parsed[key] = {
      turnId: requiredString(idempotency.turnId, `sessions[${index}].idempotencyKeys.${key}.turnId`),
      textHash: requiredString(idempotency.textHash, `sessions[${index}].idempotencyKeys.${key}.textHash`),
    };
  }
  return { ...snapshot, idempotencyKeys: parsed };
}

function parseOptionalArray<TValue>(
  value: unknown,
  parse: (entry: unknown, path: string) => TValue,
): TValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("Backend authentication collection must be an array");
  return value.map((entry, index) => parse(entry, `[${index}]`));
}

function withOptionalString<TValue extends object, TKey extends string>(
  value: TValue,
  key: TKey,
  candidate: unknown,
  path: string,
): TValue & Partial<Record<TKey, string>> {
  if (candidate === undefined) return value;
  return { ...value, [key]: requiredString(candidate, `${path}.${key}`) } as TValue &
    Partial<Record<TKey, string>>;
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function integerAtLeast(value: unknown, path: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${path} must be an integer >= ${minimum}`);
  }
  return value as number;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
