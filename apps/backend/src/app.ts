import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { ErrorCodes, phase2OpenApiDocument } from "@beecode/protocol";
import type { BackendAppServices, BackendEnv } from "./app-context.js";
import type { BackendAppConfig } from "./app-context.js";
import { AuthService } from "./auth/auth-service.js";
import { DevelopmentIdentityProvider } from "./auth/identity-provider.js";
import type { IdentityProvider } from "./auth/identity-provider.js";
import { TokenService } from "./auth/token-service.js";
import {
  DESKTOP_OAUTH_CLIENT_ID,
  IOS_OAUTH_CLIENT_ID,
  OAuthClientRegistry,
} from "./auth/oauth-client-registry.js";
import { ModelGatewayService } from "./model/model-gateway-service.js";
import { StoreSessionRepository } from "./session/store-session-repository.js";
import type { SessionRepository } from "./session/session-repository.js";
import { BackendSurfaceRuntimeHost } from "./runtime/web-runtime-host.js";
import { requireAccount, requireAnyAccount, requireBrowserAccount } from "./middleware/auth.js";
import { handleAppError, sendApiError } from "./middleware/error-handler.js";
import { requestLogger, type RequestLogSink } from "./middleware/request-logger.js";
import type { ProviderAdapter } from "./provider/adapter.js";
import { createAccountRoutes } from "./routes/account.js";
import { createCliAuthRoutes } from "./routes/cli-auth.js";
import { createCliSessionRoutes } from "./routes/cli-sessions.js";
import { createModelGatewayRoutes } from "./routes/model-gateway.js";
import { createBrowserAuthRoutes } from "./routes/browser-auth.js";
import { createOAuthRoutes } from "./routes/oauth.js";
import { createWebAgentRoutes } from "./routes/web-agent.js";
import { createIOSAgentRoutes } from "./routes/ios-agent.js";
import { createDesktopSessionRoutes } from "./routes/desktop-sessions.js";
import type { BackendStore } from "./store.js";

const MAX_REQUEST_BODY_BYTES = 1024 * 1024;
const CLI_BEARER_CLIENT_IDS = [
  "beecode-cli",
  "development",
  "legacy-development",
] as const;
const MODEL_GATEWAY_CLIENT_IDS = [...CLI_BEARER_CLIENT_IDS, DESKTOP_OAUTH_CLIENT_ID] as const;

export interface BackendAppOptions {
  log?: RequestLogSink;
  identityProviders?: readonly IdentityProvider[];
  webSessions?: SessionRepository;
  iosSessions?: SessionRepository;
  desktopSessions?: SessionRepository;
}

export type BackendAppConfigInput = Pick<BackendAppConfig, "quotaLimitTokens"> &
  Partial<Omit<BackendAppConfig, "quotaLimitTokens">>;

