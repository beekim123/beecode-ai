import {
  BeecodeError,
  ErrorCodes,
  type ModelGateway,
  type ModelRequest,
  type ModelStreamEvent,
} from "@beecode/protocol";
import { randomUUID } from "node:crypto";
import type { ProviderAdapter } from "../provider/adapter.js";
import type { BackendStore } from "../store.js";

export interface ModelStreamLease {
  events: AsyncIterable<ModelStreamEvent>;
}

export class ModelGatewayService {
  private readonly reservedTokensByAccount = new Map<string, number>();

  constructor(
    private readonly store: BackendStore,
    private readonly provider: ProviderAdapter,
  ) {}

  openStream(
    accountId: string,
    request: ModelRequest,
    signal: AbortSignal,
    context: { turnId?: string; providerRequestId?: string } = {},
  ): ModelStreamLease {
    const account = this.store.getAccount(accountId);
    if (!account) throw new BeecodeError(ErrorCodes.UNAUTHENTICATED, "Account no longer exists");
    const reservation = estimateTokenReservation(request);
    const alreadyReserved = this.reservedTokensByAccount.get(accountId) ?? 0;
    if (account.quotaUsedTokens + alreadyReserved + reservation > account.quotaLimitTokens) {
      throw new BeecodeError(
        ErrorCodes.QUOTA_EXCEEDED,
        "Beecode model quota exceeded for this account",
      );
    }
    this.reservedTokensByAccount.set(accountId, alreadyReserved + reservation);
    return {
      events: this.consume(
        accountId,
        request,
        reservation,
        signal,
        context.providerRequestId ?? `provider_${randomUUID()}`,
        context.turnId,
      ),
    };
  }

  forAccount(accountId: string, turnId?: string): ModelGateway {
    return {
      stream: (request, signal) => this.openStream(accountId, request, signal, { turnId }).events,
    };
  }

  getReservedTokens(accountId: string): number {
    return this.reservedTokensByAccount.get(accountId) ?? 0;
  }

  private async *consume(
    accountId: string,
    request: ModelRequest,
    reservation: number,
    signal: AbortSignal,
    providerRequestId: string,
    turnId?: string,
  ): AsyncIterable<ModelStreamEvent> {
    try {
      for await (const event of this.provider.stream(request, signal)) {
        if (event.type === "usage") {
          this.store.recordUsage({
            accountId,
            providerRequestId,
            ...(turnId ? { turnId } : {}),
            ...event.usage,
            createdAt: new Date().toISOString(),
          });
        }
        yield event;
        if (event.type === "finish" || event.type === "error") return;
      }
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      throw new BeecodeError(
        ErrorCodes.MODEL_STREAM_ERROR,
        "Model provider stream failed",
        true,
      );
    } finally {
      this.releaseReservation(accountId, reservation);
      await this.store.flush();
    }
  }

  private releaseReservation(accountId: string, reservation: number): void {
    const current = this.reservedTokensByAccount.get(accountId) ?? reservation;
    const remaining = Math.max(0, current - reservation);
    if (remaining === 0) this.reservedTokensByAccount.delete(accountId);
    else this.reservedTokensByAccount.set(accountId, remaining);
  }
}

function estimateTokenReservation(request: ModelRequest): number {
  const inputBytes = Buffer.byteLength(
    JSON.stringify({
      messages: request.messages,
      systemPrompt: request.systemPrompt,
      tools: request.tools,
    }),
    "utf8",
  );
  return inputBytes + (request.maxOutputTokens ?? 4096);
}
