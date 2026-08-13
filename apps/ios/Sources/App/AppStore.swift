import Foundation
import Observation

@MainActor
@Observable
final class AppStore {
    struct PendingSubmission: Equatable, Sendable {
        let messageID: String
        let sessionID: String
        let text: String
        let idempotencyKey: String
        let createdAt: String
    }

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
    private let eventStream: SessionEventStream?
    private let webSession: OAuthWebSession?

    var phase: Phase
    var sessions: [BeecodeSession] = []
    var selectedSessionID: String?
    var isWorking = false
    var errorMessage: String?
    var editingSession: BeecodeSession?
    var sessionTitleDraft = ""
    var sessionPendingArchive: BeecodeSession?
    var conversation: ConversationSnapshot?
    var conversationConnection: ConversationConnectionState = .disconnected
    var conversationDraft = ""
    var isSubmittingTurn = false
    var pendingSubmission: PendingSubmission?
    var selectedToolCall: BeecodeToolCall?
    var isSceneActive = true
    var conversationObservationGeneration = 0

    var selectedSession: BeecodeSession? {
        sessions.first { $0.id == selectedSessionID }
    }

    init(
        configuration: AppConfiguration,
        oauth: OAuthHTTPClient,
        tokenVault: TokenVault,
        client: BeecodeClient,
        eventStream: SessionEventStream,
        webSession: OAuthWebSession
    ) {
        self.configuration = configuration
        self.oauth = oauth
        self.tokenVault = tokenVault
        self.client = client
        self.eventStream = eventStream
        self.webSession = webSession
        self.phase = .loading
    }

    private init(configurationError: Error) {
        configuration = nil
        oauth = nil
        tokenVault = nil
        client = nil
        eventStream = nil
        webSession = nil
        phase = .configurationError(configurationError.localizedDescription)
    }

