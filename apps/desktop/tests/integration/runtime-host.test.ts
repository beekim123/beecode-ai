import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackendApp, FakeProviderAdapter, hashSecret, InMemoryBackendStore } from "@beecode/backend";
import {
  DESKTOP_IPC_PROTOCOL_VERSION,
  ErrorCodes,
  parseDesktopIpcFrame,
  type DesktopIpcControlFrame,
  type DesktopIpcEventFrame,
  type DesktopIpcFrame,
  type DesktopIpcMethod,
  type DesktopIpcMethodResultMap,
  type DesktopIpcRequestFrame,
  type DesktopIpcResponseFrame,
  type ModelRequest,
} from "@beecode/protocol";
import { describe, expect, it } from "vitest";
import { DesktopRuntimeHost } from "../../src/runtime/runtime-host.js";

type RequestPayload<TMethod extends DesktopIpcMethod> = Extract<
  DesktopIpcRequestFrame,
  { method: TMethod }
>["payload"];

interface RuntimeHarnessOptions {
  runtimeId: string;
  accessToken: string;
  fetchImpl: typeof fetch;
  replacesRuntimeId?: string;
}

class RuntimeHarness {
  readonly events: DesktopIpcEventFrame[] = [];
  readonly controls: DesktopIpcControlFrame[] = [];

  private readonly host: DesktopRuntimeHost;
  private readonly responses = new Map<string, DesktopIpcResponseFrame>();
  private readonly responseWaiters = new Map<string, (frame: DesktopIpcResponseFrame) => void>();
  private requestSequence = 0;

  constructor(private readonly options: RuntimeHarnessOptions) {
    this.host = new DesktopRuntimeHost({
      runtimeId: options.runtimeId,
      fetchImpl: options.fetchImpl,
      send: (frame) => this.receive(frame),
    });
  }

  async initialize(): Promise<void> {
    await this.host.initialize(
      parseDesktopIpcFrame({
        protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        kind: "control",
        control: "runtime.initialize",
        payload: {
          startupId: `startup_${this.options.runtimeId}`,
          selectedProtocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
          backendUrl: "http://backend.test",
          auth: { authenticated: true, accessToken: this.options.accessToken },
          ...(this.options.replacesRuntimeId
            ? { replacesRuntimeId: this.options.replacesRuntimeId }
            : {}),
        },
      }) as Extract<DesktopIpcControlFrame, { control: "runtime.initialize" }>,
    );
  }

  async updateAuth(accessToken: string): Promise<void> {
    await this.host.updateAuth(
      parseDesktopIpcFrame({
        protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        kind: "control",
        control: "auth.update",
        payload: { auth: { authenticated: true, accessToken } },
      }) as Extract<DesktopIpcControlFrame, { control: "auth.update" }>,
    );
  }

  request<TMethod extends DesktopIpcMethod>(
    method: TMethod,
    payload: RequestPayload<TMethod>,
  ): Promise<DesktopIpcMethodResultMap[TMethod]> {
    const requestId = `${this.options.runtimeId}_request_${++this.requestSequence}`;
    const response = new Promise<DesktopIpcResponseFrame>((resolve) => {
      const received = this.responses.get(requestId);
      if (received) {
        this.responses.delete(requestId);
        resolve(received);
      } else {
        this.responseWaiters.set(requestId, resolve);
      }
    });
    const frame = parseDesktopIpcFrame({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "request",
      requestId,
      method,
      payload,
    });
    if (frame.kind !== "request") throw new TypeError("Expected a Desktop IPC request frame");
    this.host.handleRequest(frame);
    return response.then((received) => {
      if (!received.result.ok) throw new Error(received.result.error.code);
      return received.result.value as DesktopIpcMethodResultMap[TMethod];
    });
  }

