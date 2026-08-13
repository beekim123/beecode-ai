import Foundation
import Observation

@MainActor
@Observable
final class AppStore {
    enum Phase: Equatable {
        case loading
        case signedOut
        case signedIn
        case configurationError(String)
    }

    private let configuration: AppConfiguration?
    private let oauth: OAuthHTTPClient?
    private let tokenVault: TokenVault?
    private let client: BeecodeClient?
    private let webSession: OAuthWebSession?

    var phase: Phase
    var sessions: [BeecodeSession] = []
    var selectedSessionID: String?
    var isWorking = false
    var errorMessage: String?
    var editingSession: BeecodeSession?
    var sessionTitleDraft = ""
    var sessionPendingArchive: BeecodeSession?

    var selectedSession: BeecodeSession? {
        sessions.first { $0.id == selectedSessionID }
    }

    init(
        configuration: AppConfiguration,
        oauth: OAuthHTTPClient,
        tokenVault: TokenVault,
        client: BeecodeClient,
        webSession: OAuthWebSession
    ) {
        self.configuration = configuration
        self.oauth = oauth
        self.tokenVault = tokenVault
        self.client = client
        self.webSession = webSession
        self.phase = .loading
    }

    private init(configurationError: Error) {
        configuration = nil
        oauth = nil
        tokenVault = nil
        client = nil
        webSession = nil
        phase = .configurationError(configurationError.localizedDescription)
    }

    #if DEBUG
    private init(uiTesting: Bool) {
        configuration = nil
        oauth = nil
        tokenVault = nil
        client = nil
        webSession = nil
        phase = .signedIn
        sessions = [
            BeecodeSession(
                id: "ses_ui_1",
                title: "真机体验",
                status: .active,
                version: 1,
                createdAt: "2026-08-13T00:00:00.000Z",
                updatedAt: "2026-08-13T00:00:00.000Z"
            ),
        ]
    }
    #endif

    static func live() -> AppStore {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-signed-in") {
            return AppStore(uiTesting: true)
        }
        #endif
        do {
            let configuration = try AppConfiguration.live()
            let transport = URLSessionTransport.live()
            let oauth = OAuthHTTPClient(configuration: configuration, transport: transport)
            let tokenVault = TokenVault(store: KeychainCredentialStore(), oauth: oauth)
            let client = BeecodeClient(
                baseURL: configuration.apiBaseURL,
                transport: transport,
                tokenVault: tokenVault
            )
            return AppStore(
                configuration: configuration,
                oauth: oauth,
                tokenVault: tokenVault,
                client: client,
                webSession: OAuthWebSession()
            )
        } catch {
            return AppStore(configurationError: error)
        }
    }

    func restore() async {
        guard phase == .loading, let tokenVault else {
            return
        }
        do {
            phase = try await tokenVault.restore() ? .signedIn : .signedOut
            if phase == .signedIn {
                await loadSessions()
            }
        } catch {
            phase = .signedOut
            errorMessage = error.localizedDescription
        }
    }

    func signIn() async {
        guard let configuration, let oauth, let tokenVault, let webSession else {
            return
        }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let pkce = try PKCERequest.make()
            let authorizationURL = try oauth.authorizationURL(for: pkce)
            let callbackURL = try await webSession.authenticate(
                at: authorizationURL,
                callbackScheme: configuration.oauthCallbackScheme
            )
            let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false)
            let query = Dictionary(
                uniqueKeysWithValues: (components?.queryItems ?? []).map { ($0.name, $0.value ?? "") }
            )
            guard query["state"] == pkce.state else {
                throw OAuthError.stateMismatch
            }
            if query["error"] != nil {
                throw OAuthError.accessDenied
            }
            guard let code = query["code"], code.isEmpty == false else {
                throw OAuthError.invalidCallback
            }
            let tokens = try await oauth.exchange(code: code, verifier: pkce.verifier)
            try await tokenVault.install(tokens)
            phase = .signedIn
            await loadSessions()
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func signOut() async {
        isWorking = true
        await tokenVault?.logout()
        sessions = []
        selectedSessionID = nil
        phase = .signedOut
        isWorking = false
    }

    func loadSessions() async {
        guard let client else {
            return
        }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let page = try await client.listSessions()
            sessions = page.items.filter { $0.status == .active }
            if let selectedSessionID,
               sessions.contains(where: { $0.id == selectedSessionID }) == false {
                self.selectedSessionID = nil
            }
        } catch is CancellationError {
            return
        } catch BeecodeClientError.unauthenticated {
            await tokenVault?.logout()
            sessions = []
            phase = .signedOut
            errorMessage = BeecodeClientError.unauthenticated.localizedDescription
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func createSession() async {
        #if DEBUG
        if client == nil, phase == .signedIn {
            let session = BeecodeSession(
                id: "ses_ui_\(sessions.count + 1)",
                title: "新会话",
                status: .active,
                version: 1,
                createdAt: "2026-08-13T00:00:00.000Z",
                updatedAt: "2026-08-13T00:00:00.000Z"
            )
            sessions.insert(session, at: 0)
            selectedSessionID = session.id
            return
        }
        #endif
        guard let client else {
            return
        }
        await performSessionMutation {
            try await client.createSession()
        }
    }

    func beginRenaming(_ session: BeecodeSession) {
        sessionTitleDraft = session.title
        editingSession = session
    }

    func commitRename() async {
        guard let editingSession else {
            return
        }
        let title = sessionTitleDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard title.isEmpty == false else {
            errorMessage = String(localized: "error.empty-session-title")
            return
        }
        self.editingSession = nil
        #if DEBUG
        if client == nil, phase == .signedIn {
            replaceSession(
                BeecodeSession(
                    id: editingSession.id,
                    title: title,
                    status: editingSession.status,
                    version: editingSession.version + 1,
                    createdAt: editingSession.createdAt,
                    updatedAt: editingSession.updatedAt
                )
            )
            return
        }
        #endif
        guard let client else {
            return
        }
        await performSessionMutation {
            try await client.renameSession(editingSession, title: title)
        }
    }

    func archivePendingSession() async {
        guard let sessionPendingArchive else {
            return
        }
        self.sessionPendingArchive = nil
        #if DEBUG
        if client == nil, phase == .signedIn {
            sessions.removeAll { $0.id == sessionPendingArchive.id }
            if selectedSessionID == sessionPendingArchive.id {
                selectedSessionID = nil
            }
            return
        }
        #endif
        guard let client else {
            return
        }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            _ = try await client.archiveSession(sessionPendingArchive)
            sessions.removeAll { $0.id == sessionPendingArchive.id }
            if selectedSessionID == sessionPendingArchive.id {
                selectedSessionID = nil
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func performSessionMutation(
        _ operation: () async throws -> BeecodeSession
    ) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let session = try await operation()
            replaceSession(session)
            selectedSessionID = session.id
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func replaceSession(_ session: BeecodeSession) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        } else {
            sessions.insert(session, at: 0)
        }
    }
}
