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
                ConversationLoadingView()
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

private struct ConversationLoadingView: View {
    var body: some View {
        ZStack {
            BeecodeAmbientBackground()
            VStack(spacing: 16) {
                BeecodeMark(size: 48)
                ProgressView()
                    .tint(BeecodeVisual.accent)
                Text("conversation.loading")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("beecode.conversation.loading")
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
        ZStack {
            BeecodeAmbientBackground()

            VStack(spacing: 0) {
                ConnectionNoticeView(state: store.conversationConnection)
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 24) {
                            if snapshot.messages.isEmpty && snapshot.activeTurn == nil {
                                EmptyConversationView { suggestion in
                                    store.conversationDraft = suggestion
                                }
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
                        .padding(.top, 26)
                        .padding(.bottom, 30)
                        .frame(maxWidth: 780)
                        .frame(maxWidth: .infinity)
                    }
                    .scrollDismissesKeyboard(.interactively)
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
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            ConversationComposer(store: store, snapshot: snapshot)
        }
    }
}

private struct EmptyConversationView: View {
    private struct Suggestion: Identifiable {
        let id: String
        let text: LocalizedStringResource
    }

    let onSuggestion: (String) -> Void

    private let suggestions = [
        Suggestion(id: "calculate", text: "conversation.suggestion.calculate"),
        Suggestion(id: "explain", text: "conversation.suggestion.explain"),
        Suggestion(id: "plan", text: "conversation.suggestion.plan"),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            BeecodeMark(size: 56)

            VStack(alignment: .leading, spacing: 8) {
                Text("conversation.empty-title")
                    .font(.title.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("conversation.empty-message")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            VStack(spacing: 10) {
                ForEach(suggestions) { suggestion in
                    SuggestionButton(suggestion: suggestion.text, onSelect: onSuggestion)
                }
            }
        }
        .frame(maxWidth: 560, alignment: .leading)
        .frame(maxWidth: .infinity, minHeight: 380, alignment: .center)
        .padding(.vertical, 28)
    }
}

private struct SuggestionButton: View {
    @Environment(\.colorScheme) private var colorScheme
    let suggestion: LocalizedStringResource
    let onSelect: (String) -> Void

    var body: some View {
        Button {
            onSelect(String(localized: suggestion))
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "arrow.up.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BeecodeVisual.accent)
                    .frame(width: 28, height: 28)
                    .background(
                        BeecodeVisual.accent.opacity(0.1),
                        in: .rect(cornerRadius: 9, style: .continuous)
                    )
                Text(suggestion)
                    .font(.callout.weight(.medium))
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(12)
            .background(
                BeecodeVisual.surface(for: colorScheme).opacity(0.86),
                in: .rect(cornerRadius: 15, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .stroke(BeecodeVisual.border(for: colorScheme), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct ConversationMessageView: View {
    let message: ConversationMessage
    let isPending: Bool
    let onSelectTool: (BeecodeToolCall) -> Void

    var body: some View {
        switch message.role {
        case .user:
            UserMessageView(message: message, isPending: isPending, onSelectTool: onSelectTool)
        case .assistant:
            AssistantMessageView(message: message, onSelectTool: onSelectTool)
        case .tool:
            ToolMessageView(message: message, onSelectTool: onSelectTool)
        }
    }
}

private struct UserMessageView: View {
    @Environment(\.colorScheme) private var colorScheme
    let message: ConversationMessage
    let isPending: Bool
    let onSelectTool: (BeecodeToolCall) -> Void

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Spacer(minLength: 42)
            VStack(alignment: .trailing, spacing: 6) {
                ConversationPartsView(message: message, onSelectTool: onSelectTool)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 11)
                    .background(
                        BeecodeVisual.userBubble(for: colorScheme),
                        in: .rect(
                            topLeadingRadius: 18,
                            bottomLeadingRadius: 18,
                            bottomTrailingRadius: 5,
                            topTrailingRadius: 18
                        )
                    )

                if isPending {
                    Label("conversation.sending", systemImage: "clock")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            .frame(maxWidth: 590, alignment: .trailing)
        }
        .accessibilityElement(children: .contain)
    }
}

private struct AssistantMessageView: View {
    let message: ConversationMessage
    let onSelectTool: (BeecodeToolCall) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            BeecodeMark(size: 32)

            VStack(alignment: .leading, spacing: 10) {
                Text("conversation.assistant")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ConversationPartsView(message: message, onSelectTool: onSelectTool)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

private struct ToolMessageView: View {
    let message: ConversationMessage
    let onSelectTool: (BeecodeToolCall) -> Void

    var body: some View {
        ConversationPartsView(message: message, onSelectTool: onSelectTool)
            .padding(.leading, 44)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
    }
}

private struct ConversationPartsView: View {
    let message: ConversationMessage
    let onSelectTool: (BeecodeToolCall) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(message.parts) { part in
                switch part {
                case .text(let textPart):
                    Text(markdown: textPart.text)
                        .font(.body)
                        .lineSpacing(3)
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
    }
}

private struct ToolActivityView: View {
    @Environment(\.colorScheme) private var colorScheme
    let toolCall: BeecodeToolCall
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(statusTint.opacity(0.12))
                    Image(systemName: statusIcon)
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(statusTint)
                }
                .frame(width: 38, height: 38)

                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: toolCall.name)
                        .font(.callout.weight(.semibold))
                    Text(statusLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer(minLength: 8)

                if toolCall.status == .completed, let output = toolCall.output {
                    Text(verbatim: compact(output))
                        .font(.caption.monospaced().weight(.medium))
                        .lineLimit(1)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(
                            BeecodeVisual.mutedSurface(for: colorScheme),
                            in: .rect(cornerRadius: 8, style: .continuous)
                        )
                }

                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(11)
            .beecodeSurface(cornerRadius: 15)
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
        case .completed: "checkmark"
        case .failed, .rejected: "exclamationmark"
        }
    }

    private var statusTint: Color {
        switch toolCall.status {
        case .requested, .running: BeecodeVisual.accentSecondary
        case .completed: BeecodeVisual.success
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
    @Environment(\.colorScheme) private var colorScheme
    let result: BeecodeToolResult

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                Image(systemName: result.ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                Text(result.ok ? "tool.output" : "tool.error")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(result.ok ? BeecodeVisual.success : .red)

            if result.ok, let output = result.output {
                Text(verbatim: output.displayText)
            } else if let error = result.error {
                Text(verbatim: "\(error.code): \(error.message)")
            }
        }
        .font(.caption.monospaced())
        .foregroundStyle(Color.white.opacity(0.88))
        .textSelection(.enabled)
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            BeecodeVisual.codeSurface(for: colorScheme),
            in: .rect(cornerRadius: 13, style: .continuous)
        )
        .overlay(alignment: .leading) {
            Capsule()
                .fill(result.ok ? BeecodeVisual.success : Color.red)
                .frame(width: 3)
                .padding(.vertical, 10)
        }
        .accessibilityIdentifier("beecode.tool.result")
    }
}

private struct ConversationActivityView: View {
    let turn: ConversationTurn?
    let isSubmitting: Bool
    let toolName: String?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            BeecodeMark(size: 32)

            HStack(spacing: 12) {
                ProgressView()
                    .tint(BeecodeVisual.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.callout.weight(.semibold))
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .beecodeSurface(cornerRadius: 15)
        }
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
    @Environment(\.colorScheme) private var colorScheme
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
            Image(systemName: turn.status == .failed ? "exclamationmark.triangle.fill" : "stop.circle")
        }
        .foregroundStyle(turn.status == .failed ? .red : .secondary)
        .padding(12)
        .background(
            (turn.status == .failed ? Color.red : BeecodeVisual.mutedSurface(for: colorScheme)).opacity(0.1),
            in: .rect(cornerRadius: 13, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

private struct UsageView: View {
    @Environment(\.colorScheme) private var colorScheme
    let usage: ConversationUsage

    var body: some View {
        Text("usage.total \(usage.totalTokens)")
            .font(.caption2.monospaced())
            .foregroundStyle(.secondary)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(
                BeecodeVisual.mutedSurface(for: colorScheme),
                in: .capsule
            )
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

private struct ConversationComposer: View {
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var isFocused: Bool
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
                Button {
                    Task { await store.retryPendingSubmission() }
                } label: {
                    Label("conversation.retry-pending", systemImage: "arrow.clockwise")
                        .font(.caption.weight(.semibold))
                        .padding(.horizontal, 11)
                        .padding(.vertical, 7)
                        .beecodeSurface(cornerRadius: 12)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("beecode.conversation.retry")
            }

            VStack(spacing: 7) {
                TextField(
                    isConnected ? "conversation.placeholder" : "conversation.waiting-placeholder",
                    text: $store.conversationDraft,
                    axis: .vertical
                )
                .focused($isFocused)
                .lineLimit(1...6)
                .textFieldStyle(.plain)
                .padding(.horizontal, 5)
                .padding(.top, 4)
                .disabled(isConnected == false || snapshot.activeTurn != nil)
                .accessibilityLabel("conversation.composer-label")
                .accessibilityIdentifier("beecode.conversation.composer")
                .submitLabel(.send)
                .onSubmit {
                    guard canSubmit else { return }
                    Task { await store.submitConversationDraft() }
                }

                HStack(spacing: 8) {
                    Label("conversation.mode", systemImage: "sparkles")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(BeecodeVisual.accent)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 6)
                        .background(
                            BeecodeVisual.accent.opacity(0.09),
                            in: .capsule
                        )

                    Spacer(minLength: 4)

                    if snapshot.activeTurn != nil {
                        Button {
                            Task { await store.cancelActiveTurn() }
                        } label: {
                            Image(systemName: "stop.fill")
                                .font(.caption.weight(.bold))
                                .foregroundStyle(.white)
                                .frame(width: 38, height: 38)
                                .background(Color.red, in: .circle)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("conversation.stop")
                        .accessibilityIdentifier("beecode.conversation.stop")
                    } else {
                        Button {
                            Task { await store.submitConversationDraft() }
                        } label: {
                            Group {
                                if store.isSubmittingTurn {
                                    ProgressView()
                                        .tint(.white)
                                } else {
                                    Image(systemName: "arrow.up")
                                        .font(.body.weight(.bold))
                                }
                            }
                            .foregroundStyle(.white)
                            .frame(width: 38, height: 38)
                            .background {
                                Circle()
                                    .fill(canSubmit ? AnyShapeStyle(BeecodeVisual.accentGradient) : AnyShapeStyle(.quaternary))
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(canSubmit == false)
                        .accessibilityLabel("conversation.send")
                        .accessibilityIdentifier("beecode.conversation.send")
                    }
                }
            }
            .padding(10)
            .beecodeSurface(cornerRadius: 20, castsShadow: true)

            Text("conversation.disclaimer")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 7)
        .frame(maxWidth: 804)
        .frame(maxWidth: .infinity)
        .background {
            LinearGradient(
                colors: [
                    BeecodeVisual.canvas(for: colorScheme).opacity(0),
                    BeecodeVisual.canvas(for: colorScheme).opacity(0.97),
                ],
                startPoint: .top,
                endPoint: .center
            )
            .ignoresSafeArea()
        }
    }
}

private struct ConnectionNoticeView: View {
    let state: ConversationConnectionState

    var body: some View {
        if state != .connected {
            HStack {
                Label(label, systemImage: icon)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(isError ? Color.red : BeecodeVisual.accent)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 7)
                    .beecodeSurface(cornerRadius: 12)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 8)
            .padding(.horizontal, 12)
            .accessibilityIdentifier("beecode.connection.\(state.rawValue)")
        }
    }

    private var isError: Bool {
        state == .unauthenticated || state == .unavailable
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
            ZStack {
                BeecodeAmbientBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ToolDetailHeader(toolCall: toolCall, statusLabel: statusLabel)
                        ToolDetailSection(title: "tool.input", value: toolCall.input.displayText)
                        ToolDetailSection(
                            title: toolCall.error == nil ? "tool.output" : "tool.error",
                            value: toolCall.error.map { "\($0.code): \($0.message)" }
                                ?? toolCall.output?.displayText
                                ?? "null"
                        )
                    }
                    .padding(16)
                    .frame(maxWidth: 700)
                    .frame(maxWidth: .infinity)
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

private struct ToolDetailHeader: View {
    let toolCall: BeecodeToolCall
    let statusLabel: LocalizedStringResource

    var body: some View {
        HStack(spacing: 13) {
            Image(systemName: "wrench.and.screwdriver.fill")
                .foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(BeecodeVisual.accentGradient, in: .rect(cornerRadius: 12, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(verbatim: toolCall.name)
                    .font(.headline)
                Text(statusLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .beecodeSurface(cornerRadius: 17)
    }
}

private struct ToolDetailSection: View {
    @Environment(\.colorScheme) private var colorScheme
    let title: LocalizedStringResource
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(verbatim: value)
                .font(.body.monospaced())
                .foregroundStyle(Color.white.opacity(0.9))
                .textSelection(.enabled)
                .padding(13)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    BeecodeVisual.codeSurface(for: colorScheme),
                    in: .rect(cornerRadius: 13, style: .continuous)
                )
        }
        .padding(14)
        .beecodeSurface(cornerRadius: 17)
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
