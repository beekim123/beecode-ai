import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadConfig, saveConfig } from "../src/config.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function configEnvironment(): Promise<{ directory: string; env: NodeJS.ProcessEnv }> {
  const directory = await mkdtemp(join(tmpdir(), "beecode-config-"));
  temporaryDirectories.push(directory);
  return { directory, env: { BEECODE_HOME: directory } };
}

describe("CLI config", () => {
  it("writes credentials with private filesystem permissions", async () => {
    const { directory, env } = await configEnvironment();
    const config = { backendUrl: "http://127.0.0.1:8787", token: "bct_test", accountId: "acct_test" };

    await saveConfig(config, env);

    expect(await loadConfig(env)).toEqual(config);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect((await stat(configPath(env))).mode & 0o777).toBe(0o600);
  });

  it("rejects malformed or incomplete configuration", async () => {
    const { directory, env } = await configEnvironment();
    await mkdir(directory, { recursive: true });
    await writeFile(configPath(env), JSON.stringify({ backendUrl: "file:///tmp/x", token: "x" }), "utf8");

    expect(await loadConfig(env)).toBeUndefined();
  });
});
