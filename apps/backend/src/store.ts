import { createHash, randomUUID } from "node:crypto";
import type { Message, Session, Turn } from "@beecode/protocol";

/** Persistence records intentionally contain only token hashes, never bearer secrets. */
export interface AccountRecord {
  accountId: string;
  quotaLimitTokens: number;
  quotaUsedTokens: number;
  createdAt: string;
}

export interface ProvisionedAccount extends AccountRecord {
  /** Returned once to the caller and never retained in BackendData. */
  token: string;
}

export interface ExternalIdentityRecord {
  accountId: string;
  provider: string;
  providerSubject: string;
  createdAt: string;
}

export interface BrowserLoginStateRecord {
  stateHash: string;
  provider: string;
  returnTo: string;
  expiresAt: string;
  usedAt?: string;
}

export interface BrowserSessionRecord {
  accountId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
}

export interface AccessTokenRecord {
  accountId: string;
  clientId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
}

export interface AuthorizationCodeRecord {
  accountId: string;
  clientId: string;
  codeHash: string;
  challenge: string;
  redirectUri: string;
  expiresAt: string;
  createdAt: string;
  usedAt?: string;
}

export interface RefreshTokenRecord {
  accountId: string;
  clientId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt?: string;
  rotatedToHash?: string;
}

export interface UsageLedgerRecord {
  accountId: string;
  providerRequestId: string;
  turnId?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: string;
}

export interface SessionRecord {
  session: Session;
  messages: Message[];
  turns: Turn[];
  /** Unique within this account and Session. */
  idempotencyKeys?: Record<string, { turnId: string; textHash: string }>;
}

export interface BackendData {
  accounts: AccountRecord[];
  externalIdentities: ExternalIdentityRecord[];
  browserLoginStates: BrowserLoginStateRecord[];
  browserSessions: BrowserSessionRecord[];
  accessTokens: AccessTokenRecord[];
  authorizationCodes: AuthorizationCodeRecord[];
  refreshTokens: RefreshTokenRecord[];
  usageLedger: UsageLedgerRecord[];
  sessions: SessionRecord[];
}

export interface BackendStore {
  findAccountByToken(token: string, now?: Date): AccountRecord | undefined;
  findAccountByClientToken(token: string, clientId: string, now?: Date): AccountRecord | undefined;
  getAccount(accountId: string): AccountRecord | undefined;
  allAccountIds(): string[];
  createAccount(quotaLimitTokens: number): ProvisionedAccount;
  getOrCreateAccountByIdentity(
    provider: string,
    providerSubject: string,
    quotaLimitTokens: number,
  ): AccountRecord;
  addUsage(accountId: string, tokens: number): void;
  putBrowserLoginState(record: BrowserLoginStateRecord): void;
  getBrowserLoginState(stateHash: string): BrowserLoginStateRecord | undefined;
  putBrowserSession(record: BrowserSessionRecord): void;
  getBrowserSession(tokenHash: string): BrowserSessionRecord | undefined;
  revokeBrowserSession(tokenHash: string, revokedAt: string): void;
  putAccessToken(record: AccessTokenRecord): void;
  getAccessToken(tokenHash: string): AccessTokenRecord | undefined;
  putAuthorizationCode(record: AuthorizationCodeRecord): void;
  getAuthorizationCode(codeHash: string): AuthorizationCodeRecord | undefined;
  putRefreshToken(record: RefreshTokenRecord): void;
  getRefreshToken(tokenHash: string): RefreshTokenRecord | undefined;
  revokeRefreshTokenFamily(familyId: string, revokedAt: string): void;
  recordUsage(record: UsageLedgerRecord): number;
  listSessions(accountId: string, surface: string): SessionRecord[];
  getSession(sessionId: string): SessionRecord | undefined;
  putSession(record: SessionRecord): void;
  flush(): Promise<void>;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("base64url");
}

export class InMemoryBackendStore implements BackendStore {
  protected data: BackendData = {
    accounts: [],
    externalIdentities: [],
    browserLoginStates: [],
    browserSessions: [],
    accessTokens: [],
    authorizationCodes: [],
    refreshTokens: [],
    usageLedger: [],
    sessions: [],
  };

  findAccountByToken(token: string, now = new Date()): AccountRecord | undefined {
    const accessToken = this.getAccessToken(hashSecret(token));
    if (!accessToken || accessToken.revokedAt || Date.parse(accessToken.expiresAt) <= now.getTime()) {
      return undefined;
    }
    return this.getAccount(accessToken.accountId);
  }

  findAccountByClientToken(
    token: string,
    clientId: string,
    now = new Date(),
  ): AccountRecord | undefined {
    const accessToken = this.getAccessToken(hashSecret(token));
    if (
      !accessToken ||
      accessToken.clientId !== clientId ||
      accessToken.revokedAt ||
      Date.parse(accessToken.expiresAt) <= now.getTime()
    ) {
      return undefined;
    }
    return this.getAccount(accessToken.accountId);
  }

  getAccount(accountId: string): AccountRecord | undefined {
    return this.data.accounts.find((account) => account.accountId === accountId);
  }

  allAccountIds(): string[] {
    return this.data.accounts.map((account) => account.accountId);
  }

