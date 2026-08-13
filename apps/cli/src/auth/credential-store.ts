import type { CliConfig } from "../config.js";
import { clearConfig, loadConfig, saveConfig } from "../config.js";

export interface CredentialStore {
  load(): Promise<CliConfig | undefined>;
  save(config: CliConfig): Promise<void>;
  clear(): Promise<void>;
}

/** Secure-file fallback. A system-keychain adapter can implement the same interface later. */
export class FileCredentialStore implements CredentialStore {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  load(): Promise<CliConfig | undefined> {
    return loadConfig(this.env);
  }

  save(config: CliConfig): Promise<void> {
    return saveConfig(config, this.env);
  }

  clear(): Promise<void> {
    return clearConfig(this.env);
  }
}
