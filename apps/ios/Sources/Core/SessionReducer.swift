import Foundation

enum SessionReducerError: Error, Equatable, Sendable {
    case sessionMismatch
    case envelopeMismatch
    case sequenceGap(expected: Int, actual: Int)
}

enum SessionReducer {
    static func apply(
        _ envelope: AgentEventEnvelope,
        to current: ConversationSnapshot
    ) throws -> ConversationSnapshot {
        guard envelope.sessionId == current.session.id else {
            throw SessionReducerError.sessionMismatch
        }
        guard envelope.event.sessionId == envelope.sessionId,
              envelope.turnId == nil || envelope.turnId == envelope.event.turnId else {
            throw SessionReducerError.envelopeMismatch
        }

        let currentSequence = current.live?.sequence ?? 0
        if envelope.sequence <= currentSequence {
            return current
        }
        guard envelope.sequence == currentSequence + 1 else {
            throw SessionReducerError.sequenceGap(
                expected: currentSequence + 1,
                actual: envelope.sequence
            )
        }

        var next = current
        next.live = ConversationLiveState(
            sequence: envelope.sequence,
            activeTurnId: envelope.turnId
        )

        switch envelope.event {
        case .turnStarted(_, _, let turn):
            upsert(turn, in: &next.turns)
        case .messageDelta(_, let turnId, let messageId, let partId, let text):
            let messageIndex = ensureAssistantMessage(
                id: messageId,
                sessionId: next.session.id,
                turnId: turnId,
                occurredAt: envelope.occurredAt,
                in: &next.messages
            )
            if let partIndex = next.messages[messageIndex].parts.firstIndex(where: { $0.id == partId }),
               case .text(var part) = next.messages[messageIndex].parts[partIndex] {
                part.text += text
                next.messages[messageIndex].parts[partIndex] = .text(part)
            } else {
                next.messages[messageIndex].parts.append(
                    .text(ConversationTextPart(id: partId, text: text))
                )
            }
            patchTurn(id: turnId, in: &next.turns) { turn in
                turn.status = .modelStreaming
                turn.assistantMessageId = messageId
            }
        case .toolRequested(_, let turnId, let messageId, let partId, let toolCall):
            let messageIndex = ensureAssistantMessage(
                id: messageId,
                sessionId: next.session.id,
                turnId: turnId,
                occurredAt: envelope.occurredAt,
                in: &next.messages
            )
            if findToolCall(id: toolCall.id, in: next.messages) == nil {
                next.messages[messageIndex].parts.append(
                    .toolCall(ConversationToolCallPart(id: partId, toolCall: toolCall))
                )
            }
            patchTurn(id: turnId, in: &next.turns) { $0.status = .toolRunning }
        case .toolStarted(_, let turnId, let toolCallId):
            updateToolCall(id: toolCallId, in: &next.messages) { $0.status = .running }
            patchTurn(id: turnId, in: &next.turns) { $0.status = .toolRunning }
        case .toolCompleted(_, _, let toolCall), .toolFailed(_, _, let toolCall):
            updateToolCall(id: toolCall.id, in: &next.messages) { $0 = toolCall }
        case .turnCompleted(_, let turnId, let usage):
            patchTurn(id: turnId, in: &next.turns) { turn in
                turn.status = .completed
                turn.usage = usage
                turn.finishedAt = envelope.occurredAt
            }
            next.live = ConversationLiveState(sequence: envelope.sequence)
        case .turnFailed(_, let turnId, let error):
            patchTurn(id: turnId, in: &next.turns) { turn in
                turn.status = .failed
                turn.error = error
                turn.finishedAt = envelope.occurredAt
            }
            next.live = ConversationLiveState(sequence: envelope.sequence)
        case .turnCancelled(_, let turnId):
            patchTurn(id: turnId, in: &next.turns) { turn in
                turn.status = .cancelled
                turn.finishedAt = envelope.occurredAt
            }
            next.live = ConversationLiveState(sequence: envelope.sequence)
        }
        return next
    }

