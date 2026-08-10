import { describe, expect, it } from "vitest";
import { parseModelRequest, parseModelStreamEvent, parseSessionSnapshot } from "../src/validation.js";

const now = "2026-08-06T00:00:00.000Z";

describe("protocol validation", () => {
  it("migrates legacy session snapshots without turns", () => {
    const snapshot = parseSessionSnapshot({
      session: {
        id: "ses_1",
        surface: "cli",
        accountId: "acct_1",
        title: "legacy",
        status: "active",
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      messages: [
        {
          id: "msg_1",
          sessionId: "ses_1",
          turnId: "turn_missing_from_legacy_data",
          role: "user",
          parts: [{ id: "part_1", type: "text", text: "legacy" }],
          createdAt: now,
        },
      ],
    });

    expect(snapshot.turns).toEqual([]);
    expect(snapshot.messages[0]?.turnId).toBeUndefined();
  });

  it("rejects malformed model events before they enter Agent Core", () => {
    expect(() => parseModelStreamEvent({ type: "finish", reason: "unknown" })).toThrow(
      /reason is invalid/,
    );
    expect(() => parseModelStreamEvent({ type: "usage", usage: { totalTokens: -1 } })).toThrow();
  });

  it("parses model request limits and rejects invalid messages", () => {
    expect(
      parseModelRequest({
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        maxOutputTokens: 128,
      }).maxOutputTokens,
    ).toBe(128);
    expect(() => parseModelRequest({ messages: [{ role: "root" }], tools: [] })).toThrow(/role is invalid/);
  });
});