  waitForEvent(type: DesktopIpcEventFrame["event"] | string): Promise<DesktopIpcEventFrame> {
    const existing = this.events.find(
      (frame) => frame.event === type || (frame.event === "agent.event" && frame.payload.event.type === type),
    );
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const frame = this.events.find(
          (candidate) =>
            candidate.event === type ||
            (candidate.event === "agent.event" && candidate.payload.event.type === type),
        );
        if (!frame) return;
        clearInterval(interval);
        resolve(frame);
      }, 1);
    });
  }

  private receive(frame: DesktopIpcFrame): void {
    const parsed = parseDesktopIpcFrame(frame);
    if (parsed.kind === "event") {
      this.events.push(parsed);
      return;
    }
    if (parsed.kind === "control") {
      this.controls.push(parsed);
      return;
    }
    if (parsed.kind !== "response") return;
    const waiter = this.responseWaiters.get(parsed.requestId);
    if (waiter) {
      this.responseWaiters.delete(parsed.requestId);
      waiter(parsed);
    } else {
      this.responses.set(parsed.requestId, parsed);
    }
  }
}

describe("Desktop Runtime vertical slice", () => {
  it("configures a local Workspace and executes read_file without exposing its absolute path", async () => {
    const directoryPath = await mkdtemp(join(tmpdir(), "beecode-desktop-workspace-"));
    try {
      await writeFile(join(directoryPath, "README.md"), "desktop workspace", "utf8");
      const backend = createTestBackend(new ReadFileProvider());
      const runtime = new RuntimeHarness({
        runtimeId: "runtime_workspace",
        accessToken: backend.accessToken,
        fetchImpl: backend.fetchImpl,
      });
      await runtime.initialize();

      const before = await runtime.request("runtime.getCapabilities", {});
      expect(before.tools.map((tool) => tool.name)).not.toContain("read_file");
      expect(before.features.localWorkspace).toEqual({ available: false, reason: "not_configured" });

      const configured = await runtime.request("workspace.configure", { directoryPath });
      expect(configured).toMatchObject({ name: directoryPath.split("/").at(-1), fileCount: 1 });
      expect(configured).not.toHaveProperty("directoryPath");
      expect(await runtime.request("workspace.get", {})).toEqual(configured);

      const capabilities = await runtime.request("runtime.getCapabilities", {});
      expect(capabilities.tools.map((tool) => tool.name)).toContain("read_file");
      expect(capabilities.features.localWorkspace).toEqual({ available: true });

      const session = await runtime.request("session.create", { title: "Workspace" });
      await runtime.request("session.subscribe", { sessionId: session.id });
      const result = await runtime.request("turn.submit", {
        sessionId: session.id,
        text: "读取 README.md",
        idempotencyKey: "desktop-workspace-0001",
      });
      const snapshot = await runtime.request("session.getSnapshot", { sessionId: session.id });

      expect(result.turn.status).toBe("completed");
      expect(JSON.stringify(snapshot.messages)).toContain('"name":"read_file"');
      expect(JSON.stringify(snapshot.messages)).toContain("desktop workspace");

      await runtime.request("workspace.clear", {});
      expect(await runtime.request("workspace.get", {})).toBeNull();
      expect((await runtime.request("runtime.getCapabilities", {})).tools.map((tool) => tool.name))
        .not.toContain("read_file");
    } finally {
      await rm(directoryPath, { recursive: true, force: true });
    }
  });

  it("persists a calculator Tool Call, streamed answer, and terminal snapshot", async () => {
    const backend = createTestBackend();
    const runtime = new RuntimeHarness({
      runtimeId: "runtime_calculator",
      accessToken: backend.accessToken,
      fetchImpl: backend.fetchImpl,
    });
    await runtime.initialize();

    expect(runtime.controls.at(-1)).toMatchObject({
      kind: "control",
      control: "runtime.ready",
      payload: {
        capabilities: {
          surface: "desktop",
          runtimeLocation: "local",
          tools: [{ name: "calculator", available: true }],
        },
      },
    });

    const session = await runtime.request("session.create", { title: "Calculator" });
    await runtime.request("session.subscribe", { sessionId: session.id });
    const submitted = await runtime.request("turn.submit", {
      sessionId: session.id,
      text: "计算 1+1",
      idempotencyKey: "desktop-calculator-0001",
    });
    const snapshot = await runtime.request("session.getSnapshot", { sessionId: session.id });

    expect(submitted.turn.status).toBe("completed");
    expect(agentEventTypes(runtime.events)).toEqual(
      expect.arrayContaining([
        "turn.started",
        "tool.requested",
        "tool.started",
        "tool.completed",
        "message.delta",
        "turn.completed",
      ]),
    );
    expect(snapshot.turns).toEqual([expect.objectContaining({ status: "completed" })]);
    expect(JSON.stringify(snapshot.messages)).toContain('"name":"calculator"');
    expect(JSON.stringify(snapshot.messages)).toContain('"value":2');
    expect(JSON.stringify(snapshot.messages)).toContain("1+1 = 2");
  });

  it("cancels an active Turn and persists the cancelled terminal state", async () => {
    const provider = new ControlledProvider();
    const backend = createTestBackend(provider);
    const runtime = new RuntimeHarness({
      runtimeId: "runtime_cancel",
      accessToken: backend.accessToken,
      fetchImpl: backend.fetchImpl,
    });
    await runtime.initialize();
    const session = await runtime.request("session.create", { title: "Cancellation" });
    await runtime.request("session.subscribe", { sessionId: session.id });

    const submission = runtime.request("turn.submit", {
      sessionId: session.id,
      text: "等待取消",
      idempotencyKey: "desktop-cancel-0001",
    });
    const started = await runtime.waitForEvent("turn.started");
    if (started.event !== "agent.event" || !started.payload.turnId) {
      throw new TypeError("Expected a started Agent event with a Turn id");
    }
    await expect(runtime.request("workspace.clear", {})).rejects.toThrow(
      ErrorCodes.TURN_ALREADY_ACTIVE,
    );
    await runtime.request("turn.cancel", {
      sessionId: session.id,
      turnId: started.payload.turnId,
    });
    const result = await submission;
    const snapshot = await runtime.request("session.getSnapshot", { sessionId: session.id });

    expect(result.turn.status).toBe("cancelled");
    expect(agentEventTypes(runtime.events)).toContain("turn.cancelled");
    expect(snapshot.turns).toEqual([expect.objectContaining({ status: "cancelled" })]);
  });

  it("keeps the active service and subscriptions when Main refreshes the access token", async () => {
    const backend = createTestBackend();
    const runtime = new RuntimeHarness({
      runtimeId: "runtime_token-refresh",
      accessToken: backend.accessToken,
      fetchImpl: backend.fetchImpl,
    });
    await runtime.initialize();
    const session = await runtime.request("session.create", { title: "Refresh" });
    await runtime.request("session.subscribe", { sessionId: session.id });

    await runtime.updateAuth(backend.issueAccessToken("replacement"));
    await runtime.request("turn.submit", {
      sessionId: session.id,
      text: "计算 1+1",
      idempotencyKey: "desktop-refresh-0001",
    });

    expect(agentEventTypes(runtime.events)).toEqual(
      expect.arrayContaining(["turn.started", "tool.completed", "turn.completed"]),
    );
  });

  it("marks an interrupted Turn failed when a replacement Runtime starts", async () => {
    const provider = new ControlledProvider();
    const backend = createTestBackend(provider);
    const original = new RuntimeHarness({
      runtimeId: "runtime_original",
      accessToken: backend.accessToken,
      fetchImpl: backend.fetchImpl,
    });
    await original.initialize();
    const session = await original.request("session.create", { title: "Recovery" });
    const activeSubmission = original.request("turn.submit", {
      sessionId: session.id,
      text: "保持运行",
      idempotencyKey: "desktop-recovery-0001",
    });
    await withTimeout(provider.waitUntilStarted(), "original Runtime did not reach the model stream");

    const replacement = new RuntimeHarness({
      runtimeId: "runtime_replacement",
      replacesRuntimeId: "runtime_original",
      accessToken: backend.accessToken,
      fetchImpl: backend.fetchImpl,
    });
    await withTimeout(replacement.initialize(), "replacement Runtime did not initialize");
    const recovered = await withTimeout(
      replacement.request("session.getSnapshot", { sessionId: session.id }),
      "replacement Runtime did not load the recovered snapshot",
    );

    expect(recovered.turns).toEqual([
      expect.objectContaining({
        status: "failed",
        error: expect.objectContaining({ code: ErrorCodes.RUNTIME_INTERRUPTED }),
      }),
    ]);

    const interruptedTurn = recovered.turns[0];
    if (!interruptedTurn) throw new TypeError("Expected an interrupted Turn");
    await original.request("turn.cancel", {
      sessionId: session.id,
      turnId: interruptedTurn.id,
    });
    await expect(
      withTimeout(activeSubmission, "original Runtime did not settle after cancellation"),
    ).rejects.toThrow(ErrorCodes.SESSION_VERSION_CONFLICT);
    const authoritative = await replacement.request("session.getSnapshot", { sessionId: session.id });
    expect(authoritative.turns[0]?.error?.code).toBe(ErrorCodes.RUNTIME_INTERRUPTED);
  });
});