    static func appendingOptimisticMessage(
        to current: ConversationSnapshot,
        id: String,
        text: String,
        createdAt: String
    ) -> ConversationSnapshot {
        guard current.messages.contains(where: { $0.id == id }) == false else {
            return current
        }
        var next = current
        next.messages.append(
            ConversationMessage(
                id: id,
                sessionId: current.session.id,
                role: .user,
                parts: [
                    .text(ConversationTextPart(id: "part_\(id)", text: text)),
                ],
                createdAt: createdAt
            )
        )
        return next
    }

    static func reconcilingAcceptedTurn(
        in current: ConversationSnapshot,
        turn: ConversationTurn,
        optimisticMessageId: String,
        text: String,
        createdAt: String
    ) -> ConversationSnapshot {
        var next = current
        upsert(turn, in: &next.turns)
        let authoritativeIndex = next.messages.firstIndex { $0.id == turn.userMessageId }
        let optimisticIndex = next.messages.firstIndex { $0.id == optimisticMessageId }

        if let authoritativeIndex {
            if let optimisticIndex, optimisticIndex != authoritativeIndex {
                next.messages.remove(at: optimisticIndex)
            }
        } else if let optimisticIndex {
            next.messages[optimisticIndex].id = turn.userMessageId
            next.messages[optimisticIndex].turnId = turn.id
        } else {
            next.messages.append(
                ConversationMessage(
                    id: turn.userMessageId,
                    sessionId: turn.sessionId,
                    turnId: turn.id,
                    role: .user,
                    parts: [
                        .text(ConversationTextPart(id: "part_\(turn.userMessageId)", text: text)),
                    ],
                    createdAt: createdAt
                )
            )
        }
        if turn.status.isActive {
            next.live = ConversationLiveState(
                sequence: next.live?.sequence ?? 0,
                activeTurnId: turn.id
            )
        }
        return next
    }

    static func discardingOptimisticMessage(
        from current: ConversationSnapshot,
        id: String
    ) -> ConversationSnapshot {
        var next = current
        next.messages.removeAll { $0.id == id }
        return next
    }

    private static func upsert(_ turn: ConversationTurn, in turns: inout [ConversationTurn]) {
        if let index = turns.firstIndex(where: { $0.id == turn.id }) {
            turns[index] = turn
        } else {
            turns.append(turn)
        }
    }

    private static func patchTurn(
        id: String,
        in turns: inout [ConversationTurn],
        _ update: (inout ConversationTurn) -> Void
    ) {
        guard let index = turns.firstIndex(where: { $0.id == id }) else {
            return
        }
        update(&turns[index])
    }

    private static func ensureAssistantMessage(
        id: String,
        sessionId: String,
        turnId: String,
        occurredAt: String,
        in messages: inout [ConversationMessage]
    ) -> Int {
        if let index = messages.firstIndex(where: { $0.id == id }) {
            return index
        }
        messages.append(
            ConversationMessage(
                id: id,
                sessionId: sessionId,
                turnId: turnId,
                role: .assistant,
                parts: [],
                createdAt: occurredAt
            )
        )
        return messages.count - 1
    }

    private static func findToolCall(
        id: String,
        in messages: [ConversationMessage]
    ) -> BeecodeToolCall? {
        for message in messages {
            for part in message.parts {
                if case .toolCall(let toolPart) = part, toolPart.toolCall.id == id {
                    return toolPart.toolCall
                }
            }
        }
        return nil
    }

    private static func updateToolCall(
        id: String,
        in messages: inout [ConversationMessage],
        _ update: (inout BeecodeToolCall) -> Void
    ) {
        for messageIndex in messages.indices {
            for partIndex in messages[messageIndex].parts.indices {
                guard case .toolCall(var toolPart) = messages[messageIndex].parts[partIndex],
                      toolPart.toolCall.id == id else {
                    continue
                }
                update(&toolPart.toolCall)
                messages[messageIndex].parts[partIndex] = .toolCall(toolPart)
                return
            }
        }
    }
}
