import { AgentRuntime, DEFAULT_TURN_LIMITS } from "@beecode/agent-core";
import {
  AgentServerFacade,
  HttpBackendClient,
  HttpModelGateway,
  type BackendSessionStore,
} from "@beecode/agent-server";
import { BeecodeClient, InProcessTransport } from "@beecode/client-sdk";
import type { ModelGateway } from "@beecode/protocol";
import { createDefaultToolRegistry } from "@beecode/tools";
import type { CliConfig } from "./config.js";

/**
 * CLI 进程的组合根（设计文档第 5 节）：
 * Terminal UI → Client SDK → In-Process Transport → Agent Server Facade
 *   → Agent Core → Tool Registry / Model Gateway / Backend。
 * CLI 展示层不直接调用 Agent Core。
 */
export interface ComposedCli {
  client: BeecodeClient;
  runtime: AgentRuntime;
}

export interface ComposeOptions {
  config: CliConfig;
  /** 测试注入：Fake Gateway 与内存后端 */
  gateway?: ModelGateway;
  backend?: BackendSessionStore;
  fetchImpl?: typeof fetch;
}

/**
 * 创建 CLI 聊天所需的对象，并返回界面实际使用的 client。
 *
 * 正常运行时，它会连接后端和模型服务；测试时可以传入假的实现，
 * 这样无需真的启动后端或调用模型。
 */
export function composeCli(options: ComposeOptions): ComposedCli {
  const tools = createDefaultToolRegistry();
  // 测试传了假后端或假模型就直接用；否则根据配置连接真实服务。
  const backend =
    options.backend ??
    new HttpBackendClient({
      baseUrl: options.config.backendUrl,
      token: options.config.token,
      fetchImpl: options.fetchImpl,
    });
  const gateway =
    options.gateway ??
    new HttpModelGateway({
      baseUrl: options.config.backendUrl,
      token: options.config.token,
      fetchImpl: options.fetchImpl,
    });

  // Facade 接收 client 的请求，交给 Runtime 处理，再把结果返回给 client。
  const runtime = new AgentRuntime({ gateway, tools, surface: "cli" });
  const facade = new AgentServerFacade({
    runtime,
    tools,
    backend,
    surface: "cli",
    limits: DEFAULT_TURN_LIMITS,
  });
  // 它们在同一个进程里，所以不用发 HTTP 请求，直接把消息交给 Facade。
  const transport = new InProcessTransport(facade);
  return { client: new BeecodeClient(transport), runtime };
}
