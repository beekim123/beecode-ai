import SwiftUI

@main
@MainActor
struct BeecodeApp: App {
    @State private var store = AppStore.live()

    var body: some Scene {
        WindowGroup {
            RootView(store: store)
        }
    }
}
