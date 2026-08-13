import Foundation
import Testing
@testable import Beecode

@Suite(.serialized)
struct BeecodeClientTests {
    @Test
    func listsAndMapsOnlyIOSSessionData() async throws {
        let transport = ScriptedTransport(responses: [
            .init(
                statusCode: 200,
                body: """
                {
                  "items": [{
                    "id": "ses_1",
                    "surface": "ios",
                    "accountId": "acct_1",
                    "title": "On device",
                    "status": "active",
                    "version": 3,
                    "createdAt": "2026-08-13T00:00:00.000Z",
                    "updatedAt": "2026-08-13T01:00:00.000Z"
                  }],
                  "nextCursor": null
                }
                """
            ),
        ])
        let client = try await makeClient(transport: transport)

        let page = try await client.listSessions()

        #expect(page.items.map(\.id) == ["ses_1"])
        #expect(page.items.first?.title == "On device")
        let requests = await transport.capturedRequests()
        #expect(requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer access")
        #expect(requests.first?.url?.path == "/v1/ios/sessions")
    }

    @Test
    func refreshesOnceAndReplaysAfterUnauthorizedResponse() async throws {
        let transport = ScriptedTransport(responses: [
            .init(statusCode: 401, body: "{}"),
            .init(
                statusCode: 200,
                body: """
                {
                  "access_token": "access-refreshed",
                  "refresh_token": "refresh-refreshed",
                  "token_type": "Bearer",
                  "expires_in": 900,
                  "account_id": "acct_1"
                }
                """
            ),
            .init(statusCode: 200, body: "{\"items\":[],\"nextCursor\":null}"),
        ])
        let client = try await makeClient(transport: transport)

        let page = try await client.listSessions()

        #expect(page.items.isEmpty)
        let requests = await transport.capturedRequests()
        #expect(requests.count == 3)
        #expect(requests[0].value(forHTTPHeaderField: "Authorization") == "Bearer access")
        #expect(requests[1].url?.path == "/oauth/token")
        #expect(requests[2].value(forHTTPHeaderField: "Authorization") == "Bearer access-refreshed")
    }

    @Test
    func rejectsSessionFromAnotherSurface() async throws {
        let transport = ScriptedTransport(responses: [
            .init(
                statusCode: 200,
                body: """
                {
                  "items": [{
                    "id": "ses_web",
                    "surface": "web",
                    "accountId": "acct_1",
                    "title": "Wrong surface",
                    "status": "active",
                    "version": 1,
                    "createdAt": "2026-08-13T00:00:00.000Z",
                    "updatedAt": "2026-08-13T00:00:00.000Z"
                  }],
                  "nextCursor": null
                }
                """
            ),
        ])
        let client = try await makeClient(transport: transport)

        await #expect(throws: BeecodeClientError.decoding) {
            _ = try await client.listSessions()
        }
    }

    @Test
    func submitsAnIdempotentTurnAndCancelsItThroughIOSRoutes() async throws {
        let transport = ScriptedTransport(responses: [
            .init(
                statusCode: 202,
                body: """
                {
                  "turn": {
                    "id": "turn_1",
                    "sessionId": "ses_1",
                    "index": 1,
                    "status": "queued",
                    "userMessageId": "msg_user"
                  }
                }
                """
            ),
            .init(statusCode: 204, body: ""),
        ])
        let client = try await makeClient(transport: transport)

        let turn = try await client.submitTurn(
            sessionId: "ses_1",
            text: "计算 1+1",
            idempotencyKey: "idem-ios-0001"
        )
        try await client.cancelTurn(sessionId: "ses_1", turnId: turn.id)

        #expect(turn.status == .queued)
        let requests = await transport.capturedRequests()
        #expect(requests.map(\.url?.path) == [
            "/v1/ios/sessions/ses_1/turns",
            "/v1/ios/sessions/ses_1/turns/turn_1/cancel",
        ])
        let requestBody = try #require(requests.first?.httpBody)
        let body = try JSONDecoder().decode(APISubmitTurnRequest.self, from: requestBody)
        #expect(body.text == "计算 1+1")
        #expect(body.idempotencyKey == "idem-ios-0001")
    }

    private func makeClient(transport: ScriptedTransport) async throws -> BeecodeClient {
        let configuration = AppConfiguration(
            apiBaseURL: URL(string: "https://api.test")!,
            oauthRedirectURI: URL(string: "ai.beecode.ios://oauth/callback")!
        )
        let vault = TokenVault(
            store: MemoryCredentialStore(),
            oauth: OAuthHTTPClient(configuration: configuration, transport: transport)
        )
        try await vault.install(
            OAuthTokens(
                accessToken: "access",
                refreshToken: "refresh",
                accountID: "acct_1",
                expiresAt: Date().addingTimeInterval(600)
            )
        )
        return BeecodeClient(
            baseURL: configuration.apiBaseURL,
            transport: transport,
            tokenVault: vault
        )
    }
}

actor ScriptedTransport: HTTPDataTransport {
    struct Stub: Sendable {
        let statusCode: Int
        let body: String
    }

    private var responses: [Stub]
    private var requests: [URLRequest] = []

    init(responses: [Stub]) {
        self.responses = responses
    }

    func data(for request: URLRequest) throws -> HTTPDataResponse {
        requests.append(request)
        guard responses.isEmpty == false else {
            throw BeecodeClientError.invalidResponse
        }
        let stub = responses.removeFirst()
        return HTTPDataResponse(data: Data(stub.body.utf8), statusCode: stub.statusCode)
    }

    func capturedRequests() -> [URLRequest] {
        requests
    }
}