class ControlledProvider extends FakeProviderAdapter {
  private readonly streamStarted: Promise<void>;
  private markStreamStarted: (() => void) | undefined;

  constructor() {
    super();
    this.streamStarted = new Promise((resolve) => {
      this.markStreamStarted = resolve;
    });
  }

  waitUntilStarted(): Promise<void> {
    return this.streamStarted;
  }

  override async *stream(_request: ModelRequest, signal: AbortSignal): AsyncIterable<never> {
    this.markStreamStarted?.();
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
      if (signal.aborted) resolve();
    });
  }
}

class ReadFileProvider extends FakeProviderAdapter {
  override async *stream(request: ModelRequest, signal: AbortSignal) {
    const lastMessage = request.messages.at(-1);
    if (lastMessage?.role === "user" && lastMessage.content.includes("README.md")) {
      yield {
        type: "tool_call" as const,
        toolCall: { id: "tc_read_file", name: "read_file", input: { path: "README.md" } },
      };
      yield { type: "finish" as const, reason: "tool_calls" as const };
      return;
    }
    yield* super.stream(request, signal);
  }
}

function createTestBackend(provider = new FakeProviderAdapter()): {
  accessToken: string;
  fetchImpl: typeof fetch;
  issueAccessToken(suffix: string): string;
} {
  const store = new InMemoryBackendStore();
  const account = store.createAccount(100_000);
  const issueAccessToken = (suffix: string): string => {
    const accessToken = `bca_desktop-runtime-${suffix}`;
    store.putAccessToken({
      accountId: account.accountId,
      clientId: "beecode-desktop",
      tokenHash: hashSecret(accessToken),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    return accessToken;
  };
  const accessToken = issueAccessToken("integration");
  const app = createBackendApp(store, provider, { quotaLimitTokens: 100_000 });
  const fetchImpl: typeof fetch = (input, init) => {
    const request = new Request(input, init);
    return Promise.resolve(app.request(request));
  };
  return { accessToken, fetchImpl, issueAccessToken };
}

function agentEventTypes(events: DesktopIpcEventFrame[]): string[] {
  return events.flatMap((frame) =>
    frame.event === "agent.event" ? [frame.payload.event.type] : [],
  );
}

function withTimeout<TResult>(promise: Promise<TResult>, message: string): Promise<TResult> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), 1_000);
    }),
  ]);
}