export function createBackendApp(
  store: BackendStore,
  provider: ProviderAdapter,
  configInput: BackendAppConfigInput,
  options: BackendAppOptions = {},
): Hono<BackendEnv> {
  // ── 1. 装配服务对象（依赖注入）────────────────────────────────
  // 下面这些实例是后端的所有「能力单元」，会被中间件和各 surface 路由共享引用。
  // 这一阶段只创建对象，不注册任何 HTTP 路径。

  const config = normalizeAppConfig(configInput);
  const providers = options.identityProviders ?? (
    config.devAuthEnabled ? [new DevelopmentIdentityProvider()] : []
  );
  const auth = new AuthService({
    store,
    providers,
    quotaLimitTokens: config.quotaLimitTokens,
    browserSessionTtlMs: config.browserSessionTtlSeconds * 1_000,
    browserLoginTtlMs: 10 * 60 * 1_000,
  });
  const oauthClients = new OAuthClientRegistry(
    config.iosOAuthRedirectUri,
    config.desktopOAuthRedirectUri,
  );
  const tokens = new TokenService({
    store,
    authorizationCodeTtlMs: config.authorizationCodeTtlSeconds * 1_000,
    accessTokenTtlMs: config.accessTokenTtlSeconds * 1_000,
    refreshTokenTtlMs: config.refreshTokenTtlSeconds * 1_000,
    clients: oauthClients,
  });
  const modelGateway = new ModelGatewayService(store, provider);
  const webSessions = options.webSessions ?? new StoreSessionRepository(store, "web");
  const webRuntime = new BackendSurfaceRuntimeHost({
    repository: webSessions,
    modelGateway,
    surface: "web",
    maxConcurrentTurnsPerAccount: config.maxConcurrentWebTurnsPerAccount,
  });
  const iosSessions = options.iosSessions ?? new StoreSessionRepository(store, "ios");
  const iosRuntime = new BackendSurfaceRuntimeHost({
    repository: iosSessions,
    modelGateway,
    surface: "ios",
    maxConcurrentTurnsPerAccount: config.maxConcurrentIOSTurnsPerAccount,
  });
  const desktopSessions = options.desktopSessions ?? new StoreSessionRepository(store, "desktop");
  // 把所有服务收进一个对象，路由创建函数通过它拿到自己需要的依赖。
  const services: BackendAppServices = {
    store,
    provider,
    config,
    auth,
    tokens,
    oauthClients,
    modelGateway,
    webSessions,
    webRuntime,
    iosSessions,
    iosRuntime,
    desktopSessions,
  };

  // ── 2. 创建 Hono 应用并挂载中间件 + 路由 ─────────────────────
  // use() 注册中间件、route() 注册路由，二者都按注册顺序执行。
  const app = new Hono<BackendEnv>();

  // 全局中间件：任何请求都会先经过这几层（requestId → 日志 → 安全头 → body 大小限制）。
  app.use(
    "*",
    requestId({
      generator: () => `req_${randomUUID()}`,
    }),
  );
  if (options.log) app.use("*", requestLogger(options.log));
  app.use("*", secureHeaders());
  app.use(
    "*",
    bodyLimit({
      maxSize: MAX_REQUEST_BODY_BYTES,
      onError: (context) =>
        sendApiError(
          context,
          413,
          ErrorCodes.INVALID_REQUEST,
          `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`,
        ),
    }),
  );

  // 公开路由：登录 / OAuth / 授权码交换，无需登录即可访问。
  if (config.devAuthEnabled) app.route("/", createCliAuthRoutes(services));
  app.route("/", createBrowserAuthRoutes(services));
  app.route("/", createOAuthRoutes(services));
  app.get("/openapi.json", (context) => context.json(phase2OpenApiDocument));

  // 账号信息 / 配额：只要「任意一种已认证身份」即可。
  app.use("/v1/me", requireAnyAccount(store, auth));
  app.use("/v1/quota", requireAnyAccount(store, auth));
  app.route("/", createAccountRoutes(services));

  // ── 3. 各 surface 的 Agent 路由 ──────────────────────────────
  // 每个端先挂鉴权中间件（限定「你是谁」），再挂对应路由。
  // 关键：鉴权在路由之前，surface 由服务端强制，不能靠请求参数切换。

  // Web：浏览器 cookie 会话（requireBrowserAccount）。
  app.use("/v1/web/*", requireBrowserAccount(auth));
  app.route("/", createWebAgentRoutes(services));

  // iOS：Bearer token，且必须是 iOS OAuth client 签发的。
  app.use("/v1/ios/*", requireAccount(store, IOS_OAUTH_CLIENT_ID));
  app.route("/", createIOSAgentRoutes(services));

  // Desktop：Bearer token，必须是 Desktop OAuth client 签发的。
  app.use("/v1/desktop/*", requireAccount(store, DESKTOP_OAUTH_CLIENT_ID));
  app.route("/", createDesktopSessionRoutes(services));

  // CLI + 模型网关：Bearer token，限定在允许的 client 集合内。
  app.use("/v1/cli/*", requireAccount(store, CLI_BEARER_CLIENT_IDS));
  app.use("/v1/model/*", requireAccount(store, MODEL_GATEWAY_CLIENT_IDS));
  app.route("/", createCliSessionRoutes(services));
  app.route("/", createModelGatewayRoutes(services));

  // 兜底：未匹配到任何路由返回 404；中间件/路由抛错统一交给 handleAppError。
  app.notFound((context) =>
    sendApiError(
      context,
      404,
      ErrorCodes.INVALID_REQUEST,
      `Unknown route: ${context.req.method} ${context.req.path}`,
    ),
  );
  app.onError(handleAppError);

  return app;
}

function normalizeAppConfig(input: BackendAppConfigInput): BackendAppConfig {
  return {
    quotaLimitTokens: input.quotaLimitTokens,
    devLoginSecret: input.devLoginSecret,
    webOrigin: input.webOrigin ?? "http://127.0.0.1:5173",
    publicBaseUrl: input.publicBaseUrl ?? "http://127.0.0.1:8787",
    iosOAuthRedirectUri: input.iosOAuthRedirectUri ?? "ai.beecode.ios://oauth/callback",
    desktopOAuthRedirectUri:
      input.desktopOAuthRedirectUri ?? "ai.beecode.desktop://oauth/callback",
    cookieSecure: input.cookieSecure ?? false,
    devAuthEnabled: input.devAuthEnabled ?? true,
    browserSessionTtlSeconds: input.browserSessionTtlSeconds ?? 30 * 24 * 60 * 60,
    accessTokenTtlSeconds: input.accessTokenTtlSeconds ?? 15 * 60,
    refreshTokenTtlSeconds: input.refreshTokenTtlSeconds ?? 30 * 24 * 60 * 60,
    authorizationCodeTtlSeconds: input.authorizationCodeTtlSeconds ?? 5 * 60,
    maxConcurrentWebTurnsPerAccount: input.maxConcurrentWebTurnsPerAccount ?? 4,
    maxConcurrentIOSTurnsPerAccount: input.maxConcurrentIOSTurnsPerAccount ?? 4,
  };
}
