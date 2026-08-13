import Foundation
@preconcurrency import Network

protocol NetworkConnectivity: Sendable {
    func waitUntilAvailable() async throws
}

struct SystemNetworkConnectivity: NetworkConnectivity, Sendable {
    func waitUntilAvailable() async throws {
        let statuses = AsyncStream<Bool> { continuation in
            let monitor = NWPathMonitor()
            let queue = DispatchQueue(label: "ai.beecode.ios.network-path")
            monitor.pathUpdateHandler = { path in
                continuation.yield(path.status == .satisfied)
            }
            continuation.onTermination = { @Sendable _ in
                monitor.cancel()
            }
            monitor.start(queue: queue)
        }

        for await isAvailable in statuses {
            try Task.checkCancellation()
            if isAvailable {
                return
            }
        }
        throw CancellationError()
    }
}

enum SessionEventStreamError: Error, LocalizedError, Equatable, Sendable {
    case disconnected
    case unknownEvent(String)
    case connectedEventMissing

    var errorDescription: String? {
        switch self {
        case .disconnected:
            "The live session stream disconnected."
        case .unknownEvent(let event):
            "The server sent an unsupported event: \(event)."
        case .connectedEventMissing:
            "The live session stream did not establish a recovery point."
        }
    }
}

actor SessionEventStream {
    private let baseURL: URL
    private let transport: any HTTPEventTransport
    private let tokenVault: TokenVault
    private let client: BeecodeClient
    private let connectivity: any NetworkConnectivity
    private var generation = 0

    init(
        baseURL: URL,
        transport: any HTTPEventTransport,
        tokenVault: TokenVault,
        client: BeecodeClient,
        connectivity: any NetworkConnectivity = SystemNetworkConnectivity()
    ) {
        self.baseURL = baseURL
        self.transport = transport
        self.tokenVault = tokenVault
        self.client = client
        self.connectivity = connectivity
    }

    func updates(for sessionId: String) -> AsyncThrowingStream<ConversationStreamUpdate, Error> {
        generation += 1
        let currentGeneration = generation
        return AsyncThrowingStream(bufferingPolicy: .bufferingNewest(256)) { continuation in
            let producer = Task {
                await self.run(
                    sessionId: sessionId,
                    generation: currentGeneration,
                    continuation: continuation
                )
            }
            continuation.onTermination = { @Sendable _ in
                producer.cancel()
            }
        }
    }

    func invalidate() {
        generation += 1
    }

    private func run(
        sessionId: String,
        generation: Int,
        continuation: AsyncThrowingStream<ConversationStreamUpdate, Error>.Continuation
    ) async {
        var attempt = 0
        while Task.isCancelled == false, self.generation == generation {
            continuation.yield(.connection(attempt == 0 ? .connecting : .reconnecting))
            do {
                try await consumeConnection(
                    sessionId: sessionId,
                    generation: generation,
                    continuation: continuation
                )
                throw SessionEventStreamError.disconnected
            } catch is CancellationError {
                continuation.finish()
                return
            } catch BeecodeClientError.unauthenticated {
                continuation.yield(.connection(.unauthenticated))
                continuation.finish(throwing: BeecodeClientError.unauthenticated)
                return
            } catch BeecodeClientError.product(let status, let error)
                where status == 404 || error.code == "SESSION_NOT_FOUND" {
                continuation.yield(.connection(.unavailable))
                continuation.finish(throwing: BeecodeClientError.product(status, error: error))
                return
            } catch BeecodeClientError.offline {
                continuation.yield(.connection(.reconnecting))
                do {
                    try await connectivity.waitUntilAvailable()
                    attempt = 0
                } catch {
                    continuation.finish()
                    return
                }
            } catch {
                attempt += 1
                do {
                    try await Task.sleep(for: retryDelay(attempt: attempt))
                } catch {
                    continuation.finish()
                    return
                }
            }
        }
        continuation.finish()
    }

    private func consumeConnection(
        sessionId: String,
        generation: Int,
        continuation: AsyncThrowingStream<ConversationStreamUpdate, Error>.Continuation
    ) async throws {
        let lines = try await authenticatedLines(sessionId: sessionId)
        var parser = SSEParser()
        var pendingEnvelopes: [AgentEventEnvelope] = []
        var snapshot: ConversationSnapshot?
        var recovered = false

        for try await line in lines {
            try Task.checkCancellation()
            guard self.generation == generation else {
                throw CancellationError()
            }
            guard let message = parser.consume(line) else {
                continue
            }
            let event = try SessionStreamEvent(message: message)
            switch event {
            case .connected:
                continuation.yield(.connection(.recovering))
                var authoritative = try await client.getSessionSnapshot(id: sessionId)
                for envelope in pendingEnvelopes.sorted(by: { $0.sequence < $1.sequence })
                    where envelope.sequence > (authoritative.live?.sequence ?? 0) {
                    authoritative = try SessionReducer.apply(envelope, to: authoritative)
                }
                pendingEnvelopes.removeAll(keepingCapacity: true)
                snapshot = authoritative
                recovered = true
                continuation.yield(.snapshot(authoritative))
                continuation.yield(.connection(.connected))
            case .agent(let envelope):
                guard recovered, var current = snapshot else {
                    pendingEnvelopes.append(envelope)
                    continue
                }
                current = try SessionReducer.apply(envelope, to: current)
                snapshot = current
                continuation.yield(.snapshot(current))
                if envelope.event.isTerminal {
                    let authoritative = try await client.getSessionSnapshot(id: sessionId)
                    snapshot = authoritative
                    continuation.yield(.snapshot(authoritative))
                }
            }
        }
        if recovered == false {
            throw SessionEventStreamError.connectedEventMissing
        }
    }

    private func authenticatedLines(
        sessionId: String
    ) async throws -> AsyncThrowingStream<String, Error> {
        let token = try await tokenVault.accessToken()
        do {
            return try await transport.lines(for: eventRequest(sessionId: sessionId, token: token))
        } catch BeecodeClientError.unauthenticated {
            let refreshed = try await tokenVault.accessToken(rejectedToken: token)
            return try await transport.lines(
                for: eventRequest(sessionId: sessionId, token: refreshed)
            )
        }
    }

    private func eventRequest(sessionId: String, token: String) -> URLRequest {
        let encoded = sessionId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? sessionId
        var request = URLRequest(
            url: baseURL.appending(path: "v1/ios/sessions/\(encoded)/events")
        )
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 60 * 60
        request.cachePolicy = .reloadIgnoringLocalCacheData
        return request
    }

    private func retryDelay(attempt: Int) -> Duration {
        let cappedAttempt = min(max(attempt - 1, 0), 5)
        let baseMilliseconds = min(30_000, 500 * (1 << cappedAttempt))
        let jitter = Double.random(in: 0.8...1.2)
        let milliseconds = min(30_000, Int(Double(baseMilliseconds) * jitter))
        return .milliseconds(milliseconds)
    }
}
