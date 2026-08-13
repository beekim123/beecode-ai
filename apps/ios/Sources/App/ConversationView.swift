import SwiftUI

private struct ConversationObservationID: Equatable {
    let sessionID: String
    let generation: Int
}

struct ConversationView: View {
    @Bindable var store: AppStore
    let session: BeecodeSession

    private var observationID: ConversationObservationID {
        ConversationObservationID(
            sessionID: session.id,
            generation: store.conversationObservationGeneration
        )
    }

    var body: some View {
        Group {
            if let snapshot = store.conversation, snapshot.session.id == session.id {
                ConversationContentView(store: store, snapshot: snapshot)
            } else {
                ProgressView("conversation.loading")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("beecode.conversation.loading")
            }
        }
        .navigationTitle(session.title)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: observationID) {
            guard store.isSceneActive else { return }
            await store.observeConversation(sessionID: session.id)
        }
        .sheet(item: $store.selectedToolCall) { toolCall in
            ToolDetailView(toolCall: toolCall)
        }
    }
}

private struct ConversationContentView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var store: AppStore
    let snapshot: ConversationSnapshot

    private var scrollAnchorID: String {
        snapshot.messages.last?.id ?? "conversation.empty"
    }

    var body: some View {
        VStack(spacing: 0) {
            ConnectionNoticeView(state: store.conversationConnection)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        if snapshot.messages.isEmpty && snapshot.activeTurn == nil {
                            EmptyConversationView()
                                .id("conversation.empty")
                        } else {
                            ForEach(snapshot.messages) { message in
                                ConversationMessageView(
                                    message: message,
                                    isPending: message.id == store.pendingSubmission?.messageID,
                                    onSelectTool: { store.selectedToolCall = $0 }
                                )
                                .id(message.id)
                            }
                        }

                        if store.isSubmittingTurn || snapshot.activeTurn != nil {
                            ConversationActivityView(
                                turn: snapshot.activeTurn,
                                isSubmitting: store.isSubmittingTurn,
                                toolName: snapshot.latestToolCall?.name
                            )
                            .id("conversation.activity")
                        }

                        ForEach(snapshot.turns.filter { $0.status == .failed || $0.status == .cancelled }) { turn in
                            TurnNoticeView(turn: turn)
                                .id("turn-notice-\(turn.id)")
                        }

                        if let usage = snapshot.turns.last?.usage {
                            UsageView(usage: usage)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 20)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                }
                .accessibilityLabel("conversation.messages")
                .accessibilityIdentifier("beecode.session.detail")
                .onChange(of: snapshot.activityRevision) {
                    let target = snapshot.activeTurn == nil ? scrollAnchorID : "conversation.activity"
                    if reduceMotion {
                        proxy.scrollTo(target, anchor: .bottom)
                    } else {
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(target, anchor: .bottom)
                        }
                    }
                }
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ConversationComposer(store: store, snapshot: snapshot)
        }
    }
}

