import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createBackendServer, FakeProviderAdapter, InMemoryBackendStore } from "@beecode/backend";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const cliMain = join(repositoryRoot, "apps/cli/src/main.ts");
let server: Server;
let backendUrl: string;

beforeAll(async () => {
  server = createBackendServer(new InMemoryBackendStore(), new FakeProviderAdapter(), {
    quotaLimitTokens: 1_000_000,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  backendUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe("CLI process", () => {
  it("logs in and completes the calculator loop through the real process entry", async () => {
    const beecodeHome = await mkdtemp(join(tmpdir(), "beecode-process-e2e-"));
    const env = {
      ...process.env,
      BEECODE_HOME: beecodeHome,
      BEECODE_BACKEND_URL: backendUrl,
    };

    try {
      const login = startCli(["login", "--dev"], env);
      const loginExit = await login.waitForExit();
      expect(loginExit.code, login.stderr).toBe(0);
      expect(login.stdout).toContain("Logged in");

      const chat = startCli([], env);
      await chat.waitFor("Session:");
      chat.child.stdin.write("计算 1+1\n");
      await chat.waitFor("[done");
      chat.child.stdin.write("/exit\n");
      chat.child.stdin.end();
      const chatExit = await chat.waitForExit();

      expect(chatExit.code, chat.stderr).toBe(0);
      const toolIndex = chat.stdout.indexOf("Tool: calculator(");
      const resultIndex = chat.stdout.indexOf("Result: 2");
      const answerIndex = chat.stdout.indexOf("1+1 = 2");
      expect(toolIndex).toBeGreaterThan(-1);
      expect(resultIndex).toBeGreaterThan(toolIndex);
      expect(answerIndex).toBeGreaterThan(resultIndex);
    } finally {
      await rm(beecodeHome, { recursive: true });
    }
  }, 15_000);
});

interface CliProcessHarness {
  child: ChildProcessWithoutNullStreams;
  readonly stdout: string;
  readonly stderr: string;
  waitFor(needle: string, timeoutMs?: number): Promise<void>;
  waitForExit(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function startCli(args: string[], env: NodeJS.ProcessEnv): CliProcessHarness {
  const child = spawn(process.execPath, ["--import", "tsx", cliMain, ...args], {
    cwd: repositoryRoot,
    env,
    stdio: "pipe",
  });
  let stdout = "";
  let stderr = "";
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  return {
    child,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    waitFor: (needle, timeoutMs = 10_000) => waitForOutput(() => stdout, needle, timeoutMs),
    waitForExit: () => exit,
  };
}

function waitForOutput(read: () => string, needle: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (read().includes(needle)) {
        resolve();
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${JSON.stringify(needle)}. Output: ${read()}`));
        return;
      }
      setTimeout(check, 10);
    };
    check();
  });
}
