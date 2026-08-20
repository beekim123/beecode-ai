import { randomUUID } from "node:crypto";
import {
  MessageChannelMain,
  utilityProcess,
  type MessagePortMain,
  type UtilityProcess,
} from "electron";
import {
  BeecodeError,
  DESKTOP_IPC_PROTOCOL_VERSION,
  ErrorCodes,
  parseDesktopIpcFrame,
  parseDesktopIpcMethodResult,
  type DesktopIpcEventFrame,
  type DesktopIpcFrame,
  type DesktopIpcMethod,
  type DesktopIpcMethodResultMap,
  type DesktopIpcRequestFrame,
} from "@beecode/protocol";
import type { DesktopRuntimeStatus } from "../preload/api.js";

type RequestPayload<TMethod extends DesktopIpcMethod> = Extract<
  DesktopIpcRequestFrame,
  { method: TMethod }
>["payload"];

interface PendingRequest {
  method: DesktopIpcMethod;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: NodeJS.Timeout;
}

interface RuntimeSupervisorOptions {
  entryPoint: string;
  backendUrl: string;
  appVersion: string;
  getAccessToken(): Promise<string | undefined>;
  getLastRuntimeId(): Promise<string | undefined>;
  saveLastRuntimeId(runtimeId: string): Promise<void>;
}

const RESTART_DELAYS_MS = [250, 1_000, 4_000, 10_000] as const;

export class RuntimeSupervisor {
  private readonly options: RuntimeSupervisorOptions;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly eventListeners = new Set<(event: DesktopIpcEventFrame) => void>();
  private readonly statusListeners = new Set<(status: DesktopRuntimeStatus) => void>();
  private child: UtilityProcess | undefined;
  private port: MessagePortMain | undefined;
  private runtimeId: string | undefined;
  private startupId: string | undefined;
  private state: DesktopRuntimeStatus["state"] = "stopped";
  private stopping = false;
  private restartTimer: NodeJS.Timeout | undefined;
  private handshakeTimer: NodeJS.Timeout | undefined;
  private stableTimer: NodeJS.Timeout | undefined;
  private failureTimestamps: number[] = [];
  private authTransition: { resolve(): void; reject(error: unknown): void } | undefined;
  private shutdownAck: (() => void) | undefined;

  constructor(options: RuntimeSupervisorOptions) {
    this.options = options;
  }

  getStatus(): DesktopRuntimeStatus {
    return {
      state: this.state,
      ...(this.runtimeId ? { runtimeId: this.runtimeId } : {}),
    };
  }

  onEvent(listener: (event: DesktopIpcEventFrame) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: (status: DesktopRuntimeStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.state !== "stopped" && this.state !== "reconnecting" && this.state !== "unavailable") return;
    this.stopping = false;
    clearTimeout(this.restartTimer);
    this.setStatus("starting");
    const startupId = `startup_${randomUUID()}`;
    this.startupId = startupId;
    const child = utilityProcess.fork(this.options.entryPoint, [], {
      serviceName: "Beecode Runtime",
    });
    this.child = child;
    const { port1, port2 } = new MessageChannelMain();
    this.port = port1;
    port1.on("message", (event) => this.handleMessage(event.data));
    port1.on("close", () => this.handleDisconnect("Runtime MessagePort closed"));
    port1.start();
    child.once("exit", (code) => this.handleDisconnect(`Runtime exited (${code ?? "unknown"})`));
    child.postMessage(
      {
        type: "runtime.bootstrap",
        startupId,
        appVersion: this.options.appVersion,
        supportedProtocolVersions: [DESKTOP_IPC_PROTOCOL_VERSION],
      },
      [port2],
    );
    this.setStatus("handshaking");
    this.handshakeTimer = setTimeout(
      () => this.handleDisconnect("Runtime hello timed out"),
      3_000,
    );
  }

