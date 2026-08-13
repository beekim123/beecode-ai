import Foundation

struct HTTPDataResponse: Sendable {
    let data: Data
    let statusCode: Int
}

protocol HTTPDataTransport: Sendable {
    func data(for request: URLRequest) async throws -> HTTPDataResponse
}

protocol HTTPEventTransport: Sendable {
    func lines(for request: URLRequest) async throws -> AsyncThrowingStream<String, Error>
}

struct URLSessionTransport: HTTPDataTransport, Sendable {
    private let session: URLSession

    init(session: URLSession) {
        self.session = session
    }

    func data(for request: URLRequest) async throws -> HTTPDataResponse {
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw BeecodeClientError.invalidResponse
            }
            return HTTPDataResponse(data: data, statusCode: httpResponse.statusCode)
        } catch let error as URLError {
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost:
                throw BeecodeClientError.offline
            case .timedOut:
                throw BeecodeClientError.timedOut
            case .cancelled:
                throw CancellationError()
            default:
                throw BeecodeClientError.transport(error.localizedDescription)
            }
        }
    }

    static func live() -> URLSessionTransport {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        configuration.requestCachePolicy = .reloadRevalidatingCacheData
        configuration.httpAdditionalHeaders = ["Accept": "application/json"]
        return URLSessionTransport(session: URLSession(configuration: configuration))
    }
}

extension URLSessionTransport: HTTPEventTransport {
    func lines(for request: URLRequest) async throws -> AsyncThrowingStream<String, Error> {
        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch let error as URLError {
            throw map(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw BeecodeClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            var data = Data()
            for try await byte in bytes {
                data.append(byte)
            }
            throw BeecodeClientError.from(statusCode: httpResponse.statusCode, data: data)
        }

        return AsyncThrowingStream { continuation in
            let producer = Task {
                var framer = SSELineFramer()
                do {
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        if let line = framer.consume(byte) {
                            continuation.yield(line)
                        }
                    }
                    if let finalLine = framer.finish() {
                        continuation.yield(finalLine)
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch let error as URLError {
                    continuation.finish(throwing: map(error))
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { @Sendable _ in
                producer.cancel()
            }
        }
    }

    private func map(_ error: URLError) -> Error {
        switch error.code {
        case .notConnectedToInternet, .networkConnectionLost:
            BeecodeClientError.offline
        case .timedOut:
            BeecodeClientError.timedOut
        case .cancelled:
            CancellationError()
        default:
            BeecodeClientError.transport(error.localizedDescription)
        }
    }
}
