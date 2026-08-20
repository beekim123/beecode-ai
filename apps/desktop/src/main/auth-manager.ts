import { createHash, randomBytes } from "node:crypto";
import { BeecodeError, ErrorCodes, parseErrorShape } from "@beecode/protocol";
import type { DesktopAuthStatus } from "../preload/api.js";
import type { CredentialStore, DesktopTokens } from "./credential-store.js";

const CLIENT_ID = "beecode-desktop";
const REDIRECT_URI = "ai.beecode.desktop://oauth/callback";
const REFRESH_LEEWAY_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 1_000;

interface PendingAuthorization {
  generation: number;
  state: string;
  verifier: string;
}

interface AuthManagerOptions {
  backendUrl: string;
  credentials: Pick<CredentialStore, "persistence" | "load" | "save" | "clear">;
  openExternal(url: string): Promise<void>;
  fetchImpl?: typeof fetch;
}

type AuthListener = (status: DesktopAuthStatus, accessToken?: string) => void;

export class AuthManager {
  private readonly backendUrl: string;
  private readonly credentials: AuthManagerOptions["credentials"];
  private readonly openExternal: (url: string) => Promise<void>;
  private readonly fetchImpl: typeof fetch;
  private readonly listeners = new Set<AuthListener>();
  private tokens: DesktopTokens | undefined;
  private pending: PendingAuthorization | undefined;
  private currentStatus: DesktopAuthStatus;
  private authGeneration = 0;
  private refreshPromise: Promise<void> | undefined;
  private refreshTimer: NodeJS.Timeout | undefined;

  constructor(options: AuthManagerOptions) {
    this.backendUrl = options.backendUrl.replace(/\/$/, "");
    this.credentials = options.credentials;
    this.openExternal = options.openExternal;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.currentStatus = {
      state: "unauthenticated",
      persistence: this.credentials.persistence,
    };
  }

  async initialize(): Promise<void> {
    this.tokens = await this.credentials.load();
    if (!this.tokens) return;
    try {
      await this.ensureFreshToken();
      this.setAuthenticated();
    } catch (error: unknown) {
      await this.invalidateAuthentication(sanitizeAuthError(error));
    }
  }

  getStatus(): DesktopAuthStatus {
    return structuredClone(this.currentStatus);
  }