  createAccount(quotaLimitTokens: number): ProvisionedAccount {
    assertQuotaLimit(quotaLimitTokens);
    const now = new Date();
    const account: AccountRecord = {
      accountId: `acct_${randomUUID()}`,
      quotaLimitTokens,
      quotaUsedTokens: 0,
      createdAt: now.toISOString(),
    };
    const token = `bct_${randomUUID()}`;
    this.data.accounts.push(account);
    this.putAccessToken({
      accountId: account.accountId,
      clientId: "development",
      tokenHash: hashSecret(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    });
    return { ...account, token };
  }

  getOrCreateAccountByIdentity(
    provider: string,
    providerSubject: string,
    quotaLimitTokens: number,
  ): AccountRecord {
    const identity = this.data.externalIdentities.find(
      (candidate) =>
        candidate.provider === provider && candidate.providerSubject === providerSubject,
    );
    if (identity) {
      const account = this.getAccount(identity.accountId);
      if (account) return account;
    }

    assertQuotaLimit(quotaLimitTokens);
    const now = new Date().toISOString();
    const account: AccountRecord = {
      accountId: `acct_${randomUUID()}`,
      quotaLimitTokens,
      quotaUsedTokens: 0,
      createdAt: now,
    };
    this.data.accounts.push(account);
    this.data.externalIdentities.push({
      accountId: account.accountId,
      provider,
      providerSubject,
      createdAt: now,
    });
    return account;
  }

  addUsage(accountId: string, tokens: number): void {
    if (!Number.isInteger(tokens) || tokens < 0) {
      throw new TypeError("tokens must be a non-negative integer");
    }
    const account = this.getAccount(accountId);
    if (account) account.quotaUsedTokens += tokens;
  }

  putBrowserLoginState(record: BrowserLoginStateRecord): void {
    upsertBy(this.data.browserLoginStates, record, (value) => value.stateHash);
  }

  getBrowserLoginState(stateHash: string): BrowserLoginStateRecord | undefined {
    return this.data.browserLoginStates.find((record) => record.stateHash === stateHash);
  }

  putBrowserSession(record: BrowserSessionRecord): void {
    upsertBy(this.data.browserSessions, record, (value) => value.tokenHash);
  }

  getBrowserSession(tokenHash: string): BrowserSessionRecord | undefined {
    return this.data.browserSessions.find((record) => record.tokenHash === tokenHash);
  }

  revokeBrowserSession(tokenHash: string, revokedAt: string): void {
    const session = this.getBrowserSession(tokenHash);
    if (session && !session.revokedAt) session.revokedAt = revokedAt;
  }

  putAccessToken(record: AccessTokenRecord): void {
    upsertBy(this.data.accessTokens, record, (value) => value.tokenHash);
  }

  getAccessToken(tokenHash: string): AccessTokenRecord | undefined {
    return this.data.accessTokens.find((record) => record.tokenHash === tokenHash);
  }

  putAuthorizationCode(record: AuthorizationCodeRecord): void {
    upsertBy(this.data.authorizationCodes, record, (value) => value.codeHash);
  }

  getAuthorizationCode(codeHash: string): AuthorizationCodeRecord | undefined {
    return this.data.authorizationCodes.find((record) => record.codeHash === codeHash);
  }

  putRefreshToken(record: RefreshTokenRecord): void {
    upsertBy(this.data.refreshTokens, record, (value) => value.tokenHash);
  }

  getRefreshToken(tokenHash: string): RefreshTokenRecord | undefined {
    return this.data.refreshTokens.find((record) => record.tokenHash === tokenHash);
  }

  revokeRefreshTokenFamily(familyId: string, revokedAt: string): void {
    for (const token of this.data.refreshTokens) {
      if (token.familyId === familyId && !token.revokedAt) token.revokedAt = revokedAt;
    }
  }

  recordUsage(record: UsageLedgerRecord): number {
    const existing = this.data.usageLedger.find(
      (entry) => entry.providerRequestId === record.providerRequestId,
    );
    if (existing) {
      if (existing.accountId !== record.accountId) {
        throw new TypeError("providerRequestId cannot move between accounts");
      }
      const additionalTokens = Math.max(0, record.totalTokens - existing.totalTokens);
      if (additionalTokens === 0) return 0;
      existing.inputTokens = Math.max(existing.inputTokens, record.inputTokens);
      existing.outputTokens = Math.max(existing.outputTokens, record.outputTokens);
      existing.totalTokens = record.totalTokens;
      this.addUsage(record.accountId, additionalTokens);
      return additionalTokens;
    }
    this.data.usageLedger.push(structuredClone(record));
    this.addUsage(record.accountId, record.totalTokens);
    return record.totalTokens;
  }

  listSessions(accountId: string, surface: string): SessionRecord[] {
    return this.data.sessions.filter(
      (record) => record.session.accountId === accountId && record.session.surface === surface,
    );
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.data.sessions.find((record) => record.session.id === sessionId);
  }

  putSession(record: SessionRecord): void {
    upsertBy(this.data.sessions, record, (value) => value.session.id);
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}

function upsertBy<TValue>(
  values: TValue[],
  value: TValue,
  keyOf: (candidate: TValue) => string,
): void {
  const index = values.findIndex((candidate) => keyOf(candidate) === keyOf(value));
  if (index >= 0) values[index] = value;
  else values.push(value);
}

function assertQuotaLimit(quotaLimitTokens: number): void {
  if (!Number.isInteger(quotaLimitTokens) || quotaLimitTokens <= 0) {
    throw new TypeError("quotaLimitTokens must be a positive integer");
  }
}
