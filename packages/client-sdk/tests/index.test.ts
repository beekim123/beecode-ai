import { describe, expect, it } from "vitest";
import type { AgentEvent, AgentProtocolService, SessionSnapshot } from "@beecode/protocol";
import { BeecodeClient, InProcessTransport } from "../src/index.js";

describe("BeecodeClient", () => {
  it("preserves Agent Protocol commands and event semantics through in-process transport", async () => {
    const now = "2026-08-06T00:00:00.000Z";
    const snapshot: SessionSnapshot = {
      session: {
        id: "ses_1",
        surface: "cli",
        accountId: "acct_1",
        title: "test",
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      messages: [],
      turns: [],
    };
    let subscriber: ((event: AgentEvent) => void) | undefined;
    const service: AgentProtocolService = {
      createSession: async () => snapshot.session,
      listSessions: async () => [snapshot.session],
      getSessionSnapshot: async () => snapshot,
      submitMessage: async ({ sessionId, text }) => ({
        turn: {
          id: "turn_1",
          sessionId,
          index: 1,
          status: "completed",
          userMessageId: `msg_${text}`,
        },
      }),
      cancelTurn: async () => undefined,
      subscribe: (_sessionId, handler) => {
        subscriber = handler;
        return () => {
          subscriber = undefined;
        };
      },
      getCapabilities: async () => ({ tools: ["calculator"], surfaces: ["cli"], maxTurnSteps: 8 }),
    };
    const client = new BeecodeClient(new InProcessTransport(service));
    const observed: AgentEvent[] = [];
    const unsubscribe = client.subscribe("ses_1", (event) => observed.push(event));

    subscriber?.({
      type: "turn.cancelled",
      sessionId: "ses_1",
      turnId: "turn_1",
    });

    expect(await client.listSessions()).toEqual([snapshot.session]);
    expect((await client.submitMessage("ses_1", "hello")).turn.userMessageId).toBe("msg_hello");
    expect(observed.map((event) => event.type)).toEqual(["turn.cancelled"]);
    unsubscribe();
    expect(subscriber).toBeUndefined();
  });
});
