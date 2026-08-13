import Foundation
import Testing
@testable import Beecode

@Suite(.serialized)
struct SessionEventStreamTests {
    @Test
    func buffersEventsUntilConnectedThenMergesThemOverTheAuthoritativeSnapshot() async throws {
        let dataTransport = ScriptedTransport(responses: [
            .init(statusCode: 200, body: Self.emptySnapshotJSON),
        ])
        let eventTransport = ScriptedEventTransport(lines: [
            "event: agent",
            "id: evt_1",
            "data: \(Self.deltaEnvelopeJSON)",
            "",
            "event: stream.connected",
            "data: {\"sequence\":0}",
            "",
        ])
        let configuration = AppConfiguration(
            apiBaseURL: URL(string: "https://api.test")!,
            oauthRedirectURI: URL(string: "ai.beecode.ios://oauth/callback")!
        )
        let vault = TokenVault(
            store: MemoryCredentialStore(),
            oauth: OAuthHTTPClient(configuration: configuration, transport: dataTransport)
        )
        try await vault.install(
            OAuthTokens(
                accessToken: "access",
                refreshToken: "refresh",
                accountID: "acct_1",
                expiresAt: Date().addingTimeInterval(600)
            )
        )
        let client = BeecodeClient(
            baseURL: configuration.apiBaseURL,
            transport: dataTransport,
            tokenVault: vault
        )
        let stream = SessionEventStream(
            baseURL: configuration.apiBaseURL,
            transport: eventTransport,
            tokenVault: vault,
            client: client
        )

        let updates = await stream.updates(for: "ses_1")
        var observedSnapshot: ConversationSnapshot?
        for try await update in updates {
            if case .snapshot(let snapshot) = update, snapshot.live?.sequence == 1 {
                observedSnapshot = snapshot
                break
            }
        }
        await stream.invalidate()

        let snapshot = try #require(observedSnapshot)
        #expect(snapshot.messages.first?.plainText == "2")
        #expect(snapshot.live?.sequence == 1)
        let requests = await eventTransport.capturedRequests()
        #expect(requests.first?.url?.path == "/v1/ios/sessions/ses_1/events")
        #expect(requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer access")
    }

    @Test
    func waitsForConnectivityBeforeReconnectingAfterAnOfflineFailure() async throws {
        let dataTransport = ScriptedTransport(responses: [
            .init(statusCode: 200, body: Self.emptySnapshotJSON),
        ])
        let eventTransport = ScriptedEventTransport(responses: [
            .failure(.offline),
            .success([
                "event: stream.connected",
                "data: {\"sequence\":0}",
                "",
            ]),
        ])
        let connectivity = ImmediateConnectivity()
        let configuration = AppConfiguration(
            apiBaseURL: URL(string: "https://api.test")!,
            oauthRedirectURI: URL(string: "ai.beecode.ios://oauth/callback")!
        )
        let vault = TokenVault(
            store: MemoryCredentialStore(),
            oauth: OAuthHTTPClient(configuration: configuration, transport: dataTransport)
        )
        try await vault.install(
            OAuthTokens(
                accessToken: "access",
                refreshToken: "refresh",
                accountID: "acct_1",
                expiresAt: Date().addingTimeInterval(600)
            )
        )
        let client = BeecodeClient(
            baseURL: configuration.apiBaseURL,
            transport: dataTransport,
            tokenVault: vault
        )
        let stream = SessionEventStream(
            baseURL: configuration.apiBaseURL,
            transport: eventTransport,
            tokenVault: vault,
            client: client,
            connectivity: connectivity
        )

        let updates = await stream.updates(for: "ses_1")
        for try await update in updates {
            if update == .connection(.connected) {
                break
            }
        }
        await stream.invalidate()

        #expect(await connectivity.waitCount() == 1)
        #expect(await eventTransport.capturedRequests().count == 2)
    }

    private static let emptySnapshotJSON = """
    {
      "session": {
        "id": "ses_1",
        "surface": "ios",
        "accountId": "acct_1",
        "title": "Calculator",
        "status": "active",
        "version": 1,
        "createdAt": "2026-08-13T00:00:00.000Z",
        "updatedAt": "2026-08-13T00:00:00.000Z"
      },
      "messages": [],
      "turns": [],
      "live": { "sequence": 0, "activeTurnId": null }
    }
    """

    private static let deltaEnvelopeJSON = """
    {"eventId":"evt_1","sessionId":"ses_1","turnId":"turn_1","sequence":1,"occurredAt":"2026-08-13T00:00:01.000Z","event":{"type":"message.delta","sessionId":"ses_1","turnId":"turn_1","messageId":"msg_assistant","partId":"part_text","textDelta":"2"}}
    """
}

actor ScriptedEventTransport: HTTPEventTransport {
    private var responses: [Result<[String], BeecodeClientError>]
    private var requests: [URLRequest] = []

    init(lines: [String]) {
        responses = [.success(lines)]
    }

    init(responses: [Result<[String], BeecodeClientError>]) {
        self.responses = responses
    }

    func lines(for request: URLRequest) throws -> AsyncThrowingStream<String, Error> {
        requests.append(request)
        guard responses.isEmpty == false else {
            throw SessionEventStreamError.disconnected
        }
        let responseLines = try responses.removeFirst().get()
        return AsyncThrowingStream { continuation in
            for line in responseLines {
                continuation.yield(line)
            }
            continuation.finish()
        }
    }

    func capturedRequests() -> [URLRequest] {
        requests
    }
}

actor ImmediateConnectivity: NetworkConnectivity {
    private var count = 0

    func waitUntilAvailable() {
        count += 1
    }

    func waitCount() -> Int {
        count
    }
}
