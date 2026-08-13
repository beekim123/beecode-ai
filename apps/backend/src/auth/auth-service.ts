import { BeecodeError, ErrorCodes, type Id } from "@beecode/protocol";
import type { AccountRecord, BackendStore } from "../store.js";
import { hashSecret } from "../store.js";
import { createOpaqueSecret } from "./crypto.js";
import type { IdentityProvider } from "./identity-provider.js";

export interface AuthServiceOptions {
  store: BackendStore;
  providers: readonly IdentityProvider[];
  quotaLimitTokens: number;
  browserSessionTtlMs: number;
  browserLoginTtlMs: number;
  now?: () => Date;
}

export interface BrowserLoginResult {
  account: AccountRecord;
  browserSessionToken: string;
  returnTo: string;
}

export class AuthService {
  private readonly store: BackendStore;
  private readonly providers: Map<string, IdentityProvider>;
  private readonly quotaLimitTokens: number;
  private readonly browserSessionTtlMs: number;
  private readonly browserLoginTtlMs: number;
  private readonly now: () => Date;

  constructor(options: AuthServiceOptions) {
    this.store = options.store;
    this.providers = new Map(options.providers.map((provider) => [provider.name, provider]));
    this.quotaLimitTokens = options.quotaLimitTokens;
    this.browserSessionTtlMs = options.browserSessionTtlMs;
    this.browserLoginTtlMs = options.browserLoginTtlMs;
    this.now = options.now ?? (() => new Date());
  }

  beginBrowserLogin(input: {
    provider: string;
    callbackUrl: string;
    returnTo: string;
    loginHint?: string;
  }): string {
    const provider = this.getProvider(input.provider);
    const state = createOpaqueSecret("state");
    const now = this.now();
    this.store.putBrowserLoginState({
      stateHash: hashSecret(state),
      provider: provider.name,
      returnTo: sanitizeReturnTarget(input.returnTo),
      expiresAt: new Date(now.getTime() + this.browserLoginTtlMs).toISOString(),
    });
    return provider.createAuthorizationUrl({
      callbackUrl: input.callbackUrl,
      state,
      loginHint: input.loginHint,
    });
  }

  async completeBrowserLogin(input: {
    provider: string;
    code: string;
    state: string;
  }): Promise<BrowserLoginResult> {
    const provider = this.getProvider(input.provider);
    const state = this.store.getBrowserLoginState(hashSecret(input.state));
    const now = this.now();
    if (
      !state ||
      state.provider !== provider.name ||
      state.usedAt ||
      Date.parse(state.expiresAt) <= now.getTime()
    ) {
      throw new BeecodeError(
        ErrorCodes.AUTHORIZATION_EXPIRED,
        "Browser login request is missing, expired, or already used",
      );
    }

    const profile = await provider.exchangeCode(input.code);
    state.usedAt = now.toISOString();
    this.store.putBrowserLoginState(state);
    const account = this.store.getOrCreateAccountByIdentity(
      provider.name,
      profile.subject,
      this.quotaLimitTokens,
    );
    const browserSessionToken = createOpaqueSecret("bws");
    this.store.putBrowserSession({
      accountId: account.accountId,
      tokenHash: hashSecret(browserSessionToken),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.browserSessionTtlMs).toISOString(),
    });
    await this.store.flush();
    return { account, browserSessionToken, returnTo: state.returnTo };
  }

  getBrowserAccount(browserSessionToken: string): AccountRecord | undefined {
    const session = this.store.getBrowserSession(hashSecret(browserSessionToken));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= this.now().getTime()) {
      return undefined;
    }
    return this.store.getAccount(session.accountId);
  }

  async logout(browserSessionToken: string): Promise<void> {
    this.store.revokeBrowserSession(hashSecret(browserSessionToken), this.now().toISOString());
    await this.store.flush();
  }

  getAccount(accountId: Id): AccountRecord | undefined {
    return this.store.getAccount(accountId);
  }

  private getProvider(name: string): IdentityProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new BeecodeError(
        ErrorCodes.SURFACE_UNAVAILABLE,
        `Identity provider ${name} is not configured`,
      );
    }
    return provider;
  }
}

export function sanitizeReturnTarget(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/app";
  return value;
}
