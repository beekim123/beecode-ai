import Foundation

struct HTTPDataResponse: Sendable {
    let data: Data
    let statusCode: Int
}

protocol HTTPDataTransport: Sendable {
    func data(for request: URLRequest) async throws -> HTTPDataResponse
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