private struct EmptyConversationView: View {
    var body: some View {
        ContentUnavailableView(
            "conversation.empty-title",
            systemImage: "function",
            description: Text("conversation.empty-message")
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }
}

private struct ConversationMessageView: View {
    let message: ConversationMessage
    let isPending: Bool
    let onSelectTool: (BeecodeToolCall) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: roleIcon)
                .frame(width: 26, height: 26)
                .background(roleTint.opacity(0.12), in: .circle)
                .foregroundStyle(roleTint)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text(roleLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    if isPending {
                        ProgressView()
                            .controlSize(.mini)
                        Text("conversation.sending")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                ForEach(message.parts) { part in
                    switch part {
                    case .text(let textPart):
                        Text(markdown: textPart.text)
                            .font(.body)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    case .toolCall(let toolPart):
                        ToolActivityView(
                            toolCall: toolPart.toolCall,
                            onSelect: { onSelectTool(toolPart.toolCall) }
                        )
                    case .toolResult(let resultPart):
                        ToolResultView(result: resultPart.result)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var roleIcon: String {
        switch message.role {
        case .user: "person.fill"
        case .assistant: "sparkles"
        case .tool: "function"
        }
    }

    private var roleTint: Color {
        switch message.role {
        case .user: .blue
        case .assistant: .purple
        case .tool: .green
        }
    }

    private var roleLabel: LocalizedStringResource {
        switch message.role {
        case .user: "conversation.you"
        case .assistant: "conversation.assistant"
        case .tool: "conversation.tool-result"
        }
    }
}

private struct ToolActivityView: View {
    let toolCall: BeecodeToolCall
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                Image(systemName: statusIcon)
                    .foregroundStyle(statusTint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: toolCall.name)
                        .font(.callout.weight(.semibold))
                    Text(statusLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                if toolCall.status == .completed, let output = toolCall.output {
                    Text(verbatim: compact(output))
                        .font(.caption.monospaced())
                        .lineLimit(1)
                        .foregroundStyle(.secondary)
                }
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(12)
            .background(.secondary.opacity(0.08), in: .rect(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(toolCall.name), \(String(localized: statusLabel))")
        .accessibilityHint("tool.open-detail")
        .accessibilityIdentifier("beecode.tool.\(toolCall.name).\(toolCall.status.rawValue)")
    }

    private var statusIcon: String {
        switch toolCall.status {
        case .requested: "clock"
        case .running: "arrow.trianglehead.2.clockwise.rotate.90"
        case .completed: "checkmark.circle.fill"
        case .failed, .rejected: "exclamationmark.triangle.fill"
        }
    }

    private var statusTint: Color {
        switch toolCall.status {
        case .requested, .running: .orange
        case .completed: .green
        case .failed, .rejected: .red
        }
    }

    private var statusLabel: LocalizedStringResource {
        switch toolCall.status {
        case .requested: "tool.requested"
        case .running: "tool.running"
        case .completed: "tool.completed"
        case .failed: "tool.failed"
        case .rejected: "tool.rejected"
        }
    }

    private func compact(_ value: JSONValue) -> String {
        if case .object(let object) = value, let result = object["value"] {
            return result.displayText
        }
        return value.displayText.replacingOccurrences(of: "\n", with: " ")
    }
}

private struct ToolResultView: View {
    let result: BeecodeToolResult

    var body: some View {
        Group {
            if result.ok, let output = result.output {
                Text(verbatim: output.displayText)
            } else if let error = result.error {
                Text(verbatim: "\(error.code): \(error.message)")
            }
        }
        .font(.caption.monospaced())
        .textSelection(.enabled)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(result.ok ? Color.green.opacity(0.08) : Color.red.opacity(0.08), in: .rect(cornerRadius: 10))
        .accessibilityIdentifier("beecode.tool.result")
    }
}

private struct ConversationActivityView: View {
    let turn: ConversationTurn?
    let isSubmitting: Bool
    let toolName: String?

    var body: some View {
        HStack(spacing: 12) {
            ProgressView()
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.callout.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.leading, 36)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("beecode.conversation.activity")
    }

    private var title: LocalizedStringResource {
        if isSubmitting { return "activity.submitting" }
        switch turn?.status {
        case .queued: return "activity.queued"
        case .running: return "activity.running"
        case .modelStreaming: return "activity.streaming"
        case .toolRunning: return "activity.tool-running"
        default: return "activity.running"
        }
    }

    private var detail: String {
        if turn?.status == .toolRunning, let toolName {
            return String(localized: "activity.tool-name \(toolName)")
        }
        return String(localized: "activity.wait")
    }
}

private struct TurnNoticeView: View {
    let turn: ConversationTurn

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(turn.status == .cancelled ? "turn.cancelled" : "turn.failed")
                    .font(.callout.weight(.semibold))
                Text(verbatim: turn.error?.message ?? String(localized: "turn.confirmed-output-kept"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "exclamationmark.triangle")
        }
        .foregroundStyle(turn.status == .failed ? .red : .secondary)
        .accessibilityElement(children: .combine)
    }
}

private struct UsageView: View {
    let usage: ConversationUsage

    var body: some View {
        Text("usage.total \(usage.totalTokens)")
            .font(.caption2)
            .foregroundStyle(.tertiary)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

private struct ConversationComposer: View {
    @Bindable var store: AppStore
    let snapshot: ConversationSnapshot

    private var isConnected: Bool {
        store.conversationConnection == .connected
    }

    private var canSubmit: Bool {
        store.conversationDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            && isConnected
            && snapshot.activeTurn == nil
            && store.isSubmittingTurn == false
    }

    var body: some View {
        VStack(spacing: 8) {
            if store.pendingSubmission != nil && store.isSubmittingTurn == false {
                Button("conversation.retry-pending") {
                    Task { await store.retryPendingSubmission() }
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("beecode.conversation.retry")
            }

            HStack(alignment: .bottom, spacing: 10) {
                TextField(
                    isConnected ? "conversation.placeholder" : "conversation.waiting-placeholder",
                    text: $store.conversationDraft,
                    axis: .vertical
                )
                .lineLimit(1...6)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 11)
                .background(.secondary.opacity(0.1), in: .rect(cornerRadius: 18))
                .disabled(isConnected == false || snapshot.activeTurn != nil)
                .accessibilityLabel("conversation.composer-label")
                .accessibilityIdentifier("beecode.conversation.composer")
                .submitLabel(.send)
                .onSubmit {
                    guard canSubmit else { return }
                    Task { await store.submitConversationDraft() }
                }

                if snapshot.activeTurn != nil {
                    Button {
                        Task { await store.cancelActiveTurn() }
                    } label: {
                        Image(systemName: "stop.fill")
                            .frame(width: 40, height: 40)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.red)
                    .accessibilityLabel("conversation.stop")
                    .accessibilityIdentifier("beecode.conversation.stop")
                } else {
                    Button {
                        Task { await store.submitConversationDraft() }
                    } label: {
                        if store.isSubmittingTurn {
                            ProgressView()
                                .frame(width: 40, height: 40)
                        } else {
                            Image(systemName: "arrow.up")
                                .font(.body.weight(.bold))
                                .frame(width: 40, height: 40)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .clipShape(.circle)
                    .disabled(canSubmit == false)
                    .accessibilityLabel("conversation.send")
                    .accessibilityIdentifier("beecode.conversation.send")
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .background(.bar)
    }
}

private struct ConnectionNoticeView: View {
    let state: ConversationConnectionState

    var body: some View {
        if state != .connected {
            Label(label, systemImage: icon)
                .font(.caption)
                .foregroundStyle(state == .unauthenticated || state == .unavailable ? .red : .secondary)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(.thinMaterial)
                .accessibilityIdentifier("beecode.connection.\(state.rawValue)")
        }
    }

    private var label: LocalizedStringResource {
        switch state {
        case .disconnected: "connection.disconnected"
        case .connecting: "connection.connecting"
        case .recovering: "connection.recovering"
        case .connected: "connection.connected"
        case .reconnecting: "connection.reconnecting"
        case .unauthenticated: "connection.unauthenticated"
        case .unavailable: "connection.unavailable"
        }
    }

    private var icon: String {
        switch state {
        case .unauthenticated: "person.crop.circle.badge.exclamationmark"
        case .unavailable: "exclamationmark.triangle"
        case .connected: "wifi"
        default: "wifi.exclamationmark"
        }
    }
}

private struct ToolDetailView: View {
    @Environment(\.dismiss) private var dismiss
    let toolCall: BeecodeToolCall

    var body: some View {
        NavigationStack {
            List {
                Section("tool.status") {
                    Text(statusLabel)
                }
                Section("tool.input") {
                    Text(verbatim: toolCall.input.displayText)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                }
                Section(toolCall.error == nil ? "tool.output" : "tool.error") {
                    Text(verbatim: toolCall.error.map { "\($0.code): \($0.message)" }
                        ?? toolCall.output?.displayText
                        ?? "null")
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                }
            }
            .navigationTitle(toolCall.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.done") { dismiss() }
                }
            }
        }
    }

    private var statusLabel: LocalizedStringResource {
        switch toolCall.status {
        case .requested: "tool.requested"
        case .running: "tool.running"
        case .completed: "tool.completed"
        case .failed: "tool.failed"
        case .rejected: "tool.rejected"
        }
    }
}

private extension Text {
    init(markdown: String) {
        if let attributed = try? AttributedString(markdown: markdown) {
            self.init(attributed)
        } else {
            self.init(verbatim: markdown)
        }
    }
}
