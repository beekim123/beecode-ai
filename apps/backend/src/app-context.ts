import type { AccountRecord, BackendStore } from "./store.js";
import type { ProviderAdapter } from "./provider/adapter.js";
import type { BackendConfig } from "./config.js";
import type { AuthService } from "./auth/auth-service.js";
import type { TokenService } from "./auth/token-service.js";
import type { OAuthClientRegistry } from "./auth/oauth-client-registry.js";
import type { ModelGatewayService } from "./model/model-gateway-service.js";
import type { SessionRepository } from "./session/session-repository.js";
import type { BackendSurfaceRuntimeHost } from "./runtime/web-runtime-host.js";

export type BackendAppConfig = Pick<
  BackendConfig,
  | "quotaLimitTokens"
  | "devLoginSecret"
  | "webOrigin"
  | "publicBaseUrl"
  | "iosOAuthRedirectUri"
  | "cookieSecure"
  | "devAuthEnabled"
  | "browserSessionTtlSeconds"
  | "accessTokenTtlSeconds"
  | "refreshTokenTtlSeconds"
  | "authorizationCodeTtlSeconds"
  | "maxConcurrentWebTurnsPerAccount"
  | "maxConcurrentIOSTurnsPerAccount"
>;

export interface BackendEnv {
  Variables: {
    account: AccountRecord;
    requestId: string;
  };
}

export interface BackendAppServices {
  store: BackendStore;
  provider: ProviderAdapter;
  config: BackendAppConfig;
  auth: AuthService;
  tokens: TokenService;
  oauthClients: OAuthClientRegistry;
  modelGateway: ModelGatewayService;
  webSessions: SessionRepository;
  webRuntime: BackendSurfaceRuntimeHost;
  iosSessions: SessionRepository;
  iosRuntime: BackendSurfaceRuntimeHost;
}