  async retry(): Promise<DesktopRuntimeStatus> {
    this.failureTimestamps = [];
    await this.stopProcessOnly();
    this.state = "stopped";
    await this.start();
    return this.getStatus();
  }

  async updateAuth(accessToken: string | undefined): Promise<void> {
    if (!this.port || this.state !== "ready") return;
    this.setStatus("handshaking");
    const transition = new Promise<void>((resolve, reject) => {
      this.authTransition = { resolve, reject };
    });
    this.post({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "control",
      control: "auth.update",
      payload: {
        auth: accessToken
          ? { authenticated: true, accessToken }
          : { authenticated: false },
      },
    });
    await Promise.race([
      transition,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new BeecodeError(ErrorCodes.SURFACE_UNAVAILABLE, "Runtime auth update timed out", true)),
          10_000,
        ),
      ),
    ]).finally(() => {
      this.authTransition = undefined;
    });
  }

  request<TMethod extends DesktopIpcMethod>(
    method: TMethod,
    payload: RequestPayload<TMethod>,
  ): Promise<DesktopIpcMethodResultMap[TMethod]> {
    if (!this.port || this.state !== "ready") {
      return Promise.reject(
        new BeecodeError(ErrorCodes.SURFACE_UNAVAILABLE, "Desktop Runtime is not ready", true),
      );
    }
    const requestId = `request_${randomUUID()}`;
    const frame = parseDesktopIpcFrame({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "request",
      requestId,
      method,
      payload,
    });
    if (frame.kind !== "request") {
      return Promise.reject(new BeecodeError(ErrorCodes.INVALID_REQUEST, "Invalid Runtime request"));
    }
    const timeoutMs = method === "turn.submit" ? 5 * 60_000 : 30_000;
    return new Promise<DesktopIpcMethodResultMap[TMethod]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new BeecodeError(ErrorCodes.SURFACE_UNAVAILABLE, "Desktop Runtime request timed out", true));
      }, timeoutMs);
      this.pending.set(requestId, {
        method,
        resolve: (value) => resolve(value as DesktopIpcMethodResultMap[TMethod]),
        reject,
        timer,
      });
      this.post(frame);
    });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    clearTimeout(this.stableTimer);
    if (!this.child || !this.port) {
      this.setStatus("stopped");
      return;
    }
    this.setStatus("stopping");
    const ack = new Promise<void>((resolve) => {
      this.shutdownAck = resolve;
    });
    this.post({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "control",
      control: "runtime.shutdown",
      payload: {},
    });
    await Promise.race([ack, new Promise<void>((resolve) => setTimeout(resolve, 5_000))]);
    await this.stopProcessOnly();
    this.setStatus("stopped");
  }

  private async handleHello(frame: Extract<DesktopIpcFrame, { kind: "control"; control: "runtime.hello" }>): Promise<void> {
    if (frame.payload.startupId !== this.startupId || this.state !== "handshaking") {
      this.handleDisconnect("Runtime hello did not match startup");
      return;
    }
    clearTimeout(this.handshakeTimer);
    this.runtimeId = frame.payload.runtimeId;
    const [accessToken, replacesRuntimeId] = await Promise.all([
      this.options.getAccessToken(),
      this.options.getLastRuntimeId(),
    ]);
    this.post({
      protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
      kind: "control",
      control: "runtime.initialize",
      payload: {
        startupId: frame.payload.startupId,
        selectedProtocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
        backendUrl: this.options.backendUrl,
        auth: accessToken
          ? { authenticated: true, accessToken }
          : { authenticated: false },
        ...(replacesRuntimeId && replacesRuntimeId !== frame.payload.runtimeId
          ? { replacesRuntimeId }
          : {}),
      },
    });
    this.handshakeTimer = setTimeout(
      () => this.handleDisconnect("Runtime ready timed out"),
      7_000,
    );
  }

  private handleMessage(value: unknown): void {
    let frame: DesktopIpcFrame;
    try {
      frame = parseDesktopIpcFrame(value);
    } catch {
      this.handleDisconnect("Runtime sent an invalid IPC frame");
      return;
    }
    if (frame.kind === "control") {
      if (frame.control === "runtime.hello") {
        void this.handleHello(frame);
      } else if (frame.control === "runtime.ready") {
        this.handleReady(frame);
      } else if (frame.control === "runtime.shutdown.ack") {
        this.shutdownAck?.();
      }
      return;
    }
    if (frame.kind === "response") {
      const pending = this.pending.get(frame.requestId);
      if (!pending) return;
      this.pending.delete(frame.requestId);
      clearTimeout(pending.timer);
      if (frame.result.ok) {
        try {
          pending.resolve(parseDesktopIpcMethodResult(pending.method, frame.result.value));
        } catch (error: unknown) {
          pending.reject(error);
        }
      } else {
        pending.reject(BeecodeError.fromShape(frame.result.error));
      }
      return;
    }
    if (frame.kind === "event") this.handleEvent(frame);
  }

  private handleReady(
    frame: Extract<DesktopIpcFrame, { kind: "control"; control: "runtime.ready" }>,
  ): void {
    if (frame.payload.runtimeId !== this.runtimeId || this.state !== "handshaking") {
      this.handleDisconnect("Runtime ready did not match handshake");
      return;
    }
    clearTimeout(this.handshakeTimer);
    this.setStatus("ready");
    void this.options.saveLastRuntimeId(frame.payload.runtimeId);
    clearTimeout(this.stableTimer);
    this.stableTimer = setTimeout(() => {
      this.failureTimestamps = [];
    }, 60_000);
  }

  private handleEvent(frame: DesktopIpcEventFrame): void {
    if (frame.event === "runtime.status") {
      this.setStatus(frame.payload.state, frame.payload.error);
      if (frame.payload.state === "ready") this.authTransition?.resolve();
      if (frame.payload.state === "unavailable") {
        this.authTransition?.reject(BeecodeError.fromShape(frame.payload.error ?? {
          code: ErrorCodes.SURFACE_UNAVAILABLE,
          message: "Desktop Runtime is unavailable",
          retryable: true,
        }));
      }
    }
    for (const listener of this.eventListeners) listener(frame);
  }

  private handleDisconnect(message: string): void {
    if (this.stopping || this.state === "stopped") return;
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.stableTimer);
    const error = new BeecodeError(ErrorCodes.SURFACE_UNAVAILABLE, message, true);
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.authTransition?.reject(error);
    this.authTransition = undefined;
    void this.stopProcessOnly();
    const now = Date.now();
    this.failureTimestamps = [...this.failureTimestamps.filter((time) => now - time < 60_000), now];
    if (this.failureTimestamps.length >= 5) {
      this.setStatus("unavailable", error.toShape());
      return;
    }
    this.setStatus("reconnecting", error.toShape());
    const delay = RESTART_DELAYS_MS[Math.min(this.failureTimestamps.length - 1, RESTART_DELAYS_MS.length - 1)] ?? 10_000;
    this.restartTimer = setTimeout(() => void this.start(), delay);
  }

  private async stopProcessOnly(): Promise<void> {
    const child = this.child;
    const port = this.port;
    this.child = undefined;
    this.port = undefined;
    this.runtimeId = undefined;
    port?.removeAllListeners();
    port?.close();
    if (child) {
      child.removeAllListeners();
      child.kill();
    }
  }

  private post(frame: DesktopIpcFrame): void {
    const parsed = parseDesktopIpcFrame(frame);
    this.port?.postMessage(parsed);
  }

  private setStatus(
    state: DesktopRuntimeStatus["state"],
    error?: DesktopRuntimeStatus["error"],
  ): void {
    this.state = state;
    const status: DesktopRuntimeStatus = {
      state,
      ...(this.runtimeId ? { runtimeId: this.runtimeId } : {}),
      ...(error ? { error } : {}),
    };
    for (const listener of this.statusListeners) listener(status);
  }
}
