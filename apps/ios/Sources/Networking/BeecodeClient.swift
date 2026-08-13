import Foundation

struct BeecodeSession: Identifiable, Hashable, Sendable {
    enum Status: String, Sendable {
        case active
        case archived
    }

    let id: String
    let title: String
    let status: Status
    let version: Int
    let createdAt: String
    let updatedAt: String
}

struct SessionPage: Sendable {
    let items: [BeecodeSession]
    let nextCursor: String?
}

enum BeecodeClientError: Error, LocalizedError, Sendable, Equatable {
    case invalidResponse
    case offline
    case timedOut
    case transport(String)
    case unauthenticated
    case http(Int, message: String?)
    case decoding

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            "The server returned an invalid response."
        case .offline:
            "You appear to be offline."
        case .timedOut:
            "The request timed out."
        case .transport(let message):
            message
        case .unauthenticated:
            "Please sign in again."
        case .http(let status, let message):
            message ?? "The server returned HTTP \(status)."
        case .decoding:
            "The server response could not be read."
        }
    }

    static func from(statusCode: Int, data: Data) -> BeecodeClientError {
        if statusCode == 401 {
            return .unauthenticated
        }
        let message = try? JSONDecoder().decode(APIErrorResponse.self, from: data).error.message
        return .http(statusCode, message: message)
    }
}

actor BeecodeClient {
    private let baseURL: URL
    private let transport: any HTTPDataTransport
    private let tokenVault: TokenVault
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()

    init(baseURL: URL, transport: any HTTPDataTransport, tokenVault: TokenVault) {
        self.baseURL = baseURL
        self.transport = transport
        self.tokenVault = tokenVault
    }

    func listSessions(cursor: String? = nil, limit: Int = 50) async throws -> SessionPage {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor {
            query.append(URLQueryItem(name: "cursor", value: cursor))
        }
        let page: APISessionPage = try await send(method: "GET", path: "v1/ios/sessions", query: query)
        return SessionPage(items: try page.items.map(mapSession), nextCursor: page.nextCursor)
    }

    func createSession(title: String? = nil) async throws -> BeecodeSession {
        let dto: APISession = try await send(
            method: "POST",
            path: "v1/ios/sessions",
            body: APICreateSessionRequest(title: title)
        )
        return try mapSession(dto)
    }

    func getSession(id: String) async throws -> BeecodeSession {
        let snapshot: APISessionSnapshot = try await send(
            method: "GET",
            path: "v1/ios/sessions/\(encodedPathComponent(id))"
        )
        return try mapSession(snapshot.session)
    }

    func renameSession(_ session: BeecodeSession, title: String) async throws -> BeecodeSession {
        let dto: APISession = try await send(
            method: "PATCH",
            path: "v1/ios/sessions/\(encodedPathComponent(session.id))",
            body: APIUpdateSessionRequest(
                expectedVersion: session.version,
                title: title,
                status: nil
            )
        )
        return try mapSession(dto)
    }

    func archiveSession(_ session: BeecodeSession) async throws -> BeecodeSession {
        let dto: APISession = try await send(
            method: "PATCH",
            path: "v1/ios/sessions/\(encodedPathComponent(session.id))",
            body: APIUpdateSessionRequest(
                expectedVersion: session.version,
                title: nil,
                status: .archived
            )
        )
        return try mapSession(dto)
    }

    private func send<Response: Decodable & Sendable>(
        method: String,
        path: String,
        query: [URLQueryItem] = []
    ) async throws -> Response {
        try await send(method: method, path: path, query: query, bodyData: nil)
    }

    private func send<Response: Decodable & Sendable, Body: Encodable & Sendable>(
        method: String,
        path: String,
        query: [URLQueryItem] = [],
        body: Body
    ) async throws -> Response {
        let bodyData: Data
        do {
            bodyData = try encoder.encode(body)
        } catch {
            throw BeecodeClientError.decoding
        }
        return try await send(method: method, path: path, query: query, bodyData: bodyData)
    }

    private func send<Response: Decodable & Sendable>(
        method: String,
        path: String,
        query: [URLQueryItem],
        bodyData: Data?
    ) async throws -> Response {
        let accessToken = try await tokenVault.accessToken()
        var result = try await transport.data(
            for: makeRequest(
                method: method,
                path: path,
                query: query,
                bodyData: bodyData,
                accessToken: accessToken
            )
        )
        if result.statusCode == 401 {
            let refreshedToken = try await tokenVault.accessToken(rejectedToken: accessToken)
            result = try await transport.data(
                for: makeRequest(
                    method: method,
                    path: path,
                    query: query,
                    bodyData: bodyData,
                    accessToken: refreshedToken
                )
            )
        }
        guard (200..<300).contains(result.statusCode) else {
            throw BeecodeClientError.from(
                statusCode: result.statusCode,
                data: result.data
            )
        }
        do {
            return try decoder.decode(Response.self, from: result.data)
        } catch {
            throw BeecodeClientError.decoding
        }
    }

    private func makeRequest(
        method: String,
        path: String,
        query: [URLQueryItem],
        bodyData: Data?,
        accessToken: String
    ) -> URLRequest {
        var components = URLComponents(
            url: baseURL.appending(path: path),
            resolvingAgainstBaseURL: false
        )
        if query.isEmpty == false {
            components?.queryItems = query
        }
        var request = URLRequest(url: components?.url ?? baseURL)
        request.httpMethod = method
        request.httpBody = bodyData
        request.timeoutInterval = 30
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if bodyData != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func mapSession(_ dto: APISession) throws -> BeecodeSession {
        guard dto.surface == "ios", let status = BeecodeSession.Status(rawValue: dto.status.rawValue) else {
            throw BeecodeClientError.decoding
        }
        return BeecodeSession(
            id: dto.id,
            title: dto.title,
            status: status,
            version: dto.version,
            createdAt: dto.createdAt,
            updatedAt: dto.updatedAt
        )
    }

    private func encodedPathComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}
