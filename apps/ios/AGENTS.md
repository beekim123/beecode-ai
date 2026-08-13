# iOS Agent Rules

This file adds iOS-specific rules to the repository root `AGENTS.md`. Do not duplicate or relax root rules here.

## Context

- Read `docs/development/phase-3-ios-development-design.md` before iOS architecture or implementation work.
- Follow `docs/development/platform-development-guidelines.md` when iOS work affects shared protocol, OpenAPI, Backend, authentication, events, or another client.
- The committed Xcode project uses the shared `Beecode` scheme, Swift 6 language mode, complete strict concurrency checking, and iOS 17.0 as its minimum deployment target.

## Boundaries

- Build a native SwiftUI iPhone/iPad application using Swift 6 strict concurrency; do not use a WebView for the primary experience.
- The Agent Runtime and tools run in the Backend. The App owns UI state projection, OAuth/PKCE, Keychain credentials, JSON requests, SSE consumption, and lifecycle recovery.
- Use the generated OpenAPI client for ordinary JSON contracts and a stable handwritten wrapper for authentication, retries, and SSE behavior. Do not hand-edit generated code.
- iOS data uses `surface = ios`; do not connect to Web routes, reuse browser Cookies, or allow request data to choose another surface.
- Keep production code under `apps/ios/Sources/`, generated code under `apps/ios/Sources/Generated/`, and tests under `apps/ios/tests/`.

## Skill Routing

- Load `swiftui-expert-skill` for SwiftUI views, navigation, Observation state flow, accessibility, localization, animation, or UI performance.
- Load `ios-networking` for REST, SSE, OAuth requests, uploads/downloads, retries, pagination, reachability, caching, or network tests.
- Load `swift-concurrency` for async/await, Actor isolation, Sendable correctness, AsyncSequence, cancellation, data races, or Swift 6 concurrency diagnostics.
- Load `swift-testing-pro` only when writing or reviewing Swift Testing unit/integration tests.
- Combine only the skills required by the task. A static SwiftUI view does not require networking or testing skills by default.

## Verification

Run commands from the repository root. A build that only needs the Simulator SDK and does not require a running device uses:

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Run unit and UI tests in an environment with CoreSimulatorService access, replacing the destination with an installed Simulator when needed:

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath apps/ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  test
```

The minimum required checks are:

- Build the Debug application for an available iOS Simulator.
- Run Swift Testing unit and integration tests from `apps/ios/tests/`.
- Run the relevant XCUITest flow for user-visible workflow changes.
- Run Backend/protocol tests when OpenAPI, OAuth, SSE, surface isolation, or Runtime behavior changes.

Do not claim iOS verification until the exact commands have been run in an environment with access to CoreSimulatorService.

## Prohibitions

- Do not store tokens in `UserDefaults`, source files, logs, crash metadata, fixtures, or ordinary files; use Keychain.
- Do not call model providers or expose provider credentials from the App.
- Do not parse SSE or construct Authorization headers in SwiftUI Views.
- Do not let client state override a newer authoritative snapshot or invent terminal Turn/ToolCall states.
- Do not add test files under `Sources/`.
