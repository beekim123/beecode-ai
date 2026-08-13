import Foundation

enum JSONValue: Codable, Equatable, Sendable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case boolean(Bool)
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .boolean(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value):
            try container.encode(value)
        case .array(let value):
            try container.encode(value)
        case .string(let value):
            try container.encode(value)
        case .number(let value):
            try container.encode(value)
        case .boolean(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }

    var displayText: String {
        if case .number(let value) = self, value.rounded() == value {
            return String(Int(value))
        }
        guard let data = try? JSONEncoder.prettyPrinted.encode(self),
              let text = String(data: data, encoding: .utf8) else {
            return "null"
        }
        return text
    }
}

struct BeecodeErrorShape: Codable, Equatable, Sendable {
    let code: String
    let message: String
    let retryable: Bool
}

struct ConversationUsage: Codable, Equatable, Sendable {
    let inputTokens: Int
    let outputTokens: Int
    let totalTokens: Int
}

struct ConversationTurn: Codable, Identifiable, Equatable, Sendable {
    enum Status: String, Codable, Sendable {
        case queued
        case running
        case modelStreaming = "model_streaming"
        case toolRunning = "tool_running"
        case completed
        case failed
        case cancelled

        var isActive: Bool {
            switch self {
            case .queued, .running, .modelStreaming, .toolRunning:
                true
            case .completed, .failed, .cancelled:
                false
            }
        }
    }

    let id: String
    let sessionId: String
    let index: Int
    var status: Status
    let userMessageId: String
    var assistantMessageId: String?
    var error: BeecodeErrorShape?
    var usage: ConversationUsage?
    var startedAt: String?
    var finishedAt: String?
}

struct BeecodeToolCall: Codable, Identifiable, Equatable, Sendable {
    enum Status: String, Codable, Sendable {
        case requested
        case running
        case completed
        case failed
        case rejected
    }

    let id: String
    let name: String
    let input: JSONValue
    var status: Status
    var output: JSONValue?
    var error: BeecodeErrorShape?
}

struct BeecodeToolResult: Codable, Equatable, Sendable {
    let ok: Bool
    let output: JSONValue?
    let error: BeecodeErrorShape?
}

struct ConversationTextPart: Codable, Identifiable, Equatable, Sendable {
    let id: String
    var text: String
}

struct ConversationToolCallPart: Codable, Identifiable, Equatable, Sendable {
    let id: String
    var toolCall: BeecodeToolCall
}

struct ConversationToolResultPart: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let toolCallId: String
    let result: BeecodeToolResult
}

enum ConversationPart: Codable, Identifiable, Equatable, Sendable {
    case text(ConversationTextPart)
    case toolCall(ConversationToolCallPart)
    case toolResult(ConversationToolResultPart)

    private enum CodingKeys: String, CodingKey {
        case id
        case type
        case text
        case toolCall
        case toolCallId
        case result
    }

    private enum Kind: String, Codable {
        case text
        case toolCall = "tool_call"
        case toolResult = "tool_result"
    }

