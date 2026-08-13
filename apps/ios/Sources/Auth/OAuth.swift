@preconcurrency import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

struct OAuthTokens: Codable, Equatable, Sendable {
    let accessToken: String
    let refreshToken: String
    let accountID: String
    let expiresAt: Date
}

struct StoredOAuthCredentials: Codable, Equatable, Sendable {
    let refreshToken: String
    let accountID: String
}

struct PKCERequest: Sendable {
    let state: String
    let verifier: String
    let challenge: String

    static func make() throws -> PKCERequest {
        let state = try secureRandomURLSafeString(byteCount: 32)
        let verifier = try secureRandomURLSafeString(byteCount: 48)
        let digest = SHA256.hash(data: Data(verifier.utf8))
        return PKCERequest(
            state: state,
            verifier: verifier,
            challenge: Data(digest).base64URLEncodedString()
        )
    }

    private static func secureRandomURLSafeString(byteCount: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: byteCount)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        guard status == errSecSuccess else {
            throw OAuthError.secureRandomFailed(status)
        }
        return Data(bytes).base64URLEncodedString()
    }
}

enum OAuthError: Error, LocalizedError, Sendable {
    case secureRandomFailed(OSStatus)
    case invalidAuthorizationURL
    case invalidCallback
    case stateMismatch
    case accessDenied
    case notAuthenticated
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .secureRandomFailed:
            "Unable to create a secure login request."
        case .invalidAuthorizationURL:
            "Unable to build the login URL."
        case .invalidCallback:
            "The login callback was invalid."
        case .stateMismatch:
            "The login response could not be verified."
        case .accessDenied:
            "Login was cancelled or denied."
        case .notAuthenticated:
            "Please sign in again."
        case .keychain:
            "Unable to access secure credentials."
        }
    }
}

struct OAuthHTTPClient: Sendable {
    private struct TokenResponse: Decodable, Sendable {
        let accessToken: String
        let refreshToken: String
        let expiresIn: Int
        let accountID: String

        enum CodingKeys: String, CodingKey {
            case accessToken = "access_token"
            case refreshToken = "refresh_token"
            case expiresIn = "expires_in"
            case accountID = "account_id"
        }
    }

    let configuration: AppConfiguration
    let transport: any HTTPDataTransport

    func authorizationURL(for request: PKCERequest) throws -> URL {
        guard var components = URLComponents(
            url: configuration.apiBaseURL.appending(path: "oauth/authorize"),
            resolvingAgainstBaseURL: false
        ) else {
            throw OAuthError.invalidAuthorizationURL
        }
        components.queryItems = [
            URLQueryItem(name: "response_type", value: "code"),
            URLQueryItem(name: "client_id", value: AppConfiguration.oauthClientID),
            URLQueryItem(name: "redirect_uri", value: configuration.oauthRedirectURI.absoluteString),
            URLQueryItem(name: "code_challenge", value: request.challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "state", value: request.state),
        ]
        guard let url = components.url else {
            throw OAuthError.invalidAuthorizationURL
        }
        return url
    }

    func exchange(code: String, verifier: String) async throws -> OAuthTokens {
        try await tokenRequest([
            URLQueryItem(name: "grant_type", value: "authorization_code"),
            URLQueryItem(name: "code", value: code),
            URLQueryItem(name: "client_id", value: AppConfiguration.oauthClientID),
            URLQueryItem(name: "redirect_uri", value: configuration.oauthRedirectURI.absoluteString),
            URLQueryItem(name: "code_verifier", value: verifier),
        ])
    }

