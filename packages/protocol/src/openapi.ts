import * as z from "zod";
import {
  AgentEventEnvelopeSchema,
  AccountSummarySchema,
  CapabilitySetSchema,
  CreateSessionRequestSchema,
  DevelopmentTokenResponseSchema,
  ErrorResponseSchema,
  MessageSchema,
  ModelRequestSchema,
  ModelStreamEventSchema,
  QuotaResponseSchema,
  ReplaceCliSessionRequestSchema,
  SessionPageSchema,
  SessionSchema,
  SessionSnapshotSchema,
  SubmitTurnRequestSchema,
  SubmitTurnResponseSchema,
  ToolCallSchema,
  TurnSchema,
  UpdateWebSessionRequestSchema,
  UpdateSessionRequestSchema,
  UsageSchema,
} from "./schemas.js";

type JsonObject = Record<string, unknown>;

const json = (schema: z.ZodType): JsonObject =>
  inlineLocalDefinitions(z.toJSONSchema(schema, { target: "draft-2020-12" }));
const ref = (name: string): JsonObject => ({ $ref: `#/components/schemas/${name}` });
const jsonContent = (schema: JsonObject): JsonObject => ({
  "application/json": { schema },
});
const response = (description: string, schema: JsonObject): JsonObject => ({
  description,
  content: jsonContent(schema),
});
const emptyResponse = (description: string): JsonObject => ({ description });
const formContent = (schema: JsonObject): JsonObject => ({
  "application/x-www-form-urlencoded": { schema },
});
const errorResponses = {
  "400": response("Invalid request", ref("ErrorResponse")),
  "401": response("Authentication required", ref("ErrorResponse")),
  "404": response("Resource not found", ref("ErrorResponse")),
  "409": response("State conflict", ref("ErrorResponse")),
  "500": response("Internal error", ref("ErrorResponse")),
} satisfies Record<string, JsonObject>;

function inlineLocalDefinitions(document: JsonObject): JsonObject {
  const definitions = isJsonObject(document.$defs) ? document.$defs : {};
  return inlineJsonValue(document, definitions, new Set()) as JsonObject;
}

