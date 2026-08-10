import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createBackendServer, FakeProviderAdapter, InMemoryBackendStore } from "@beecode/backend";
import type { ModelGateway } from "@beecode/protocol";
import { FakeModelGateway } from "@beecode/testing";
import { composeCli } from "../src/compose.js";
import { runRepl } from "../src/repl.js";

/**
 * 第一阶段最高层验收边界（设计文档 13.1）：
 * 从 CLI 交互入口开始，经过 Client SDK、In-Process Transport、
 * Agent Core、真实 HTTP 后端（Fake Provider）与 Tool Registry，
 * 验证用户可观察的完整行为。
 */

let server: Server;
let baseUrl: string;
let token: string;
let store: InMemoryBackendStore;

beforeAll(async () => {
  store = new InMemoryBackendStore();
  server = createBackendServer(store, new FakeProviderAdapter(), { quotaLimitTokens: 1_000_000 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const res = await fetch(`${baseUrl}/v1/auth/dev-token`, { method: "POST" });
  token = ((await res.json()) as { token: string }).token;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

interface ReplHarness {
  input: PassThrough;
  output: PassThrough;
  text: () => string;
  waitFor: (needle: string, timeoutMs?: number) => Promise<void>;
  waitForSequence: (needles: string[], timeoutMs?: number) => Promise<void>;
  send: (line: string) => void;
  done: Promise<void>;
}

function startRepl(gateway?: ModelGateway): ReplHarness {
  const input = new PassThrough();
  const output = new PassThrough();
  let buffer = "";
  output.on("data", (chunk) => (buffer += chunk.toString()));
  const waiters: { predicate: () => boolean; resolve: () => void }[] = [];
  const notify = () => {
    for (const w of [...waiters]) {
      if (w.predicate()) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
    }
  };
  output.on("data", notify);

  const { client } = composeCli({
    config: { backendUrl: baseUrl, token, accountId: "test" },
    gateway,
  });
  const done = runRepl({ client, input, output });

  const waitUntil = (predicate: () => boolean, description: string, timeoutMs = 10_000) =>
    new Promise<void>((resolve, reject) => {
      if (predicate()) return resolve();
      const timer = setTimeout(
        () => reject(new Error(`Timed out waiting for ${description}. Output so far:\n${buffer}`)),
        timeoutMs,
      );
      waiters.push({
        predicate,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      });
    });

  return {
    input,
    output,
    text: () => buffer,
    send: (line: string) => input.write(`${line}\n`),
    waitFor: (needle, timeoutMs = 10_000) =>
      waitUntil(() => buffer.includes(needle), JSON.stringify(needle), timeoutMs),
    // Turn 渲染完成与 REPL 恢复可输入之间存在一个极小的持久化窗口；
    // 按顺序等待 "[done" 与其后出现的提示符，代表 Turn 完全结束
    waitForSequence: (needles, timeoutMs = 10_000) =>
      waitUntil(
        () => {
          let from = 0;
          for (const needle of needles) {
            const idx = buffer.indexOf(needle, from);
            if (idx < 0) return false;
            from = idx + needle.length;
          }
          return true;
        },
        `sequence ${needles.map((n) => JSON.stringify(n)).join(" -> ")}`,
        timeoutMs,
      ),
    done,
  };
}

describe("CLI 端到端", () => {
  it("“计算 1+1”完整链路：Tool Call → Result 2 → 最终回答，且状态可区分", async () => {
    const repl = startRepl();
    await repl.waitFor("Session:");

    repl.send("计算 1+1");
    await repl.waitFor("[done");

    const out = repl.text();
    const toolIdx = out.indexOf("Tool: calculator(");
    const resultIdx = out.indexOf("Result: 2");
    const answerIdx = out.indexOf("1+1 = 2");
    expect(toolIdx).toBeGreaterThan(-1);
    expect(resultIdx).toBeGreaterThan(toolIdx);
    expect(answerIdx).toBeGreaterThan(resultIdx);

    await repl.waitForSequence(["[done", "\nYou: "]);
    repl.send("/exit");
    await repl.done;
  });

  it("CLI 重启后重新加载完整 Session 快照", async () => {
    const repl1 = startRepl();
    await repl1.waitFor("Session:");
    repl1.send("计算 3*7");
    await repl1.waitFor("[done");
    await repl1.waitForSequence(["[done", "\nYou: "]);
    repl1.send("/exit");
    await repl1.done;

    // “重启”：全新组合再次进入，应打开最近 Session 并展示历史
    const repl2 = startRepl();
    await repl2.waitFor("Result:");
    const history = repl2.text();
    expect(history).toContain("You: 计算 3*7");
    expect(history).toContain("3*7 = 21");

    repl2.send("/exit");
    await repl2.done;
  });

  it("同账号第二台 CLI 设备可以查看 Session 历史", async () => {
    const device1 = startRepl();
    await device1.waitFor("Session:");
    device1.send("计算 10-4");
    await device1.waitFor("[done");
    await device1.waitForSequence(["[done", "\nYou: "]);
    // 第二台“设备”：独立组合，同一账号令牌
    const device2 = composeCli({ config: { backendUrl: baseUrl, token, accountId: "test" } });
    const sessions = await device2.client.listSessions();
    const target = sessions.find((s) => s.title.length > 0);
    expect(target).toBeDefined();
    if (!target) throw new Error("Expected a session for the second CLI device");
    const snapshot = await device2.client.getSessionSnapshot(target.id);
    const texts = JSON.stringify(snapshot.messages);
    expect(texts).toContain("10-4");

    device1.send("/exit");
    await device1.done;
  });

  it("/sessions 与 /new 命令可用", async () => {
    const repl = startRepl();
    await repl.waitFor("Session:");
    repl.send("/sessions");
    await repl.waitFor("ses_");
    repl.send("/new");
    await repl.waitFor("New session:");
    repl.send("/exit");
    await repl.done;
  });

  it("未认证时进入交互失败并提示登录", async () => {
    const { client } = composeCli({ config: { backendUrl: baseUrl, token: "bad-token", accountId: "x" } });
    await expect(client.listSessions()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("/cancel can cancel a turn requested before turn.started arrives", async () => {
    const repl = startRepl(
      new FakeModelGateway({
        steps: [{ kind: "text", text: "slow response" }],
        eventDelayMs: 50,
      }),
    );
    await repl.waitFor("Session:");

    repl.send("hello");
    repl.send("/cancel");
    await repl.waitFor("[cancelled]");
    await repl.waitForSequence(["[cancelled]", "\nYou: "]);

    repl.send("/exit");
    await repl.done;
  });
});
