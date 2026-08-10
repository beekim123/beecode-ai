import {
  BeecodeError,
  ErrorCodes,
  type AgentEvent,
  type BeecodeErrorShape,
  type GatewayMessage,
  type GatewayToolCall,
  type FinishReason,
  type Id,
  type ModelGateway,
  type ModelStreamEvent,
  type Surface,
  type ToolCall,
  type Turn,
  type TurnStatus,
  type Usage,
} from "@beecode/protocol";
import type { ToolRegistry } from "@beecode/tools";
import { newId } from "./id.js";
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_TURN_LIMITS, type TurnLimits } from "./limits.js";

/**
 * Agent Core（设计文档第 6 节）：Turn 状态机与 Agent Loop。
 * 不依赖终端、HTTP 框架、数据库驱动或模型供应商 SDK；
 * 输出领域事件，不关心事件显示在哪个端。
 */

export interface RunTurnInput {
  sessionId: Id;
  /** Session 内递增序号，由调用方分配 */
  turnIndex: number;
  /** 已有会话上下文（模型视角） */
  history: GatewayMessage[];
  userText: string;
  /** Facade 可预先分配标识，以便在执行前持久化 queued Turn。 */
  turnId?: Id;
  userMessageId?: Id;
}

export type TurnOutcome = "completed" | "failed" | "cancelled";

export interface TurnResult {
  turn: Turn;
  outcome: TurnOutcome;
  /** 本 Turn 新增的需要持久化的模型视角消息（user / assistant / tool） */
  appendedMessages: GatewayMessage[];
  usage?: Usage;
  error?: BeecodeErrorShape;
}

export interface AgentRuntimeOptions {
  gateway: ModelGateway;
  tools: ToolRegistry;
  surface: Surface;
  systemPrompt?: string;
  limits?: Partial<TurnLimits>;
  /** 事件时序测试可注入时钟；默认真实时间 */
  now?: () => string;
}

interface ActiveTurn {
  turn: Turn;
  abort: AbortController;
}

interface ModelStepResult {
  text: string;
  toolCalls: GatewayToolCall[];
  assistantMessageId: Id;
  usage?: Usage;
}

type EventHandler = (event: AgentEvent) => void;

export class AgentRuntime {
  private readonly gateway: ModelGateway;
  private readonly tools: ToolRegistry;
  private readonly surface: Surface;
  private readonly systemPrompt: string;
  private readonly limits: TurnLimits;
  private readonly now: () => string;
  private readonly handlers = new Set<EventHandler>();
  /** 按 sessionId 索引的活动 Turn：每个 Session 同时只允许一个活动 Turn */
  private readonly activeBySession = new Map<Id, ActiveTurn>();

