import { homedir } from "node:os";
import { join } from "node:path";
import { createProvider, loadBackendConfig } from "./config.js";
import { createBackendServer } from "./http.js";
import { JsonFileBackendStore } from "./json-store.js";

async function main(): Promise<void> {
  const config = await loadBackendConfig();
  const store = config.dataFile
    ? new JsonFileBackendStore(config.dataFile)
    : new JsonFileBackendStore(join(homedir(), ".beecode", "backend-data.json"));
  await store.load();
  const provider = createProvider(config);

  const server = createBackendServer(store, provider, config, {
    log: (record) => console.info(`[beecode-backend] ${JSON.stringify(record)}`),
  });
  server.listen(config.port, config.host, () => {
    console.log(`[beecode-backend] listening on http://${config.host}:${config.port} (provider: ${provider.name})`);
  });
}

void main();
