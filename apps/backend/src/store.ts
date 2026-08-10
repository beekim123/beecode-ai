import { randomUUID } from "node:crypto";
import type { Message, Session, Turn } from "@beecode/protocol";

/**
 * 后端数据存储。第一阶段以 JSON 文件持久化（进程重启不丢数据），
 * Repository 接口已隔离，后续可替换为 PostgreSQL 而不影响服务层。
 */

export interface AccountRecord {
  accountId: string;
  token: string;
  quotaLimitTokens: number;
  quotaUsedTokens: number;
  createdAt: string;
}

export interface SessionRecord {
  session: Session;
  messages: Message[];
  turns: Turn[];
}

export interface BackendData {
  accounts: AccountRecord[];
  sessions: SessionRecord[];
}

export interface BackendStore {
  findAccountByToken(token: string): AccountRecord | undefined;
  createAccount(quotaLimitTokens: number): AccountRecord;
  addUsage(accountId: string, tokens: number): void;
  listSessions(accountId: string, surface: string): SessionRecord[];
  getSession(sessionId: string): SessionRecord | undefined;
  putSession(record: SessionRecord): void;
  flush(): Promise<void>;
}

export class InMemoryBackendStore implements BackendStore {
  protected data: BackendData = { accounts: [], sessions: [] };

  findAccountByToken(token: string): AccountRecord | undefined {
    return this.data.accounts.find((a) => a.token === token);
  }

  createAccount(quotaLimitTokens: number): AccountRecord {
    if (!Number.isInteger(quotaLimitTokens) || quotaLimitTokens <= 0) {
      throw new TypeError("quotaLimitTokens must be a positive integer");
    }
    const account: AccountRecord = {
      accountId: `acct_${randomUUID()}`,
      token: `bct_${randomUUID()}`,
      quotaLimitTokens,
      quotaUsedTokens: 0,
      createdAt: new Date().toISOString(),
    };
    this.data.accounts.push(account);
    return account;
  }

  addUsage(accountId: string, tokens: number): void {
    if (!Number.isInteger(tokens) || tokens < 0) {
      throw new TypeError("tokens must be a non-negative integer");
    }
    const account = this.data.accounts.find((a) => a.accountId === accountId);
    if (account) account.quotaUsedTokens += tokens;
  }

  listSessions(accountId: string, surface: string): SessionRecord[] {
    // surface 数据边界：强制按 surface 过滤（设计文档 10.1）
    return this.data.sessions.filter(
      (r) => r.session.accountId === accountId && r.session.surface === surface,
    );
  }

  getSession(sessionId: string): SessionRecord | undefined {
    return this.data.sessions.find((r) => r.session.id === sessionId);
  }

  putSession(record: SessionRecord): void {
    const idx = this.data.sessions.findIndex((r) => r.session.id === record.session.id);
    if (idx >= 0) this.data.sessions[idx] = record;
    else this.data.sessions.push(record);
  }

  flush(): Promise<void> {
    return Promise.resolve();
  }
}
