import Testing
@testable import Beecode

struct SessionReducerTests {
    @Test
    func reducesOrderedTextToolAndTerminalEventsWithoutDuplicatingReplays() throws {
        let turn = makeTurn(status: .running)
        var snapshot = makeSnapshot()

        snapshot = try SessionReducer.apply(
            envelope(sequence: 1, event: .turnStarted(sessionId: "ses_1", turnId: turn.id, turn: turn)),
            to: snapshot
        )
        snapshot = try SessionReducer.apply(
            envelope(
                sequence: 2,
                event: .messageDelta(
                    sessionId: "ses_1",
                    turnId: turn.id,
                    messageId: "msg_assistant",
                    partId: "part_text",
                    text: "正在"
                )
            ),
            to: snapshot
        )
        let replayed = try SessionReducer.apply(
            envelope(
                sequence: 2,
                event: .messageDelta(
                    sessionId: "ses_1",
                    turnId: turn.id,
                    messageId: "msg_assistant",
                    partId: "part_text",
                    text: "正在"
                )
            ),
            to: snapshot
        )
        #expect(replayed.messages.last?.plainText == "正在")

        let requested = BeecodeToolCall(
            id: "tool_1",
            name: "calculator",
            input: .object(["expression": .string("1+1")]),
            status: .requested
        )
        snapshot = try SessionReducer.apply(
            envelope(
                sequence: 3,
                event: .toolRequested(
                    sessionId: "ses_1",
                    turnId: turn.id,
                    messageId: "msg_assistant",
                    partId: "part_tool",
                    toolCall: requested
                )
            ),
            to: snapshot
        )
        snapshot = try SessionReducer.apply(
            envelope(sequence: 4, event: .toolStarted(sessionId: "ses_1", turnId: turn.id, toolCallId: requested.id)),
            to: snapshot
        )
        var completed = requested
        completed.status = .completed
        completed.output = .object(["value": .number(2)])
        snapshot = try SessionReducer.apply(
            envelope(sequence: 5, event: .toolCompleted(sessionId: "ses_1", turnId: turn.id, toolCall: completed)),
            to: snapshot
        )
        snapshot = try SessionReducer.apply(
            envelope(
                sequence: 6,
                event: .messageDelta(
                    sessionId: "ses_1",
                    turnId: turn.id,
                    messageId: "msg_assistant",
                    partId: "part_text",
                    text: "：1+1 = 2"
                )
            ),
            to: snapshot
        )
        snapshot = try SessionReducer.apply(
            envelope(
                sequence: 7,
                event: .turnCompleted(
                    sessionId: "ses_1",
                    turnId: turn.id,
                    usage: ConversationUsage(inputTokens: 4, outputTokens: 3, totalTokens: 7)
                )
            ),
            to: snapshot
        )

        #expect(snapshot.live?.sequence == 7)
        #expect(snapshot.activeTurn == nil)
        #expect(snapshot.turns.first?.status == .completed)
        #expect(snapshot.turns.first?.usage?.totalTokens == 7)
        #expect(snapshot.messages.last?.plainText == "正在：1+1 = 2")
        #expect(snapshot.latestToolCall?.status == .completed)
        #expect(snapshot.latestToolCall?.output == .object(["value": .number(2)]))
    }

    @Test
    func rejectsSequenceGapsAndReconcilesAnOptimisticMessage() throws {
        let snapshot = makeSnapshot()
        #expect(throws: SessionReducerError.sequenceGap(expected: 1, actual: 2)) {
            _ = try SessionReducer.apply(
                envelope(
                    sequence: 2,
                    event: .turnCancelled(sessionId: "ses_1", turnId: "turn_1")
                ),
                to: snapshot
            )
        }

        let optimistic = SessionReducer.appendingOptimisticMessage(
            to: snapshot,
            id: "pending_1",
            text: "计算 1+1",
            createdAt: "2026-08-13T00:00:00.000Z"
        )
        let reconciled = SessionReducer.reconcilingAcceptedTurn(
            in: optimistic,
            turn: makeTurn(status: .queued),
            optimisticMessageId: "pending_1",
            text: "计算 1+1",
            createdAt: "2026-08-13T00:00:00.000Z"
        )

        #expect(reconciled.messages.count == 1)
        #expect(reconciled.messages.first?.id == "msg_user")
        #expect(reconciled.messages.first?.turnId == "turn_1")
        #expect(reconciled.activeTurn?.id == "turn_1")
    }

    private func makeSnapshot() -> ConversationSnapshot {
        ConversationSnapshot(
            session: BeecodeSession(
                id: "ses_1",
                title: "Calculator",
                status: .active,
                version: 1,
                createdAt: "2026-08-13T00:00:00.000Z",
                updatedAt: "2026-08-13T00:00:00.000Z"
            ),
            messages: [],
            turns: [],
            live: ConversationLiveState(sequence: 0)
        )
    }

    private func makeTurn(status: ConversationTurn.Status) -> ConversationTurn {
        ConversationTurn(
            id: "turn_1",
            sessionId: "ses_1",
            index: 1,
            status: status,
            userMessageId: "msg_user"
        )
    }

    private func envelope(sequence: Int, event: AgentEvent) -> AgentEventEnvelope {
        AgentEventEnvelope(
            eventId: "evt_\(sequence)",
            sessionId: "ses_1",
            turnId: event.turnId,
            sequence: sequence,
            occurredAt: "2026-08-13T00:00:0\(sequence).000Z",
            event: event
        )
    }
}