    #if DEBUG
    private init(uiTesting: Bool) {
        configuration = nil
        oauth = nil
        tokenVault = nil
        client = nil
        eventStream = nil
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
            let eventStream = SessionEventStream(
                baseURL: configuration.apiBaseURL,
                transport: transport,
                tokenVault: tokenVault,
                client: client
            )
            return AppStore(
                configuration: configuration,
                oauth: oauth,
                tokenVault: tokenVault,
                client: client,
                eventStream: eventStream,
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
        await eventStream?.invalidate()
        await tokenVault?.logout()
        sessions = []
        selectedSessionID = nil
        clearConversation()
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
                clearConversation()
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
                clearConversation()
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

    func observeConversation(sessionID: String) async {
        selectedSessionID = sessionID
        selectedToolCall = nil
        if conversation?.session.id != sessionID {
            conversation = nil
            pendingSubmission = nil
        }

        #if DEBUG
        if eventStream == nil, phase == .signedIn {
            conversationConnection = .connected
            conversation = Self.uiTestingConversation(sessionID: sessionID, sessions: sessions)
            return
        }
        #endif

        guard let eventStream else { return }
        do {
            let updates = await eventStream.updates(for: sessionID)
            for try await update in updates {
                try Task.checkCancellation()
                guard selectedSessionID == sessionID else { return }
                switch update {
                case .connection(let state):
                    conversationConnection = state
                case .snapshot(let snapshot):
                    conversation = restoringPendingSubmission(in: snapshot)
                    if let updatedSession = conversation?.session {
                        replaceSession(updatedSession)
                    }
                }
            }
        } catch is CancellationError {
            return
        } catch BeecodeClientError.unauthenticated {
            await tokenVault?.logout()
            clearConversation()
            sessions = []
            phase = .signedOut
            errorMessage = BeecodeClientError.unauthenticated.localizedDescription
        } catch BeecodeClientError.product(let status, let error)
            where status == 404 || error.code == "SESSION_NOT_FOUND" {
            conversationConnection = .unavailable
            errorMessage = error.message
        } catch {
            if selectedSessionID == sessionID {
                conversationConnection = .reconnecting
                errorMessage = error.localizedDescription
            }
        }
    }

    func suspendConversation() async {
        await eventStream?.invalidate()
        if conversationConnection != .unauthenticated && conversationConnection != .unavailable {
            conversationConnection = .disconnected
        }
    }

    func setSceneActive(_ active: Bool) async {
        guard isSceneActive != active else { return }
        isSceneActive = active
        conversationObservationGeneration += 1
        if active == false {
            await suspendConversation()
        }
    }

    func submitConversationDraft() async {
        if pendingSubmission != nil {
            await retryPendingSubmission()
            return
        }
        guard let conversation else { return }
        let text = conversationDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.isEmpty == false,
              conversation.activeTurn == nil,
              conversationConnection == .connected,
              isSubmittingTurn == false else {
            return
        }
        let idempotencyKey = UUID().uuidString.lowercased()
        let submission = PendingSubmission(
            messageID: "pending_\(idempotencyKey)",
            sessionID: conversation.session.id,
            text: text,
            idempotencyKey: idempotencyKey,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )
        pendingSubmission = submission
        self.conversation = SessionReducer.appendingOptimisticMessage(
            to: conversation,
            id: submission.messageID,
            text: submission.text,
            createdAt: submission.createdAt
        )
        conversationDraft = ""
        await send(submission)
    }

    func retryPendingSubmission() async {
        guard let pendingSubmission, isSubmittingTurn == false else { return }
        await send(pendingSubmission)
    }

    func cancelActiveTurn() async {
        guard let client,
              let conversation,
              let turn = conversation.activeTurn else {
            return
        }
        do {
            try await client.cancelTurn(sessionId: conversation.session.id, turnId: turn.id)
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func send(_ submission: PendingSubmission) async {
        #if DEBUG
        if client == nil, phase == .signedIn {
            isSubmittingTurn = true
            defer { isSubmittingTurn = false }
            guard let current = conversation else { return }
            conversation = Self.uiTestingCompletedConversation(
                current: current,
                submission: submission
            )
            pendingSubmission = nil
            return
        }
        #endif

        guard let client, var current = conversation else { return }
        isSubmittingTurn = true
        errorMessage = nil
        defer { isSubmittingTurn = false }
        do {
            let turn = try await client.submitTurn(
                sessionId: submission.sessionID,
                text: submission.text,
                idempotencyKey: submission.idempotencyKey
            )
            guard conversation?.session.id == submission.sessionID else { return }
            current = conversation ?? current
            conversation = SessionReducer.reconcilingAcceptedTurn(
                in: current,
                turn: turn,
                optimisticMessageId: submission.messageID,
                text: submission.text,
                createdAt: submission.createdAt
            )
            pendingSubmission = nil
        } catch is CancellationError {
            return
        } catch BeecodeClientError.product(_, let productError) {
            discard(submission)
            errorMessage = productError.message
        } catch BeecodeClientError.unauthenticated {
            discard(submission)
            await tokenVault?.logout()
            sessions = []
            clearConversation()
            phase = .signedOut
            errorMessage = BeecodeClientError.unauthenticated.localizedDescription
        } catch {
            // The server may have accepted the request. Retain the same key for an idempotent retry.
            errorMessage = error.localizedDescription
        }
    }

    private func discard(_ submission: PendingSubmission) {
        if let conversation {
            self.conversation = SessionReducer.discardingOptimisticMessage(
                from: conversation,
                id: submission.messageID
            )
        }
        conversationDraft = submission.text
        pendingSubmission = nil
    }

    private func restoringPendingSubmission(
        in snapshot: ConversationSnapshot
    ) -> ConversationSnapshot {
        guard let pendingSubmission,
              pendingSubmission.sessionID == snapshot.session.id else {
            return snapshot
        }
        return SessionReducer.appendingOptimisticMessage(
            to: snapshot,
            id: pendingSubmission.messageID,
            text: pendingSubmission.text,
            createdAt: pendingSubmission.createdAt
        )
    }

    private func clearConversation() {
        conversation = nil
        conversationConnection = .disconnected
        conversationDraft = ""
        isSubmittingTurn = false
        pendingSubmission = nil
        selectedToolCall = nil
    }

    #if DEBUG
    private static func uiTestingConversation(
        sessionID: String,
        sessions: [BeecodeSession]
    ) -> ConversationSnapshot? {
        guard let session = sessions.first(where: { $0.id == sessionID }) else { return nil }
        return ConversationSnapshot(session: session, messages: [], turns: [])
    }

    private static func uiTestingCompletedConversation(
        current: ConversationSnapshot,
        submission: PendingSubmission
    ) -> ConversationSnapshot {
        let turnID = "turn_ui_1"
        let userMessage = ConversationMessage(
            id: "msg_ui_user",
            sessionId: current.session.id,
            turnId: turnID,
            role: .user,
            parts: [.text(ConversationTextPart(id: "part_ui_user", text: submission.text))],
            createdAt: submission.createdAt
        )
        let toolCall = BeecodeToolCall(
            id: "tool_ui_calculator",
            name: "calculator",
            input: .object(["expression": .string("1+1")]),
            status: .completed,
            output: .object(["value": .number(2)])
        )
        let assistantMessage = ConversationMessage(
            id: "msg_ui_assistant",
            sessionId: current.session.id,
            turnId: turnID,
            role: .assistant,
            parts: [
                .toolCall(ConversationToolCallPart(id: "part_ui_tool", toolCall: toolCall)),
                .text(ConversationTextPart(id: "part_ui_answer", text: "1+1 = 2")),
            ],
            createdAt: submission.createdAt
        )
        let toolMessage = ConversationMessage(
            id: "msg_ui_tool",
            sessionId: current.session.id,
            turnId: turnID,
            role: .tool,
            parts: [
                .toolResult(
                    ConversationToolResultPart(
                        id: "part_ui_result",
                        toolCallId: toolCall.id,
                        result: BeecodeToolResult(ok: true, output: toolCall.output, error: nil)
                    )
                ),
            ],
            createdAt: submission.createdAt
        )
        let turn = ConversationTurn(
            id: turnID,
            sessionId: current.session.id,
            index: 1,
            status: .completed,
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id,
            usage: ConversationUsage(inputTokens: 12, outputTokens: 8, totalTokens: 20),
            finishedAt: submission.createdAt
        )
        return ConversationSnapshot(
            session: current.session,
            messages: [userMessage, assistantMessage, toolMessage],
            turns: [turn],
            live: ConversationLiveState(sequence: 5)
        )
    }
    #endif
}
