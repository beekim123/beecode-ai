import { createServer, type Server } from "node:http";
import { createAdaptorServer } from "@hono/node-server";
import { createBackendApp, type BackendAppConfigInput, type BackendAppOptions } from "./app.js";
import type { ProviderAdapter } from "./provider/adapter.js";
import type { BackendStore } from "./store.js";

/** Node listener compatibility wrapper retained for the CLI and existing integration tests. */
export function createBackendServer(
  store: BackendStore,
  provider: ProviderAdapter,
  config: BackendAppConfigInput,
  options: BackendAppOptions = {},
): Server {
  const app = createBackendApp(store, provider, config, options);
  // Passing node:http createServer makes this branch a concrete HTTP Server.
  return createAdaptorServer({ fetch: app.fetch, createServer }) as Server;
}
