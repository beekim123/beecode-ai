import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configFromEnv,
  createProvider,
  loadBackendConfig,
  parseBackendConfigFile,
  resolveBackendConfigPath,
} from "../src/config.js";

describe("backend config", () => {
  it("binds to loopback by default", () => {
    expect(configFromEnv({}).host).toBe("127.0.0.1");
    expect(configFromEnv({}).desktopOAuthRedirectUri).toBe(
      "ai.beecode.desktop://oauth/callback",
    );
  });

  it("disables development auth beyond loopback and requires a secret when explicitly enabled", () => {
    expect(configFromEnv({ BEECODE_BACKEND_HOST: "0.0.0.0" }).devAuthEnabled).toBe(false);
    expect(() => configFromEnv({
      BEECODE_BACKEND_HOST: "0.0.0.0",
      BEECODE_DEV_AUTH_ENABLED: "true",
    })).toThrow(
      /BEECODE_DEV_LOGIN_SECRET/,
    );
    expect(
      configFromEnv({
        BEECODE_BACKEND_HOST: "0.0.0.0",
        BEECODE_DEV_AUTH_ENABLED: "true",
        BEECODE_DEV_LOGIN_SECRET: "secret",
      }).devAuthEnabled,
    ).toBe(true);
  });

  it("rejects invalid numeric and provider configuration", () => {
    expect(() => configFromEnv({ BEECODE_BACKEND_PORT: "NaN" })).toThrow(/BEECODE_BACKEND_PORT/);
    expect(() => configFromEnv({ BEECODE_PROVIDER: "unknown" })).toThrow(/BEECODE_PROVIDER/);
    expect(() =>
      configFromEnv({ BEECODE_DESKTOP_OAUTH_REDIRECT_URI: "https://desktop.test/callback" }),
    ).toThrow(/custom application scheme/);
    expect(() =>
      configFromEnv({
        BEECODE_DESKTOP_OAUTH_REDIRECT_URI: "ai.beecode.desktop://oauth/callback?next=web",
      }),
    ).toThrow(/query or fragment/);
  });

  it("requires credentials before creating a real provider", () => {
    expect(() => createProvider(configFromEnv({ BEECODE_PROVIDER: "openai" }))).toThrow(/OPENAI_API_KEY/);
    expect(() => createProvider(configFromEnv({ BEECODE_PROVIDER: "openai", OPENAI_API_KEY: "key" }))).toThrow(
      /OPENAI_MODEL/,
    );
    const provider = createProvider(
      configFromEnv({ BEECODE_PROVIDER: "openai", OPENAI_API_KEY: "key", OPENAI_MODEL: "model" }),
    );
    expect(provider.name).toBe("openai");
  });
});

describe("backend config file", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "beecode-config-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("treats a missing config file as empty", async () => {
    const config = await loadBackendConfig({}, join(directory, "missing.json"));
    expect(config.provider).toBe("fake");
  });

  it("loads provider settings from the config file", async () => {
    const configPath = join(directory, "backend-config.json");
    await writeFile(
      configPath,
      JSON.stringify({ provider: "anthropic", anthropicApiKey: "file-key", anthropicModel: "file-model" }),
    );
    const config = await loadBackendConfig({}, configPath);
    expect(config.provider).toBe("anthropic");
    expect(config.anthropicApiKey).toBe("file-key");
    expect(config.anthropicModel).toBe("file-model");
  });

  it("lets environment variables override file values", async () => {
    const configPath = join(directory, "backend-config.json");
    await writeFile(configPath, JSON.stringify({ provider: "fake", anthropicApiKey: "file-key", port: 9999 }));
    const config = await loadBackendConfig(
      { BEECODE_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "env-key", BEECODE_BACKEND_PORT: "8888" },
      configPath,
    );
    expect(config.provider).toBe("anthropic");
    expect(config.anthropicApiKey).toBe("env-key");
    expect(config.port).toBe(8888);
  });

  it("loads openai-compatible provider settings from the config file", async () => {
    const configPath = join(directory, "backend-config.json");
    await writeFile(
      configPath,
      JSON.stringify({
        provider: "openai",
        openaiApiKey: "file-key",
        openaiModel: "deepseek-chat",
        openaiBaseUrl: "https://api.deepseek.com/v1",
      }),
    );
    const config = await loadBackendConfig({}, configPath);
    expect(config.provider).toBe("openai");
    expect(config.openaiApiKey).toBe("file-key");
    expect(config.openaiModel).toBe("deepseek-chat");
    expect(config.openaiBaseUrl).toBe("https://api.deepseek.com/v1");
  });

  it("prefers the project config file over the home directory default", async () => {
    const projectRoot = join(directory, "repo");
    const packageDirectory = join(projectRoot, "apps", "backend");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(join(projectRoot, "pnpm-workspace.yaml"), "packages: []\n");
    await writeFile(join(projectRoot, "backend-config.json"), "{}");

    await expect(resolveBackendConfigPath({}, packageDirectory)).resolves.toBe(
      join(projectRoot, "backend-config.json"),
    );
    await expect(
      resolveBackendConfigPath({ BEECODE_BACKEND_CONFIG: "/elsewhere/config.json" }, packageDirectory),
    ).resolves.toBe("/elsewhere/config.json");
  });

  it("falls back to the home directory when no project config exists", async () => {
    const projectRoot = join(directory, "repo");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "pnpm-workspace.yaml"), "packages: []\n");

    await expect(resolveBackendConfigPath({}, projectRoot)).resolves.toBe(
      join(homedir(), ".beecode", "backend-config.json"),
    );
  });

  it("rejects invalid config file content", () => {
    expect(() => parseBackendConfigFile("not json", "config.json")).toThrow(/not valid JSON/);
    expect(() => parseBackendConfigFile("[]", "config.json")).toThrow(/must contain a JSON object/);
    expect(() => parseBackendConfigFile('{"unknown": 1}', "config.json")).toThrow(/unknown key "unknown"/);
    expect(() => parseBackendConfigFile('{"port": "8787"}', "config.json")).toThrow(/port must be an integer/);
    expect(() => parseBackendConfigFile('{"provider": "unknown"}', "config.json")).toThrow(/provider must be/);
    expect(() => parseBackendConfigFile('{"anthropicApiKey": 42}', "config.json")).toThrow(
      /anthropicApiKey must be a non-empty string/,
    );
  });
});