    var id: String {
        switch self {
        case .text(let part): part.id
        case .toolCall(let part): part.id
        case .toolResult(let part): part.id
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let id = try container.decode(String.self, forKey: .id)
        switch try container.decode(Kind.self, forKey: .type) {
        case .text:
            self = .text(
                ConversationTextPart(
                    id: id,
                    text: try container.decode(String.self, forKey: .text)
                )
            )
        case .toolCall:
            self = .toolCall(
                ConversationToolCallPart(
                    id: id,
                    toolCall: try container.decode(BeecodeToolCall.self, forKey: .toolCall)
                )
            )
        case .toolResult:
            self = .toolResult(
                ConversationToolResultPart(
                    id: id,
                    toolCallId: try container.decode(String.self, forKey: .toolCallId),
                    result: try container.decode(BeecodeToolResult.self, forKey: .result)
                )
            )
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        switch self {
        case .text(let part):
            try container.encode(Kind.text, forKey: .type)
            try container.encode(part.text, forKey: .text)
        case .toolCall(let part):
            try container.encode(Kind.toolCall, forKey: .type)
            try container.encode(part.toolCall, forKey: .toolCall)
        case .toolResult(let part):
            try container.encode(Kind.toolResult, forKey: .type)
            try container.encode(part.toolCallId, forKey: .toolCallId)
            try container.encode(part.result, forKey: .result)
        }
    }
}

struct ConversationMessage: Codable, Identifiable, Equatable, Sendable {
    enum Role: String, Codable, Sendable {
        case user
        case assistant
        case tool
    }

    var id: String
    let sessionId: String
    var turnId: String?
    let role: Role
    var parts: [ConversationPart]
    let createdAt: String

    var plainText: String {
        parts.compactMap { part in
            guard case .text(let text) = part else { return nil }
            return text.text
        }.joined()
    }
}

struct ConversationLiveState: Codable, Equatable, Sendable {
    var sequence: Int
    var activeTurnId: String?
}

struct ConversationSnapshot: Equatable, Sendable {
    var session: BeecodeSession
    var messages: [ConversationMessage]
    var turns: [ConversationTurn]
    var live: ConversationLiveState?

    var activeTurn: ConversationTurn? {
        if let activeTurnId = live?.activeTurnId,
           let turn = turns.first(where: { $0.id == activeTurnId && $0.status.isActive }) {
            return turn
        }
        return turns.last(where: { $0.status.isActive })
    }

    var latestToolCall: BeecodeToolCall? {
        for message in messages.reversed() {
            for part in message.parts.reversed() {
                if case .toolCall(let toolPart) = part {
                    return toolPart.toolCall
                }
            }
        }
        return nil
    }

    var activityRevision: String {
        let lastMessage = messages.last
        return [
            String(live?.sequence ?? 0),
            lastMessage?.id ?? "",
            String(lastMessage?.plainText.count ?? 0),
            activeTurn?.status.rawValue ?? "idle",
        ].joined(separator: ":")
    }
}

struct AgentEventEnvelope: Codable, Equatable, Sendable {
    let eventId: String
    let sessionId: String
    let turnId: String?
    let sequence: Int
    let occurredAt: String
    let event: AgentEvent
}

enum AgentEvent: Codable, Equatable, Sendable {
    case turnStarted(sessionId: String, turnId: String, turn: ConversationTurn)
    case messageDelta(sessionId: String, turnId: String, messageId: String, partId: String, text: String)
    case toolRequested(sessionId: String, turnId: String, messageId: String, partId: String, toolCall: BeecodeToolCall)
    case toolStarted(sessionId: String, turnId: String, toolCallId: String)
    case toolCompleted(sessionId: String, turnId: String, toolCall: BeecodeToolCall)
    case toolFailed(sessionId: String, turnId: String, toolCall: BeecodeToolCall)
    case turnCompleted(sessionId: String, turnId: String, usage: ConversationUsage?)
    case turnFailed(sessionId: String, turnId: String, error: BeecodeErrorShape)
    case turnCancelled(sessionId: String, turnId: String)

    private enum CodingKeys: String, CodingKey {
        case type
        case sessionId
        case turnId
        case turn
        case messageId
        case partId
        case textDelta
        case toolCall
        case toolCallId
        case usage
        case error
    }

    private enum Kind: String, Codable {
        case turnStarted = "turn.started"
        case messageDelta = "message.delta"
        case toolRequested = "tool.requested"
        case toolStarted = "tool.started"
        case toolCompleted = "tool.completed"
        case toolFailed = "tool.failed"
        case turnCompleted = "turn.completed"
        case turnFailed = "turn.failed"
        case turnCancelled = "turn.cancelled"
    }

    var sessionId: String {
        switch self {
        case .turnStarted(let sessionId, _, _),
             .messageDelta(let sessionId, _, _, _, _),
             .toolRequested(let sessionId, _, _, _, _),
             .toolStarted(let sessionId, _, _),
             .toolCompleted(let sessionId, _, _),
             .toolFailed(let sessionId, _, _),
             .turnCompleted(let sessionId, _, _),
             .turnFailed(let sessionId, _, _),
             .turnCancelled(let sessionId, _):
            sessionId
        }
    }

    var turnId: String {
        switch self {
        case .turnStarted(_, let turnId, _),
             .messageDelta(_, let turnId, _, _, _),
             .toolRequested(_, let turnId, _, _, _),
             .toolStarted(_, let turnId, _),
             .toolCompleted(_, let turnId, _),
             .toolFailed(_, let turnId, _),
             .turnCompleted(_, let turnId, _),
             .turnFailed(_, let turnId, _),
             .turnCancelled(_, let turnId):
            turnId
        }
    }

    var isTerminal: Bool {
        switch self {
        case .turnCompleted, .turnFailed, .turnCancelled:
            true
        default:
            false
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(Kind.self, forKey: .type)
        let sessionId = try container.decode(String.self, forKey: .sessionId)
        let turnId = try container.decode(String.self, forKey: .turnId)
        switch kind {
        case .turnStarted:
            self = .turnStarted(
                sessionId: sessionId,
                turnId: turnId,
                turn: try container.decode(ConversationTurn.self, forKey: .turn)
            )
        case .messageDelta:
            self = .messageDelta(
                sessionId: sessionId,
                turnId: turnId,
                messageId: try container.decode(String.self, forKey: .messageId),
                partId: try container.decode(String.self, forKey: .partId),
                text: try container.decode(String.self, forKey: .textDelta)
            )
        case .toolRequested:
            self = .toolRequested(
                sessionId: sessionId,
                turnId: turnId,
                messageId: try container.decode(String.self, forKey: .messageId),
                partId: try container.decode(String.self, forKey: .partId),
                toolCall: try container.decode(BeecodeToolCall.self, forKey: .toolCall)
            )
        case .toolStarted:
            self = .toolStarted(
                sessionId: sessionId,
                turnId: turnId,
                toolCallId: try container.decode(String.self, forKey: .toolCallId)
            )
        case .toolCompleted:
            self = .toolCompleted(
                sessionId: sessionId,
                turnId: turnId,
                toolCall: try container.decode(BeecodeToolCall.self, forKey: .toolCall)
            )
        case .toolFailed:
            self = .toolFailed(
                sessionId: sessionId,
                turnId: turnId,
                toolCall: try container.decode(BeecodeToolCall.self, forKey: .toolCall)
            )
        case .turnCompleted:
            self = .turnCompleted(
                sessionId: sessionId,
                turnId: turnId,
                usage: try container.decodeIfPresent(ConversationUsage.self, forKey: .usage)
            )
        case .turnFailed:
            self = .turnFailed(
                sessionId: sessionId,
                turnId: turnId,
                error: try container.decode(BeecodeErrorShape.self, forKey: .error)
            )
        case .turnCancelled:
            self = .turnCancelled(sessionId: sessionId, turnId: turnId)
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(sessionId, forKey: .sessionId)
        try container.encode(turnId, forKey: .turnId)
        switch self {
        case .turnStarted(_, _, let turn):
            try container.encode(Kind.turnStarted, forKey: .type)
            try container.encode(turn, forKey: .turn)
        case .messageDelta(_, _, let messageId, let partId, let text):
            try container.encode(Kind.messageDelta, forKey: .type)
            try container.encode(messageId, forKey: .messageId)
            try container.encode(partId, forKey: .partId)
            try container.encode(text, forKey: .textDelta)
        case .toolRequested(_, _, let messageId, let partId, let toolCall):
            try container.encode(Kind.toolRequested, forKey: .type)
            try container.encode(messageId, forKey: .messageId)
            try container.encode(partId, forKey: .partId)
            try container.encode(toolCall, forKey: .toolCall)
        case .toolStarted(_, _, let toolCallId):
            try container.encode(Kind.toolStarted, forKey: .type)
            try container.encode(toolCallId, forKey: .toolCallId)
        case .toolCompleted(_, _, let toolCall):
            try container.encode(Kind.toolCompleted, forKey: .type)
            try container.encode(toolCall, forKey: .toolCall)
        case .toolFailed(_, _, let toolCall):
            try container.encode(Kind.toolFailed, forKey: .type)
            try container.encode(toolCall, forKey: .toolCall)
        case .turnCompleted(_, _, let usage):
            try container.encode(Kind.turnCompleted, forKey: .type)
            try container.encodeIfPresent(usage, forKey: .usage)
        case .turnFailed(_, _, let error):
            try container.encode(Kind.turnFailed, forKey: .type)
            try container.encode(error, forKey: .error)
        case .turnCancelled:
            try container.encode(Kind.turnCancelled, forKey: .type)
        }
    }
}

enum ConversationConnectionState: String, Equatable, Sendable {
    case disconnected
    case connecting
    case recovering
    case connected
    case reconnecting
    case unauthenticated
    case unavailable
}

enum ConversationStreamUpdate: Equatable, Sendable {
    case connection(ConversationConnectionState)
    case snapshot(ConversationSnapshot)
}

private extension JSONEncoder {
    static var prettyPrinted: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}
