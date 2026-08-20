import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import {
  BeecodeError,
  CreateSessionRequestSchema,
  ErrorCodes,
  ListSessionsQuerySchema,
  ReplaceDesktopSessionSnapshotRequestSchema,
  UpdateSessionRequestSchema,
  type DesktopSurfacePolicy,
} from "@beecode/protocol";
import type { BackendAppServices, BackendEnv } from "../app-context.js";
import { invalidRequest } from "../middleware/error-handler.js";

const desktopPolicy: DesktopSurfacePolicy = {
  surface: "desktop",
  allowedTools: ["calculator", "read_file"],
  allowedFeatures: {
    localWorkspace: true,
    shell: false,
    git: false,
    attachments: false,
  },
  limits: {
    maxTurnSteps: 8,
    maxInputBytes: 1_048_576,
    maxSnapshotBytes: 1_048_576,
  },
};

export function createDesktopSessionRoutes(services: BackendAppServices): Hono<BackendEnv> {
  const routes = new Hono<BackendEnv>();

  routes.get("/v1/desktop/capabilities", (context) => context.json(desktopPolicy));

  routes.get(
    "/v1/desktop/sessions",
    sValidator("query", ListSessionsQuerySchema, (result, context) => {
      if (!result.success) {
        return invalidRequest(context, result.error[0]?.message ?? "Invalid Desktop session query");
      }
    }),
    async (context) => {
      const query = context.req.valid("query");
      return context.json(
        await services.desktopSessions.list(
          context.get("account").accountId,
          query.cursor,
          query.limit,
        ),
      );
    },
  );

  routes.post(
    "/v1/desktop/sessions",
    sValidator("json", CreateSessionRequestSchema, (result, context) => {
      if (!result.success) {
        return invalidRequest(context, result.error[0]?.message ?? "Invalid Desktop session request");
      }
    }),
    async (context) => {
      const session = await services.desktopSessions.create(
        context.get("account").accountId,
        context.req.valid("json").title,
      );
      return context.json(session, 201);
    },
  );

  routes.get("/v1/desktop/sessions/:sessionId", async (context) => {
    const snapshot = await services.desktopSessions.getOwned(
      context.get("account").accountId,
      context.req.param("sessionId"),
    );
    if (!snapshot) {
      throw new BeecodeError(ErrorCodes.SESSION_NOT_FOUND, "Desktop session not found");
    }
    return context.json(snapshot);
  });

  routes.patch(
    "/v1/desktop/sessions/:sessionId",
    sValidator("json", UpdateSessionRequestSchema, (result, context) => {
      if (!result.success) {
        return invalidRequest(context, result.error[0]?.message ?? "Invalid Desktop session update");
      }
    }),
    async (context) => {
      const input = context.req.valid("json");
      return context.json(
        await services.desktopSessions.updateSession({
          accountId: context.get("account").accountId,
          sessionId: context.req.param("sessionId"),
          expectedVersion: input.expectedVersion,
          title: input.title,
          status: input.status,
        }),
      );
    },
  );

  routes.put(
    "/v1/desktop/sessions/:sessionId/snapshot",
    sValidator("json", ReplaceDesktopSessionSnapshotRequestSchema, (result, context) => {
      if (!result.success) {
        return invalidRequest(context, result.error[0]?.message ?? "Invalid Desktop snapshot");
      }
    }),
    async (context) => {
      return context.json(
        await services.desktopSessions.replaceDesktopSnapshot({
          ...context.req.valid("json"),
          accountId: context.get("account").accountId,
          sessionId: context.req.param("sessionId"),
        }),
      );
    },
  );

  return routes;
}
