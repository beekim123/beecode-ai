import { randomUUID } from "node:crypto";
import {
  DESKTOP_IPC_PROTOCOL_VERSION,
  parseDesktopIpcFrame,
  parseDesktopRuntimeBootstrap,
  type DesktopIpcFrame,
} from "@beecode/protocol";
import { DesktopRuntimeHost } from "./runtime-host.js";

interface RuntimeMessagePort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): this;
  start(): void;
  close(): void;
}

interface ParentMessageEvent {
  data: unknown;
  ports: RuntimeMessagePort[];
}

const parentPort = process.parentPort;
if (!parentPort) throw new Error("Desktop Runtime must be launched as an Electron Utility Process");

parentPort.once("message", (event: ParentMessageEvent) => {
  const bootstrap = parseDesktopRuntimeBootstrap(event.data);
  const port = event.ports[0];
  if (!port || event.ports.length !== 1) {
    throw new Error("Desktop Runtime bootstrap requires exactly one MessagePort");
  }
  const runtimeId = `runtime_${randomUUID()}`;
  const host = new DesktopRuntimeHost({
    runtimeId,
    send: (frame) => port.postMessage(frame),
  });

  port.on("message", (messageEvent) => {
    let frame: DesktopIpcFrame;
    try {
      frame = parseDesktopIpcFrame(messageEvent.data);
    } catch {
      return;
    }
    if (frame.kind === "request") {
      host.handleRequest(frame);
      return;
    }
    if (frame.kind !== "control") return;
    if (frame.control === "runtime.initialize") {
      void host.initialize(frame);
    } else if (frame.control === "auth.update") {
      void host.updateAuth(frame);
    } else if (frame.control === "runtime.shutdown") {
      void host.shutdown().finally(() => {
        port.close();
        process.exit(0);
      });
    }
  });
  port.start();
  port.postMessage({
    protocolVersion: DESKTOP_IPC_PROTOCOL_VERSION,
    kind: "control",
    control: "runtime.hello",
    payload: {
      startupId: bootstrap.startupId,
      runtimeId,
      sidecarVersion: bootstrap.appVersion,
      supportedProtocolVersions: [DESKTOP_IPC_PROTOCOL_VERSION],
    },
  });
});