  onStatus(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async startLogin(): Promise<DesktopAuthStatus> {
    this.authGeneration += 1;
    const verifier = randomBytes(48).toString("base64url");
    const state = randomBytes(24).toString("base64url");
    this.pending = { generation: this.authGeneration, state, verifier };
    const authorize = new URL("/oauth/authorize", this.backendUrl);
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", CLIENT_ID);
    authorize.searchParams.set("redirect_uri", REDIRECT_URI);
    authorize.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    authorize.searchParams.set("code_challenge_method", "S256");
    authorize.searchParams.set("state", state);
    this.setStatus({ state: "authorizing", persistence: this.credentials.persistence });
    try {
      await this.openExternal(authorize.toString());
    } catch {
      this.pending = undefined;
      this.setError(new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Could not open the system browser"));
    }
    return this.getStatus();
  }

  async handleCallback(callbackUrl: string): Promise<void> {
    const pending = this.pending;
    this.pending = undefined;
    try {
      const callback = parseCallback(callbackUrl);
      if (!pending || callback.state !== pending.state) {
        throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "OAuth state did not match");
      }
      if (callback.error) {
        throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Desktop authorization was denied");
      }
      const tokens = await this.exchangeCode(callback.code, pending.verifier);
      if (pending.generation !== this.authGeneration) return;
      this.tokens = tokens;
      await this.credentials.save(this.tokens);
      this.setAuthenticated();
    } catch (error: unknown) {
      if (pending && pending.generation !== this.authGeneration) return;
      this.setError(sanitizeAuthError(error));
    }
  }

  async getAccessToken(): Promise<string | undefined> {
    if (this.currentStatus.state !== "authenticated" || !this.tokens) return undefined;
    try {
      await this.ensureFreshToken();
      return this.tokens.accessToken;
    } catch (error: unknown) {
      await this.invalidateAuthentication(sanitizeAuthError(error));
      return undefined;
    }
  }

  async logout(): Promise<DesktopAuthStatus> {
    this.authGeneration += 1;
    this.clearRefreshTimer();
    const refreshToken = this.tokens?.refreshToken;
    this.pending = undefined;
    this.tokens = undefined;
    if (refreshToken) {
      try {
        await this.fetchImpl(`${this.backendUrl}/oauth/revoke`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken, client_id: CLIENT_ID }),
        });
      } catch {
        // Local logout still clears credentials when Backend revocation is temporarily unavailable.
      }
    }
    await this.credentials.clear();
    this.setStatus({ state: "unauthenticated", persistence: this.credentials.persistence });
    return this.getStatus();
  }

  private async exchangeCode(code: string, verifier: string): Promise<DesktopTokens> {
    return this.tokenRequest(
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
      }),
    );
  }

  private async ensureFreshToken(): Promise<void> {
    if (!this.tokens || this.tokens.expiresAt - Date.now() > REFRESH_LEEWAY_MS) return;
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshTokens().finally(() => {
        this.refreshPromise = undefined;
      });
    }
    await this.refreshPromise;
  }

  private async refreshTokens(): Promise<void> {
    const currentTokens = this.tokens;
    if (!currentTokens) return;
    const generation = this.authGeneration;
    const tokens = await this.tokenRequest(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: currentTokens.refreshToken,
        client_id: CLIENT_ID,
      }),
    );
    if (
      generation !== this.authGeneration ||
      this.tokens?.refreshToken !== currentTokens.refreshToken
    ) {
      return;
    }
    this.tokens = tokens;
    await this.credentials.save(this.tokens);
    this.setAuthenticated();
  }

  private async tokenRequest(body: URLSearchParams): Promise<DesktopTokens> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.backendUrl}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      });
    } catch {
      throw new BeecodeError(ErrorCodes.AUTHORIZATION_PENDING, "Cannot reach the Beecode Backend", true);
    }
    if (!response.ok) {
      let error = new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Desktop authorization failed");
      try {
        const value = (await response.json()) as { error?: unknown };
        if (value.error) error = BeecodeError.fromShape(parseErrorShape(value.error));
      } catch {
        // Keep the stable authorization error.
      }
      throw error;
    }
    const value = (await response.json()) as Record<string, unknown>;
    if (
      typeof value.access_token !== "string" ||
      typeof value.refresh_token !== "string" ||
      typeof value.expires_in !== "number" ||
      typeof value.account_id !== "string"
    ) {
      throw new BeecodeError(ErrorCodes.INTERNAL, "OAuth token response was invalid");
    }
    return {
      accessToken: value.access_token,
      refreshToken: value.refresh_token,
      expiresAt: Date.now() + value.expires_in * 1_000,
      accountId: value.account_id,
    };
  }

  private setAuthenticated(): void {
    if (!this.tokens) return;
    this.scheduleRefresh();
    this.setStatus({
      state: "authenticated",
      accountId: this.tokens.accountId,
      persistence: this.credentials.persistence,
    });
  }

  private setError(error: BeecodeError): void {
    this.clearRefreshTimer();
    this.setStatus({
      state: "error",
      persistence: this.credentials.persistence,
      error: error.toShape(),
    });
  }

  private setStatus(status: DesktopAuthStatus): void {
    this.currentStatus = status;
    const accessToken = status.state === "authenticated" ? this.tokens?.accessToken : undefined;
    for (const listener of this.listeners) listener(this.getStatus(), accessToken);
  }

  private scheduleRefresh(): void {
    this.clearRefreshTimer();
    if (!this.tokens) return;
    const delay = Math.max(
      MIN_REFRESH_DELAY_MS,
      this.tokens.expiresAt - Date.now() - REFRESH_LEEWAY_MS,
    );
    this.refreshTimer = setTimeout(() => {
      void this.getAccessToken();
    }, delay);
    this.refreshTimer.unref();
  }

  private clearRefreshTimer(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  private async invalidateAuthentication(error: BeecodeError): Promise<void> {
    this.authGeneration += 1;
    this.clearRefreshTimer();
    this.tokens = undefined;
    try {
      await this.credentials.clear();
    } catch {
      // Authentication still fails closed when local credential cleanup cannot complete.
    }
    this.setError(error);
  }
}

function parseCallback(value: string): { state: string; code: string; error?: string } {
  const url = new URL(value);
  if (
    url.protocol !== "ai.beecode.desktop:" ||
    url.hostname !== "oauth" ||
    url.pathname !== "/callback" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Desktop OAuth callback was invalid");
  }
  const keys = [...url.searchParams.keys()];
  const allowed = new Set(["state", "code", "error"]);
  if (keys.some((key) => !allowed.has(key)) || new Set(keys).size !== keys.length) {
    throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Desktop OAuth callback query was invalid");
  }
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error") ?? undefined;
  if (!state || ((!code || error) && (!error || code))) {
    throw new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Desktop OAuth callback was incomplete");
  }
  return { state, code: code ?? "", ...(error ? { error } : {}) };
}

function sanitizeAuthError(error: unknown): BeecodeError {
  if (error instanceof BeecodeError) return error;
  return new BeecodeError(ErrorCodes.AUTHORIZATION_DENIED, "Desktop authorization failed");
}