  constructor(options: AgentRuntimeOptions) {
    this.gateway = options.gateway;
    this.tools = options.tools;
    this.surface = options.surface;
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.limits = { ...DEFAULT_TURN_LIMITS, ...options.limits };
    this.now = options.now ?? (() => new Date().toISOString());
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private emit(event: AgentEvent): void {
    for (const handler of this.handlers) handler(event);
  }

  getActiveTurn(sessionId: Id): Turn | undefined {
    return this.activeBySession.get(sessionId)?.turn;
  }

  cancelTurn(sessionId: Id, turnId: Id): boolean {
    const active = this.activeBySession.get(sessionId);
    if (!active || active.turn.id !== turnId) return false;
    active.abort.abort();
    return true;
  }

  async runTurn(input: RunTurnInput): Promise<TurnResult> {
    if (this.activeBySession.has(input.sessionId)) {
      throw new BeecodeError(
        ErrorCodes.INVALID_REQUEST,
        "Session already has an active turn; cancel it before submitting a new message",
      );
    }

    const turn: Turn = {
      id: input.turnId ?? newId("turn"),
      sessionId: input.sessionId,
      index: input.turnIndex,
      status: "queued",
      userMessageId: input.userMessageId ?? newId("msg"),
    };
    const abort = new AbortController();
    this.activeBySession.set(input.sessionId, { turn, abort });

    const appended: GatewayMessage[] = [{ role: "user", content: input.userText }];
    const context: GatewayMessage[] = [...input.history, ...appended];
    let totalUsage: Usage | undefined;
    let lastToolCallKey: string | undefined;
    let repeatedToolCalls = 0;

    try {
      this.transition(turn, "running");
      turn.startedAt = this.now();
      this.emit({ type: "turn.started", sessionId: turn.sessionId, turnId: turn.id, turn: { ...turn } });

      for (let step = 0; step < this.limits.maxSteps; step++) {
        this.throwIfCancelled(abort, turn);

        // ---- 模型步骤 ----
        this.transition(turn, "model_streaming");
        const stepResult = await this.streamStep(context, turn, abort);
        // 取消可能发生在流被静默截断时（如 gateway 尊重 abort 提前结束）
        this.throwIfCancelled(abort, turn);

        if (stepResult.usage) {
          totalUsage = addUsage(totalUsage, stepResult.usage);
          if (totalUsage.totalTokens > this.limits.maxTokens) {
            throw new BeecodeError(
              ErrorCodes.TURN_LIMIT_EXCEEDED,
              `Turn token budget exceeded (${totalUsage.totalTokens} > ${this.limits.maxTokens})`,
            );
          }
        }

        const assistantText = stepResult.text;
        if (assistantText.length > 0 || stepResult.toolCalls.length > 0) {
          const assistantMessage: GatewayMessage = {
            role: "assistant",
            content: assistantText,
            ...(stepResult.toolCalls.length > 0 ? { toolCalls: stepResult.toolCalls } : {}),
          };
          appended.push(assistantMessage);
          context.push(assistantMessage);
        }

        if (stepResult.toolCalls.length === 0) {
          // 模型给出最终回答
          this.transition(turn, "completed");
          turn.finishedAt = this.now();
          turn.usage = totalUsage;
          this.emit({ type: "turn.completed", sessionId: turn.sessionId, turnId: turn.id, usage: totalUsage });
          return { turn, outcome: "completed", appendedMessages: appended, usage: totalUsage };
        }

        // ---- 工具步骤（第一阶段串行执行）----
        const pendingTools = stepResult.toolCalls.map((call) => {
          this.throwIfCancelled(abort, turn);

          const key = `${call.name}:${JSON.stringify(call.input)}`;
          repeatedToolCalls = key === lastToolCallKey ? repeatedToolCalls + 1 : 0;
          lastToolCallKey = key;
          if (repeatedToolCalls >= this.limits.maxRepeatedToolCalls) {
            throw new BeecodeError(
              ErrorCodes.TURN_LIMIT_EXCEEDED,
              `Tool call repeated ${repeatedToolCalls + 1} times in a row: ${call.name}`,
            );
          }

          const toolCall: ToolCall = {
            id: call.id,
            name: call.name,
            input: call.input,
            status: "requested",
          };
          return { call, toolCall, partId: newId("part") };
        });

        this.transition(turn, "tool_running");
        for (const pending of pendingTools) {
          this.emit({
            type: "tool.requested",
            sessionId: turn.sessionId,
            turnId: turn.id,
            messageId: stepResult.assistantMessageId,
            partId: pending.partId,
            toolCall: { ...pending.toolCall },
          });
        }

        for (const { call, toolCall } of pendingTools) {
          this.throwIfCancelled(abort, turn);

          toolCall.status = "running";
          this.emit({ type: "tool.started", sessionId: turn.sessionId, turnId: turn.id, toolCallId: toolCall.id });

          const { result } = await this.tools.execute(call.name, call.input, this.surface, abort.signal);
          this.throwIfCancelled(abort, turn);
          let toolContent: string;
          if (result.ok) {
            toolCall.status = "completed";
            toolCall.output = result.output;
            toolContent = JSON.stringify(result.output ?? null);
            this.emit({ type: "tool.completed", sessionId: turn.sessionId, turnId: turn.id, toolCall: { ...toolCall } });
          } else {
            toolCall.status = "failed";
            toolCall.error = result.error;
            toolContent = JSON.stringify({ error: result.error });
            this.emit({ type: "tool.failed", sessionId: turn.sessionId, turnId: turn.id, toolCall: { ...toolCall } });
          }

          const toolMessage: GatewayMessage = {
            role: "tool",
            toolCallId: toolCall.id,
            name: toolCall.name,
            content: toolContent,
          };
          appended.push(toolMessage);
          context.push(toolMessage);
        }
      }

      throw new BeecodeError(
        ErrorCodes.TURN_LIMIT_EXCEEDED,
        `Turn exceeded the maximum of ${this.limits.maxSteps} model steps`,
      );
    } catch (err) {
      const isCancelled =
        abort.signal.aborted ||
        (err instanceof BeecodeError && err.code === ErrorCodes.TURN_CANCELLED);
      turn.finishedAt = this.now();
      turn.usage = totalUsage;
      if (isCancelled) {
        this.transition(turn, "cancelled");
        this.emit({ type: "turn.cancelled", sessionId: turn.sessionId, turnId: turn.id });
        return { turn, outcome: "cancelled", appendedMessages: appended, usage: totalUsage };
      }
      const error = BeecodeError.shape(err);
      turn.error = error;
      this.transition(turn, "failed");
      this.emit({ type: "turn.failed", sessionId: turn.sessionId, turnId: turn.id, error });
      return { turn, outcome: "failed", appendedMessages: appended, usage: totalUsage, error };
    } finally {
      this.activeBySession.delete(input.sessionId);
    }
  }

  /** 一次模型步骤：消费标准化流，支持有限退避重试与超时 */
  private async streamStep(
    context: GatewayMessage[],
    turn: Turn,
    abort: AbortController,
  ): Promise<ModelStepResult> {
    const request = {
      messages: [...context],
      systemPrompt: this.systemPrompt,
      tools: this.tools.schemasFor(this.surface),
      maxOutputTokens: Math.min(4096, this.limits.maxTokens),
    };

    let attempt = 0;
    for (;;) {
      this.throwIfCancelled(abort, turn);
      const timeout = AbortSignal.timeout(this.limits.gatewayTimeoutMs);
      const signal = AbortSignal.any([abort.signal, timeout]);
      const assistantMessageId = newId("msg");
      turn.assistantMessageId = assistantMessageId;
      const textPartId = newId("part");
      let text = "";
      const toolCalls: GatewayToolCall[] = [];
      let usage: Usage | undefined;
      let finishReason: FinishReason | undefined;

      try {
        for await (const event of this.gateway.stream(request, signal)) {
          this.throwIfCancelled(abort, turn);
          this.applyStreamEvent(event, turn, assistantMessageId, textPartId, {
            onText: (t) => (text += t),
            onToolCall: (c) => toolCalls.push(c),
            onUsage: (u) => (usage = u),
            onFinish: (reason) => (finishReason = reason),
          });
        }
        validateFinish(finishReason, toolCalls.length);
        return { text, toolCalls, assistantMessageId, usage };
      } catch (err) {
        if (abort.signal.aborted) throw err;
        const beecode = BeecodeError.fromUnknown(
          timeout.aborted
            ? new BeecodeError(ErrorCodes.MODEL_TIMEOUT, "Model gateway request timed out", true)
            : err,
        );
        const hasVisibleOutput = text.length > 0 || toolCalls.length > 0;
        if (!hasVisibleOutput && beecode.retryable && attempt < this.limits.maxRetries) {
          attempt++;
          await sleep(backoffMs(attempt), abort.signal);
          continue;
        }
        throw beecode;
      }
    }
  }

  private applyStreamEvent(
    event: ModelStreamEvent,
    turn: Turn,
    assistantMessageId: Id,
    textPartId: Id,
    sink: {
      onText: (text: string) => void;
      onToolCall: (call: GatewayToolCall) => void;
      onUsage: (usage: Usage) => void;
      onFinish: (reason: FinishReason) => void;
    },
  ): void {
    switch (event.type) {
      case "text_delta":
        sink.onText(event.text);
        this.emit({
          type: "message.delta",
          sessionId: turn.sessionId,
          turnId: turn.id,
          messageId: assistantMessageId,
          partId: textPartId,
          textDelta: event.text,
        });
        return;
      case "tool_call":
        sink.onToolCall(event.toolCall);
        return;
      case "usage":
        sink.onUsage(event.usage);
        return;
      case "finish":
        sink.onFinish(event.reason);
        return;
      case "error":
        throw BeecodeError.fromShape(event.error, ErrorCodes.MODEL_STREAM_ERROR);
    }
  }

  private transition(turn: Turn, status: TurnStatus): void {
    turn.status = status;
  }

  private throwIfCancelled(abort: AbortController, turn: Turn): void {
    if (abort.signal.aborted) {
      throw new BeecodeError(ErrorCodes.TURN_CANCELLED, `Turn ${turn.id} cancelled`);
    }
  }
}

function validateFinish(reason: FinishReason | undefined, toolCallCount: number): void {
  if (reason === undefined) {
    throw new BeecodeError(ErrorCodes.MODEL_STREAM_ERROR, "Model stream ended without a finish event", true);
  }
  if (reason === "length") {
    throw new BeecodeError(ErrorCodes.MODEL_STREAM_ERROR, "Model response was truncated at its output limit");
  }
  if (reason === "tool_calls" && toolCallCount === 0) {
    throw new BeecodeError(ErrorCodes.MODEL_STREAM_ERROR, "Model finished with tool_calls but emitted no tool call");
  }
  if (reason === "stop" && toolCallCount > 0) {
    throw new BeecodeError(ErrorCodes.MODEL_STREAM_ERROR, "Model emitted tool calls but finished with stop");
  }
}

function addUsage(current: Usage | undefined, next: Usage): Usage {
  if (!current) return { ...next };
  return {
    inputTokens: current.inputTokens + next.inputTokens,
    outputTokens: current.outputTokens + next.outputTokens,
    totalTokens: current.totalTokens + next.totalTokens,
  };
}

function backoffMs(attempt: number): number {
  return 200 * 2 ** (attempt - 1);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new BeecodeError(ErrorCodes.TURN_CANCELLED, "Cancelled"));
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}
