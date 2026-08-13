import SwiftUI

struct RootView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Bindable var store: AppStore

    var body: some View {
        Group {
            switch store.phase {
            case .loading:
                ProgressView()
                    .accessibilityIdentifier("beecode.auth.loading")
            case .signedOut:
                AuthenticationView(store: store)
            case .signedIn:
                SessionShellView(store: store)
            case .configurationError(let message):
                ContentUnavailableView(
                    "configuration.title",
                    systemImage: "wrench.and.screwdriver",
                    description: Text(message)
                )
            }
        }
        .task {
            await store.restore()
        }
        .onChange(of: scenePhase) {
            Task {
                await store.setSceneActive(scenePhase == .active)
            }
        }
        .alert(
            "error.title",
            isPresented: Binding(
                get: { store.errorMessage != nil },
                set: { if $0 == false { store.errorMessage = nil } }
            )
        ) {
            Button("action.ok") {
                store.errorMessage = nil
            }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }
}

private struct AuthenticationView: View {
    let store: AppStore

    var body: some View {
        VStack(spacing: 28) {
            Spacer()
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 48, weight: .semibold))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(spacing: 8) {
                Text(verbatim: AppMetadata.current.productName)
                    .font(.largeTitle.bold())
                    .accessibilityAddTraits(.isHeader)
                Text("auth.subtitle")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Spacer()
            Button {
                Task { await store.signIn() }
            } label: {
                Label("auth.sign-in", systemImage: "person.crop.circle.badge.checkmark")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(store.isWorking)
            .accessibilityIdentifier("beecode.auth.sign-in")
        }
        .padding(24)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .overlay {
            if store.isWorking {
                ProgressView()
            }
        }
    }
}

private struct SessionShellView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    let store: AppStore

    var body: some View {
        Group {
            if horizontalSizeClass == .regular {
                NavigationSplitView {
                    SessionListView(store: store, usesSelection: true)
                } detail: {
                    SessionDetailView(store: store, session: store.selectedSession)
                }
            } else {
                NavigationStack {
                    SessionListView(store: store, usesSelection: false)
                        .navigationDestination(for: BeecodeSession.self) { session in
                            SessionDetailView(store: store, session: session)
                        }
                }
            }
        }
        .sheet(item: Binding(
            get: { store.editingSession },
            set: { store.editingSession = $0 }
        )) { _ in
            RenameSessionView(store: store)
        }
        .confirmationDialog(
            "session.archive-title",
            isPresented: Binding(
                get: { store.sessionPendingArchive != nil },
                set: { if $0 == false { store.sessionPendingArchive = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("session.archive", role: .destructive) {
                Task { await store.archivePendingSession() }
            }
            Button("action.cancel", role: .cancel) {
                store.sessionPendingArchive = nil
            }
        } message: {
            Text("session.archive-message")
        }
    }
}

private struct SessionListView: View {
    let store: AppStore
    let usesSelection: Bool

    var body: some View {
        Group {
            if store.sessions.isEmpty && store.isWorking == false {
                ContentUnavailableView(
                    "session.empty-title",
                    systemImage: "bubble.left",
                    description: Text("session.empty-message")
                )
            } else if usesSelection {
                List(selection: Binding(
                    get: { store.selectedSessionID },
                    set: { store.selectedSessionID = $0 }
                )) {
                    rows
                }
            } else {
                List {
                    rows
                }
            }
        }
        .navigationTitle("session.title")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await store.createSession() }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel("session.create")
                .accessibilityIdentifier("beecode.session.create")
                .disabled(store.isWorking)
            }
            ToolbarItem(placement: .topBarLeading) {
                Menu {
                    Button {
                        Task { await store.loadSessions() }
                    } label: {
                        Label("action.refresh", systemImage: "arrow.clockwise")
                    }
                    Button(role: .destructive) {
                        Task { await store.signOut() }
                    } label: {
                        Label("auth.sign-out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                } label: {
                    Image(systemName: "person.crop.circle")
                }
                .accessibilityLabel("account.menu")
            }
        }
        .refreshable {
            await store.loadSessions()
        }
        .overlay(alignment: .top) {
            if store.isWorking {
                ProgressView()
                    .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private var rows: some View {
        ForEach(store.sessions) { session in
            if usesSelection {
                SessionRow(session: session)
                    .tag(session.id)
                    .contextMenu { actions(for: session) }
            } else {
                NavigationLink(value: session) {
                    SessionRow(session: session)
                }
                .contextMenu { actions(for: session) }
            }
        }
    }

    @ViewBuilder
    private func actions(for session: BeecodeSession) -> some View {
        Button {
            store.beginRenaming(session)
        } label: {
            Label("session.rename", systemImage: "pencil")
        }
        Button(role: .destructive) {
            store.sessionPendingArchive = session
        } label: {
            Label("session.archive", systemImage: "archivebox")
        }
    }
}

private struct SessionRow: View {
    let session: BeecodeSession

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(session.title)
                .font(.body.weight(.medium))
                .lineLimit(2)
            Text("session.ready")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("beecode.session.\(session.id)")
    }
}

private struct SessionDetailView: View {
    let store: AppStore
    let session: BeecodeSession?

    var body: some View {
        if let session {
            ConversationView(store: store, session: session)
        } else {
            ContentUnavailableView("session.select", systemImage: "sidebar.left")
        }
    }
}

private struct RenameSessionView: View {
    @Environment(\.dismiss) private var dismiss
    @FocusState private var titleIsFocused: Bool
    @Bindable var store: AppStore

    var body: some View {
        NavigationStack {
            Form {
                TextField("session.name", text: $store.sessionTitleDraft)
                    .focused($titleIsFocused)
                    .submitLabel(.done)
                    .onSubmit { save() }
            }
            .navigationTitle("session.rename")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("action.cancel") {
                        store.editingSession = nil
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("action.save") { save() }
                        .disabled(store.sessionTitleDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .task { titleIsFocused = true }
        }
    }

    private func save() {
        Task {
            await store.commitRename()
            dismiss()
        }
    }
}

#Preview("Signed out") {
    RootView(store: AppStore.live())
}
