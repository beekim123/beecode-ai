import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  CreateSessionRequestSchema,
  ErrorCodes,
  ListSessionsQuerySchema,
  SubmitTurnRequestSchema,
  UpdateSessionRequestSchema,
} from "@beecode/protocol";
import type { BackendAppServices, BackendEnv } from "../app-context.js";
import { invalidRequest, sendApiError } from "../middleware/error-handler.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

export function createIOSAgentRoutes(services: BackendAppServices): Hono<BackendEnv> {
  const routes = new Hono<BackendEnv>();

  routes.get("/v1/ios/capabilities", (context) =>
    context.json(services.iosRuntime.getCapabilities()),
  );

  routes.post(
    "/v1/ios/sessions",
    sValidator("json", CreateSessionRequestSchema, (result, context) => {
      if (!result.success) {
        return invalidRequest(context, result.error[0]?.message ?? "Invalid session request");
      }
    }),
    async (context) => {
      await services.iosRuntime.ready();
      const session = await services.iosSessions.create(
        context.get("account").accountId,
        context.req.valid("json").title,
      );
      return context.json(session, 201);
    },
  );

  routes.get(
    "/v1/ios/sessions",
    sValidator("query", ListSessionsQuerySchema, (result, context) => {
      if (!result.success) {
        return invalidRequest(context, result.error[0]?.message ?? "Invalid session query");
      }
    }),
    async (context) => {
      await services.iosRuntime.ready();
      const query = context.req.valid("query");
      return context.json(
        await services.iosSessions.list(
          context.get("account").accountId,
          query.cursor,
          query.limit,
        ),
      );
    },
  );

  routes.get("/v1/ios/sessions/:sessionId", async (context) => {
    const snapshot = await services.iosRuntime.getSnapshot(
      context.get("account").accountId,
      context.req.param("sessionId"),
    );
    return context.json(snapshot);
  });

  routes.patch(
    "/v1/ios/sessions/:sessionId",
    sValidator("json", UpdateSessionRequestSchema, (result, context) => {
      if (!result.success) {
        return invalidRequest(context, result.error[0]?.message ?? "Invalid session update");
      }
    }),
    async (context) => {
      await services.iosRuntime.ready();
      const input = context.req.valid("json");
      return context.json(
        await services.iosSessions.updateSession({
          accountId: context.get("account").accountId,
          sessionId: context.req.param("sessionId"),
          expectedVersion: input.expectedVersion,
          title: input.title,
          status: input.status,
        }),
      );
    },
  );

  routes.post(
    "/v1/ios/sessions/:sessionId/turns",
    sValidator("json", SubmitTurnRequestSchema, (result, context) => {
      if (!result.success) {
        return invalidRequest(context, result.error[0]?.message ?? "Invalid turn request");
      }
    }),
    async (context) => {
      const input = context.req.valid("json");
      const result = await services.iosRuntime.submitTurn({
        accountId: context.get("account").accountId,
        sessionId: context.req.param("sessionId"),
        text: input.text,
        idempotencyKey: input.idempotencyKey,
      });
      return context.json(result, 202);
    },
  );

  routes.post(
    "/v1/ios/sessions/:sessionId/turns/:turnId/cancel",
    async (context) => {
      await services.iosRuntime.cancelTurn(
        context.get("account").accountId,
        context.req.param("sessionId"),
        context.req.param("turnId"),
      );
      return context.body(null, 204);
    },
  );

  routes.get("/v1/ios/sessions/:sessionId/events", async (context) => {
    const accountId = context.get("account").accountId;
    const sessionId = context.req.param("sessionId");
    const snapshot = await services.iosSessions.getOwned(accountId, sessionId);
    if (!snapshot) {
      return sendApiError(context, 404, ErrorCodes.SESSION_NOT_FOUND, "iOS session not found");
    }
    context.header("Cache-Control", "no-cache, no-transform");
    context.header("X-Accel-Buffering", "no");

    return streamSSE(context, async (stream) => {
      let resolveAbort: (() => void) | undefined;
      const aborted = new Promise<void>((resolve) => {
        resolveAbort = resolve;
      });
      let writes = Promise.resolve();
      const unsubscribe = services.iosRuntime.subscribe(sessionId, (envelope) => {
        writes = writes.then(() =>
          stream.writeSSE({
            event: "agent",
            id: envelope.eventId,
            data: JSON.stringify(envelope),
          }),
        );
      });
      stream.onAbort(() => resolveAbort?.());
      const heartbeat = setInterval(() => {
        writes = writes.then(async () => {
          await stream.write(": heartbeat\n\n");
        });
      }, HEARTBEAT_INTERVAL_MS);
      try {
        await stream.writeSSE({
          event: "stream.connected",
          data: JSON.stringify({ sequence: services.iosRuntime.getSequence(sessionId) }),
        });
        await aborted;
        await writes;
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });

  return routes;
}
