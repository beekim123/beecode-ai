import { createInterface, type Interface } from "node:readline";
import type { BeecodeClient } from "@beecode/client-sdk";
import { BeecodeError, type Id, type Session, type WorkspaceSummary } from "@beecode/protocol";
import { TerminalRenderer } from "./render.js";

/**
 * 行式交互 REPL（设计文档第 11 节）。
 * 展示层只消费 Client SDK 的快照与事件。
 */
export interface ReplOptions {
  client: BeecodeClient;
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  workspace?: WorkspaceSummary;
}

const HELP = `Commands:
  /new            create a new CLI session
  /sessions       list your CLI sessions
  /open <id>      open a CLI session
  /cancel         cancel the running turn
  /exit           exit (only when no turn is running)`;

export async function runRepl(options: ReplOptions): Promise<void> {
  const { client, input, output } = options;
  const write = (text: string) => output.write(text);
  const renderer = new TerminalRenderer(write);

  let session: Session = await openInitialSession(client, renderer, write);
  let busy = false;
  let activeTurnId: Id | undefined;
  let cancelRequested = false;
  let resolveExit: (() => void) | undefined;

  // 在线事件订阅：SSE 语义；中断后重新拉快照而不是补发事件
  let unsubscribe = subscribeSession(session.id);

  const rl: Interface = createInterface({ input, output, terminal: false });
  const done = new Promise<void>((resolve) => (resolveExit = resolve));

  write(`Session: ${session.title} (${session.id})\n`);
  if (options.workspace) {
    write(`Workspace: ${options.workspace.name} (${options.workspace.fileCount} files)\n`);
  }
  prompt();

  rl.on("line", (raw) => {
    const line = raw.trim();
    void handleLine(line).catch((err) => {
      write(`\n[error] ${err instanceof Error ? err.message : String(err)}\n`);
      prompt();
    });
  });
  rl.on("close", () => {
    // CLI 在 Turn 中退出：尝试取消，等待最终可确认状态保存后再退出（设计文档第 12 节）
    void (async () => {
      if (busy) {
        cancelRequested = true;
        if (activeTurnId) {
          try {
            await client.cancelTurn(session.id, activeTurnId);
          } catch {
            // Turn 可能已在请求到达前进入终态。
          }
        }
        // 等待 Turn 进入终态并持久化（最多 3 秒）
        const deadline = Date.now() + 3000;
        while (busy && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
      }
      unsubscribe();
      resolveExit?.();
    })();
  });

  async function handleLine(line: string): Promise<void> {
    if (line.length === 0) {
      prompt();
      return;
    }

    if (line.startsWith("/")) {
      await handleCommand(line);
      return;
    }

    if (busy) {
      write("(a turn is running; use /cancel to stop it)\n");
      return; // 不重复 prompt：Turn 结束后会提示
    }

    busy = true;
    try {
      await client.submitMessage(session.id, line);
    } catch (err) {
      const beecode = BeecodeError.fromUnknown(err);
      write(`\n[error: ${beecode.code}] ${beecode.message}\n`);
    } finally {
      busy = false;
      activeTurnId = undefined;
      cancelRequested = false;
      prompt();
    }
  }

  async function handleCommand(line: string): Promise<void> {
    const [command, ...rest] = line.split(/\s+/);
    switch (command) {
      case "/new": {
        if (!ensureIdle()) return;
        session = await client.createSession();
        unsubscribe();
        unsubscribe = subscribeSession(session.id);
        write(`\nNew session: ${session.title} (${session.id})\n`);
        prompt();
        return;
      }
      case "/sessions": {
        const sessions = await client.listSessions();
        write("\n");
        for (const s of sessions) {
          const marker = s.id === session.id ? "*" : " ";
          write(`${marker} ${s.id}  ${s.updatedAt}  ${s.title}\n`);
        }
        prompt();
        return;
      }
      case "/open": {
        if (!ensureIdle()) return;
        const id = rest[0];
        if (!id) {
          write("\nUsage: /open <session-id>\n");
          prompt();
          return;
        }
        const snapshot = await client.getSessionSnapshot(id);
        session = snapshot.session;
        unsubscribe();
        unsubscribe = subscribeSession(session.id);
        write(`\nSession: ${session.title} (${session.id})\n\n`);
        renderer.renderHistory(snapshot.messages);
        prompt();
        return;
      }
      case "/cancel": {
        if (!busy) {
          write("\n(no running turn)\n");
          prompt();
          return;
        }
        cancelRequested = true;
        if (activeTurnId) await client.cancelTurn(session.id, activeTurnId);
        else write("\n[cancelling when the turn starts]\n");
        return; // cancelled 事件会输出；Turn 结束后恢复 prompt
      }
      case "/exit": {
        if (!ensureIdle()) return;
        unsubscribe();
        rl.close();
        return;
      }
      case "/help":
        write(`\n${HELP}\n`);
        prompt();
        return;
      default:
        write(`\nUnknown command: ${command}\n${HELP}\n`);
        prompt();
        return;
    }
  }

  function subscribeSession(sessionId: Id): () => void {
    return client.subscribe(sessionId, (event) => {
      if (event.type === "turn.started") {
        activeTurnId = event.turnId;
        if (cancelRequested) {
          void client.cancelTurn(sessionId, event.turnId).catch((error: unknown) => {
            write(`\n[error] ${error instanceof Error ? error.message : String(error)}\n`);
          });
        }
      }
      renderer.renderEvent(event);
    });
  }

  function ensureIdle(): boolean {
    if (busy) {
      write("\n(a turn is running; use /cancel first)\n");
      return false;
    }
    return true;
  }

  function prompt(): void {
    write("\nYou: ");
  }

  return done;
}

async function openInitialSession(
  client: BeecodeClient,
  renderer: TerminalRenderer,
  write: (text: string) => void,
): Promise<Session> {
  const sessions = await client.listSessions();
  const latest = sessions[0];
  if (latest) {
    const snapshot = await client.getSessionSnapshot(latest.id);
    renderer.renderHistory(snapshot.messages);
    return snapshot.session;
  }
  return client.createSession();
}
