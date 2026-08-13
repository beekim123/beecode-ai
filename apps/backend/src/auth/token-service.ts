import { randomUUID } from "node:crypto";
import { BeecodeError, ErrorCodes } from "@beecode/protocol";
import type { AccountRecord, BackendStore, RefreshTokenRecord } from "../store.js";
import { hashSecret } from "../store.js";
import { createOpaqueSecret, secretsMatch, sha256Base64Url } from "./crypto.js";
import type { OAuthClientRegistry } from "./oauth-client-registry.js";

export interface TokenServiceOptions {
  store: BackendStore;
  authorizationCodeTtlMs: number;
  accessTokenTtlMs: number;
  refreshTokenTtlMs: number;
  clients: OAuthClientRegistry;
  now?: () => Date;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  accountId: string;
}

export class TokenService {
  private readonly store: BackendStore;
  private readonly authorizationCodeTtlMs: number;
  private readonly accessTokenTtlMs: number;
  private readonly refreshTokenTtlMs: number;
  private readonly clients: OAuthClientRegistry;
  private readonly now: () => Date;

  constructor(options: TokenServiceOptions) {
    this.store = options.store;
    this.authorizationCodeTtlMs = options.authorizationCodeTtlMs;
    this.accessTokenTtlMs = options.accessTokenTtlMs;
    this.refreshTokenTtlMs = options.refreshTokenTtlMs;
    this.clients = options.clients;
    this.now = options.now ?? (() => new Date());
  }

  async createAuthorizationCode(input: {
    accountId: string;
    clientId: string;
    redirectUri: string;
    challenge: string;
  }): Promise<string> {
    this.clients.validateAuthorizationRequest(input.clientId, input.redirectUri, input.challenge);
    const code = createOpaqueSecret("code");
    const now = this.now();
    this.store.putAuthorizationCode({
      accountId: input.accountId,
      clientId: input.clientId,
      codeHash: hashSecret(code),
      challenge: input.challenge,
      redirectUri: input.redirectUri,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.authorizationCodeTtlMs).toISOString(),
    });
    await this.store.flush();
    return code;
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
  }): Promise<IssuedTokens> {
    const record = this.store.getAuthorizationCode(hashSecret(input.code));
    const now = this.now();
    if (!record || Date.parse(record.expiresAt) <= now.getTime()) {
      throw new BeecodeError(ErrorCodes.AUTHORIZATION_EXPIRED, "Authorization code has expired");
    }
    if (record.usedAt) {
      throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Authorization code was already used");
    }
    if (
      record.clientId !== input.clientId ||
      record.redirectUri !== input.redirectUri ||
      !secretsMatch(record.challenge, sha256Base64Url(input.verifier))
    ) {
      throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Authorization code binding is invalid");
    }

    record.usedAt = now.toISOString();
    this.store.putAuthorizationCode(record);
    return this.issueTokenPair(record.accountId, record.clientId);
  }

  async refresh(refreshToken: string, clientId: string): Promise<IssuedTokens> {
    this.clients.requireClient(clientId);
    const tokenHash = hashSecret(refreshToken);
    const record = this.store.getRefreshToken(tokenHash);
    const now = this.now();
    if (!record) throw new BeecodeError(ErrorCodes.TOKEN_REVOKED, "Refresh token is invalid");
    if (record.clientId !== clientId) {
      throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Refresh token belongs to another client");
    }
    if (record.revokedAt) {
      if (record.rotatedToHash) {
        this.store.revokeRefreshTokenFamily(record.familyId, now.toISOString());
        await this.store.flush();
      }
      throw new BeecodeError(ErrorCodes.TOKEN_REVOKED, "Refresh token was revoked");
    }
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      record.revokedAt = now.toISOString();
      this.store.putRefreshToken(record);
      await this.store.flush();
      throw new BeecodeError(ErrorCodes.TOKEN_EXPIRED, "Refresh token has expired");
    }

    const issued = this.createTokenPair(record.accountId, record.clientId, record.familyId);
    record.revokedAt = now.toISOString();
    record.rotatedToHash = hashSecret(issued.tokens.refreshToken);
    this.store.putRefreshToken(record);
    await this.store.flush();
    return issued.tokens;
  }

  async revoke(refreshToken: string, clientId: string): Promise<void> {
    this.clients.requireClient(clientId);
    const record = this.store.getRefreshToken(hashSecret(refreshToken));
    if (record?.clientId === clientId) {
      this.store.revokeRefreshTokenFamily(record.familyId, this.now().toISOString());
    }
    await this.store.flush();
  }

  private async issueTokenPair(accountId: string, clientId: string): Promise<IssuedTokens> {
    const issued = this.createTokenPair(accountId, clientId, `family_${randomUUID()}`);
    await this.store.flush();
    return issued.tokens;
  }

  private createTokenPair(
    accountId: string,
    clientId: string,
    familyId: string,
  ): { tokens: IssuedTokens; refreshRecord: RefreshTokenRecord } {
    const account = requireAccount(this.store, accountId);
    const now = this.now();
    const accessToken = createOpaqueSecret("bca");
    const refreshToken = createOpaqueSecret("bcr");
    this.store.putAccessToken({
      accountId,
      clientId,
      tokenHash: hashSecret(accessToken),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.accessTokenTtlMs).toISOString(),
    });
    const refreshRecord: RefreshTokenRecord = {
      accountId,
      clientId,
      familyId,
      tokenHash: hashSecret(refreshToken),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.refreshTokenTtlMs).toISOString(),
    };
    this.store.putRefreshToken(refreshRecord);
    return {
      refreshRecord,
      tokens: {
        accessToken,
        refreshToken,
        tokenType: "Bearer",
        expiresIn: Math.floor(this.accessTokenTtlMs / 1_000),
        accountId: account.accountId,
      },
    };
  }
}

function requireAccount(store: BackendStore, accountId: string): AccountRecord {
  const account = store.getAccount(accountId);
  if (!account) throw new BeecodeError(ErrorCodes.UNAUTHENTICATED, "Account no longer exists");
  return account;
}
