import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { BeecodeError, ErrorCodes, ModelRequestSchema, type ModelStreamEvent } from "@beecode/protocol";
import type { BackendAppServices, BackendEnv } from "../app-context.js";
import { invalidRequest } from "../middleware/error-handler.js";

export function createModelGatewayRoutes(services: BackendAppServices): Hono<BackendEnv> {
  const routes = new Hono<BackendEnv>();

  routes.post(
    "/v1/model/stream",
    sValidator("json", ModelRequestSchema, (result, context) => {
      if (!result.success) return invalidRequest(context, result.error[0]?.message ?? "Invalid model request");
    }),
    (context) => {
      const account = context.get("account");
      const abortController = new AbortController();
      const lease = services.modelGateway.openStream(
        account.accountId,
        context.req.valid("json"),
        abortController.signal,
      );
      context.header("Cache-Control", "no-cache, no-transform");
      context.header("X-Accel-Buffering", "no");

      return streamSSE(context, async (stream) => {
        stream.onAbort(() => abortController.abort());
        try {
          for await (const event of lease.events) {
            await stream.writeSSE({ data: JSON.stringify(event) });
          }
        } catch (error: unknown) {
          if (!abortController.signal.aborted) {
            const beecode = BeecodeError.fromUnknown(error);
            const event: ModelStreamEvent = {
              type: "error",
              error: {
                code: beecode.code === ErrorCodes.INTERNAL ? ErrorCodes.MODEL_STREAM_ERROR : beecode.code,
                message: beecode.message,
                retryable: beecode.retryable,
              },
            };
            await stream.writeSSE({ data: JSON.stringify(event) });
          }
        }
      });
    },
  );

  return routes;
}