    func refresh(_ refreshToken: String) async throws -> OAuthTokens {
        try await tokenRequest([
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refreshToken),
            URLQueryItem(name: "client_id", value: AppConfiguration.oauthClientID),
        ])
    }

    func revoke(_ refreshToken: String) async throws {
        var request = URLRequest(url: configuration.apiBaseURL.appending(path: "oauth/revoke"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formData([
            URLQueryItem(name: "token", value: refreshToken),
            URLQueryItem(name: "client_id", value: AppConfiguration.oauthClientID),
        ])
        let response = try await transport.data(for: request)
        guard (200..<300).contains(response.statusCode) else {
            throw BeecodeClientError.http(response.statusCode, message: nil)
        }
    }

    private func tokenRequest(_ items: [URLQueryItem]) async throws -> OAuthTokens {
        var request = URLRequest(url: configuration.apiBaseURL.appending(path: "oauth/token"))
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formData(items)
        let result = try await transport.data(for: request)
        guard (200..<300).contains(result.statusCode) else {
            throw BeecodeClientError.from(statusCode: result.statusCode, data: result.data)
        }
        let response = try JSONDecoder().decode(TokenResponse.self, from: result.data)
        return OAuthTokens(
            accessToken: response.accessToken,
            refreshToken: response.refreshToken,
            accountID: response.accountID,
            expiresAt: Date().addingTimeInterval(TimeInterval(response.expiresIn))
        )
    }

    private func formData(_ items: [URLQueryItem]) -> Data {
        var components = URLComponents()
        components.queryItems = items
        return Data((components.percentEncodedQuery ?? "").utf8)
    }
}

protocol CredentialStore: Sendable {
    func load() async throws -> Data?
    func save(_ data: Data) async throws
    func delete() async throws
}

struct KeychainCredentialStore: CredentialStore, Sendable {
    let service: String
    let account: String

    init(service: String = "ai.beecode.ios.oauth", account: String = "tokens") {
        self.service = service
        self.account = account
    }

    func load() async throws -> Data? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = item as? Data else {
            throw OAuthError.keychain(status)
        }
        return data
    }

    func save(_ data: Data) async throws {
        let status = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData as String: data] as CFDictionary
        )
        if status == errSecItemNotFound {
            var item = baseQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            item[kSecAttrSynchronizable as String] = false
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw OAuthError.keychain(addStatus)
            }
            return
        }
        guard status == errSecSuccess else {
            throw OAuthError.keychain(status)
        }
    }

    func delete() async throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw OAuthError.keychain(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

actor TokenVault {
    private let store: any CredentialStore
    private let oauth: OAuthHTTPClient
    private var tokens: OAuthTokens?
    private var credentials: StoredOAuthCredentials?
    private var refreshTask: Task<OAuthTokens, Error>?

    init(store: any CredentialStore, oauth: OAuthHTTPClient) {
        self.store = store
        self.oauth = oauth
    }

    func restore() async throws -> Bool {
        guard let data = try await store.load() else {
            tokens = nil
            credentials = nil
            return false
        }
        tokens = nil
        credentials = try JSONDecoder().decode(StoredOAuthCredentials.self, from: data)
        return true
    }

    func install(_ newTokens: OAuthTokens) async throws {
        let newCredentials = StoredOAuthCredentials(
            refreshToken: newTokens.refreshToken,
            accountID: newTokens.accountID
        )
        try await store.save(JSONEncoder().encode(newCredentials))
        credentials = newCredentials
        tokens = newTokens
    }

    func accessToken(rejectedToken: String? = nil) async throws -> String {
        guard let credentials else {
            throw OAuthError.notAuthenticated
        }
        guard let current = tokens else {
            return try await refresh(credentials.refreshToken).accessToken
        }
        if rejectedToken == nil && current.expiresAt.timeIntervalSinceNow > 30 {
            return current.accessToken
        }
        if let rejectedToken, rejectedToken != current.accessToken {
            return current.accessToken
        }
        return try await refresh(current.refreshToken).accessToken
    }

    func hasCredentials() -> Bool {
        credentials != nil
    }

    func logout() async {
        let refreshToken = credentials?.refreshToken
        tokens = nil
        credentials = nil
        refreshTask?.cancel()
        refreshTask = nil
        if let refreshToken {
            try? await oauth.revoke(refreshToken)
        }
        try? await store.delete()
    }

    private func refresh(_ refreshToken: String) async throws -> OAuthTokens {
        if let refreshTask {
            return try await refreshTask.value
        }
        let oauth = self.oauth
        let task = Task<OAuthTokens, Error> {
            try await oauth.refresh(refreshToken)
        }
        refreshTask = task
        do {
            let refreshed = try await task.value
            try await install(refreshed)
            refreshTask = nil
            return refreshed
        } catch {
            refreshTask = nil
            throw error
        }
    }
}

@MainActor
final class OAuthWebSession: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?
    private let fallbackWindow = UIWindow(frame: .zero)

    func authenticate(at url: URL, callbackScheme: String) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: url,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackURL, error in
                self?.session = nil
                if let authenticationError = error as? ASWebAuthenticationSessionError,
                   authenticationError.code == .canceledLogin {
                    continuation.resume(throwing: OAuthError.accessDenied)
                    return
                }
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let callbackURL else {
                    continuation.resume(throwing: OAuthError.invalidCallback)
                    return
                }
                continuation.resume(returning: callbackURL)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if session.start() == false {
                self.session = nil
                continuation.resume(throwing: OAuthError.invalidAuthorizationURL)
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? fallbackWindow
    }
}

private extension Data {
    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
