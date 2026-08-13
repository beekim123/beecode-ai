import Foundation

enum APISessionStatus: String, Codable, Sendable {
    case active
    case archived
}

struct APISession: Codable, Sendable {
    let id: String
    let surface: String
    let accountId: String
    let title: String
    let status: APISessionStatus
    let version: Int
    let createdAt: String
    let updatedAt: String
}

struct APISessionPage: Codable, Sendable {
    let items: [APISession]
    let nextCursor: String?
}

struct APISessionSnapshot: Decodable, Sendable {
    let session: APISession
    let messages: [ConversationMessage]
    let turns: [ConversationTurn]
    let live: ConversationLiveState?
}

struct APICreateSessionRequest: Encodable, Sendable {
    let title: String?
}

struct APIUpdateSessionRequest: Encodable, Sendable {
    let expectedVersion: Int
    let title: String?
    let status: APISessionStatus?
}

struct APISubmitTurnRequest: Codable, Sendable {
    let text: String
    let idempotencyKey: String
}

struct APISubmitTurnResponse: Decodable, Sendable {
    let turn: ConversationTurn
}

struct APIErrorResponse: Decodable, Sendable {
    struct Body: Decodable, Sendable {
        let code: String
        let message: String
        let retryable: Bool
    }

    let error: Body
    let requestId: String
}