function inlineJsonValue(
  value: unknown,
  definitions: JsonObject,
  resolving: ReadonlySet<string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => inlineJsonValue(entry, definitions, resolving));
  }
  if (!isJsonObject(value)) return value;

  const localReference = typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")
    ? decodeURIComponent(value.$ref.slice("#/$defs/".length))
    : undefined;
  if (localReference) {
    const definition = definitions[localReference];
    if (!isJsonObject(definition) || resolving.has(localReference)) {
      throw new TypeError(`OpenAPI schema contains an unresolved local definition: ${localReference}`);
    }
    const nextResolving = new Set(resolving);
    nextResolving.add(localReference);
    const resolved = inlineJsonValue(definition, definitions, nextResolving);
    if (!isJsonObject(resolved)) {
      throw new TypeError(`OpenAPI local definition is not an object: ${localReference}`);
    }
    const siblings = Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "$ref" && key !== "$defs")
        .map(([key, entry]) => [key, inlineJsonValue(entry, definitions, resolving)]),
    );
    return { ...resolved, ...siblings };
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "$defs")
      .map(([key, entry]) => [key, inlineJsonValue(entry, definitions, resolving)]),
  );
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Phase 2 已实现公开 API 的机器可读契约。 */
export const phase2OpenApiDocument = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "Beecode API",
    version: "2.0.0",
    description: "Beecode CLI compatibility, browser authentication, and Web Agent protocol.",
  },
  paths: {
    "/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        responses: {
          "200": {
            description: "OpenAPI 3.1 document",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/v1/auth/dev-token": {
      post: {
        operationId: "createDevelopmentToken",
        responses: {
          "200": response("Development token", ref("DevelopmentTokenResponse")),
          "403": response("Development login denied", ref("ErrorResponse")),
        },
      },
    },
    "/v1/auth/login/{provider}": {
      parameters: [
        { name: "provider", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      get: {
        operationId: "beginBrowserLogin",
        parameters: [
          { name: "returnTo", in: "query", required: false, schema: { type: "string" } },
          { name: "loginHint", in: "query", required: false, schema: { type: "string" } },
        ],
        responses: {
          "302": {
            description: "Redirect to the configured identity provider",
            headers: { Location: { schema: { type: "string", format: "uri" } } },
          },
          ...errorResponses,
        },
      },
    },
    "/v1/auth/callback/{provider}": {
      parameters: [
        { name: "provider", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      get: {
        operationId: "completeBrowserLogin",
        parameters: [
          { name: "code", in: "query", required: true, schema: { type: "string", minLength: 1 } },
          { name: "state", in: "query", required: true, schema: { type: "string", minLength: 1 } },
        ],
        responses: {
          "302": {
            description: "Set an HttpOnly browser session and redirect to the Web app",
            headers: { Location: { schema: { type: "string", format: "uri" } } },
          },
          ...errorResponses,
        },
      },
    },
    "/v1/auth/logout": {
      post: {
        operationId: "logoutBrowserSession",
        security: [{ browserSession: [] }],
        responses: { "204": emptyResponse("Browser session revoked"), ...errorResponses },
      },
    },
    "/oauth/authorize": {
      get: {
        operationId: "showCliAuthorization",
        security: [{ browserSession: [] }],
        responses: {
          "200": {
            description: "CLI authorization consent page",
            content: { "text/html": { schema: { type: "string" } } },
          },
          "302": {
            description: "Redirect to browser login while preserving the authorization request",
            headers: { Location: { schema: { type: "string", format: "uri" } } },
          },
          ...errorResponses,
        },
      },
      post: {
        operationId: "approveCliAuthorization",
        security: [{ browserSession: [] }],
        requestBody: {
          required: true,
          content: formContent({
            type: "object",
            required: ["client_id", "redirect_uri", "code_challenge", "state", "decision"],
            properties: {
              client_id: { type: "string" },
              redirect_uri: { type: "string", format: "uri" },
              code_challenge: { type: "string" },
              state: { type: "string" },
              decision: { type: "string", enum: ["allow", "deny"] },
            },
          }),
        },
        responses: {
          "302": {
            description: "Redirect to the exact registered loopback callback",
            headers: { Location: { schema: { type: "string", format: "uri" } } },
          },
          ...errorResponses,
        },
      },
    },
    "/oauth/token": {
      post: {
        operationId: "exchangeCliToken",
        requestBody: {
          required: true,
          content: formContent({
            type: "object",
            required: ["grant_type", "client_id"],
            properties: {
              grant_type: { type: "string", enum: ["authorization_code", "refresh_token"] },
              client_id: { type: "string" },
              code: { type: "string" },
              redirect_uri: { type: "string", format: "uri" },
              code_verifier: { type: "string" },
              refresh_token: { type: "string" },
            },
          }),
        },
        responses: {
          "200": response("Rotated CLI OAuth tokens", {
            type: "object",
            required: ["access_token", "refresh_token", "token_type", "expires_in", "account_id"],
            properties: {
              access_token: { type: "string" },
              refresh_token: { type: "string" },
              token_type: { const: "Bearer" },
              expires_in: { type: "integer", minimum: 1 },
              account_id: { type: "string" },
            },
          }),
          ...errorResponses,
        },
      },
    },
    "/oauth/revoke": {
      post: {
        operationId: "revokeCliToken",
        requestBody: {
          required: true,
          content: formContent({
            type: "object",
            required: ["token"],
            properties: { token: { type: "string" } },
          }),
        },
        responses: { "204": emptyResponse("Token family revoked"), ...errorResponses },
      },
    },
    "/v1/quota": {
      get: {
        operationId: "getQuota",
        responses: { "200": response("Current account quota", ref("QuotaResponse")), ...errorResponses },
      },
    },
    "/v1/me": {
      get: {
        operationId: "getCurrentAccount",
        responses: { "200": response("Current account", ref("AccountSummary")), ...errorResponses },
      },
    },
    "/v1/cli/sessions": {
      get: {
        operationId: "listCliSessions",
        responses: {
          "200": response("CLI sessions", { type: "array", items: ref("Session") }),
          ...errorResponses,
        },
      },
      post: {
        operationId: "createCliSession",
        requestBody: { required: false, content: jsonContent(ref("CreateSessionRequest")) },
        responses: { "201": response("Created CLI session", ref("Session")), ...errorResponses },
      },
    },
    "/v1/cli/sessions/{sessionId}": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      get: {
        operationId: "getCliSession",
        responses: { "200": response("CLI session snapshot", ref("SessionSnapshot")), ...errorResponses },
      },
      put: {
        operationId: "replaceCliSession",
        requestBody: { required: true, content: jsonContent(ref("ReplaceCliSessionRequest")) },
        responses: { "200": response("Updated CLI session", ref("Session")), ...errorResponses },
      },
    },
    "/v1/model/stream": {
      post: {
        operationId: "streamModel",
        requestBody: { required: true, content: jsonContent(ref("ModelRequest")) },
        responses: {
          "200": {
            description: "Normalized model SSE stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
            "x-beecode-event-schema": ref("ModelStreamEvent"),
          },
          ...errorResponses,
        },
      },
    },
    "/v1/web/capabilities": {
      get: {
        operationId: "getWebCapabilities",
        responses: { "200": response("Web runtime capabilities", ref("CapabilitySet")), ...errorResponses },
      },
    },
    "/v1/web/sessions": {
      get: {
        operationId: "listWebSessions",
        parameters: [
          { name: "cursor", in: "query", required: false, schema: { type: "string", minLength: 1 } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: { "200": response("Web session page", ref("SessionPage")), ...errorResponses },
      },
      post: {
        operationId: "createWebSession",
        requestBody: { required: false, content: jsonContent(ref("CreateSessionRequest")) },
        responses: { "201": response("Created Web session", ref("Session")), ...errorResponses },
      },
    },
    "/v1/web/sessions/{sessionId}": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      get: {
        operationId: "getWebSession",
        responses: { "200": response("Web session snapshot", ref("SessionSnapshot")), ...errorResponses },
      },
      patch: {
        operationId: "updateWebSession",
        requestBody: { required: true, content: jsonContent(ref("UpdateWebSessionRequest")) },
        responses: { "200": response("Updated Web session", ref("Session")), ...errorResponses },
      },
    },
    "/v1/web/sessions/{sessionId}/turns": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      post: {
        operationId: "createWebTurn",
        requestBody: { required: true, content: jsonContent(ref("SubmitTurnRequest")) },
        responses: { "202": response("Accepted Web turn", ref("SubmitTurnResponse")), ...errorResponses },
      },
    },
    "/v1/web/sessions/{sessionId}/turns/{turnId}/cancel": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
        { name: "turnId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      post: {
        operationId: "cancelWebTurn",
        responses: { "204": emptyResponse("Turn cancelled or already terminal"), ...errorResponses },
      },
    },
    "/v1/web/sessions/{sessionId}/events": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      get: {
        operationId: "subscribeWebSessionEvents",
        responses: {
          "200": {
            description: "Web session SSE events",
            content: { "text/event-stream": { schema: { type: "string" } } },
            "x-beecode-event-schema": ref("AgentEventEnvelope"),
          },
          ...errorResponses,
        },
      },
    },
    "/v1/ios/capabilities": {
      get: {
        operationId: "getIOSCapabilities",
        security: [{ bearerAuth: [] }],
        responses: { "200": response("iOS runtime capabilities", ref("CapabilitySet")), ...errorResponses },
      },
    },
    "/v1/ios/sessions": {
      get: {
        operationId: "listIOSSessions",
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: "cursor", in: "query", required: false, schema: { type: "string", minLength: 1 } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100 } },
        ],
        responses: { "200": response("iOS session page", ref("SessionPage")), ...errorResponses },
      },
      post: {
        operationId: "createIOSSession",
        security: [{ bearerAuth: [] }],
        requestBody: { required: false, content: jsonContent(ref("CreateSessionRequest")) },
        responses: { "201": response("Created iOS session", ref("Session")), ...errorResponses },
      },
    },
    "/v1/ios/sessions/{sessionId}": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      get: {
        operationId: "getIOSSession",
        security: [{ bearerAuth: [] }],
        responses: { "200": response("iOS session snapshot", ref("SessionSnapshot")), ...errorResponses },
      },
      patch: {
        operationId: "updateIOSSession",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: jsonContent(ref("UpdateSessionRequest")) },
        responses: { "200": response("Updated iOS session", ref("Session")), ...errorResponses },
      },
    },
    "/v1/ios/sessions/{sessionId}/turns": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      post: {
        operationId: "createIOSTurn",
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: jsonContent(ref("SubmitTurnRequest")) },
        responses: { "202": response("Accepted iOS turn", ref("SubmitTurnResponse")), ...errorResponses },
      },
    },
    "/v1/ios/sessions/{sessionId}/turns/{turnId}/cancel": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
        { name: "turnId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      post: {
        operationId: "cancelIOSTurn",
        security: [{ bearerAuth: [] }],
        responses: { "204": emptyResponse("Turn cancelled or already terminal"), ...errorResponses },
      },
    },
    "/v1/ios/sessions/{sessionId}/events": {
      parameters: [
        { name: "sessionId", in: "path", required: true, schema: { type: "string", minLength: 1 } },
      ],
      get: {
        operationId: "subscribeIOSSessionEvents",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "iOS session SSE events",
            content: { "text/event-stream": { schema: { type: "string" } } },
            "x-beecode-event-schema": ref("AgentEventEnvelope"),
          },
          ...errorResponses,
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer" },
      browserSession: { type: "apiKey", in: "cookie", name: "beecode_session" },
    },
    schemas: {
      AccountSummary: json(AccountSummarySchema),
      AgentEventEnvelope: json(AgentEventEnvelopeSchema),
      CapabilitySet: json(CapabilitySetSchema),
      CreateSessionRequest: json(CreateSessionRequestSchema),
      DevelopmentTokenResponse: json(DevelopmentTokenResponseSchema),
      ErrorResponse: json(ErrorResponseSchema),
      Message: json(MessageSchema),
      ModelRequest: json(ModelRequestSchema),
      ModelStreamEvent: json(ModelStreamEventSchema),
      QuotaResponse: json(QuotaResponseSchema),
      ReplaceCliSessionRequest: json(ReplaceCliSessionRequestSchema),
      Session: json(SessionSchema),
      SessionPage: json(SessionPageSchema),
      SessionSnapshot: json(SessionSnapshotSchema),
      SubmitTurnRequest: json(SubmitTurnRequestSchema),
      SubmitTurnResponse: json(SubmitTurnResponseSchema),
      ToolCall: json(ToolCallSchema),
      Turn: json(TurnSchema),
      UpdateSessionRequest: json(UpdateSessionRequestSchema),
      UpdateWebSessionRequest: json(UpdateWebSessionRequestSchema),
      Usage: json(UsageSchema),
    },
  },
} as const;

export type Phase2OpenApiDocument = typeof phase2OpenApiDocument;
