import Foundation
import Testing
@testable import Beecode

struct TokenVaultTests {
    @Test
    func restoreLoadsPersistedRefreshTokenWithoutPersistingAccessToken() async throws {
        let credentials = StoredOAuthCredentials(
            refreshToken: "refresh",
            accountID: "acct_1"
        )
        let store = MemoryCredentialStore(data: try JSONEncoder().encode(credentials))
        let transport = ScriptedTransport(responses: [
            .init(
                statusCode: 200,
                body: """
                {
                  "access_token": "access-refreshed",
                  "refresh_token": "refresh-refreshed",
                  "token_type": "Bearer",
                  "expires_in": 900,
                  "account_id": "acct_1"
                }
                """
            ),
        ])
        let vault = makeVault(store: store, transport: transport)

        #expect(try await vault.restore())
        #expect(try await vault.accessToken() == "access-refreshed")
        let persistedData = try #require(await store.currentData())
        let persistedText = try #require(String(data: persistedData, encoding: .utf8))
        #expect(persistedText.contains("access-refreshed") == false)
        #expect(persistedText.contains("refresh-refreshed"))
    }

    @Test
    func logoutClearsCredentialsWhenRevokeFails() async throws {
        let store = MemoryCredentialStore()
        let transport = ScriptedTransport(responses: [
            .init(statusCode: 500, body: "{}"),
        ])
        let vault = makeVault(store: store, transport: transport)
        try await vault.install(
            OAuthTokens(
                accessToken: "access",
                refreshToken: "refresh",
                accountID: "acct_1",
                expiresAt: Date().addingTimeInterval(600)
            )
        )

        await vault.logout()

        #expect(await store.currentData() == nil)
        #expect(await vault.hasCredentials() == false)
    }

    private func makeVault(
        store: MemoryCredentialStore,
        transport: ScriptedTransport
    ) -> TokenVault {
        let configuration = AppConfiguration(
            apiBaseURL: URL(string: "https://api.test")!,
            oauthRedirectURI: URL(string: "ai.beecode.ios://oauth/callback")!
        )
        return TokenVault(
            store: store,
            oauth: OAuthHTTPClient(configuration: configuration, transport: transport)
        )
    }
}

actor MemoryCredentialStore: CredentialStore {
    private var data: Data?

    init(data: Data? = nil) {
        self.data = data
    }

    func load() -> Data? {
        data
    }

    func save(_ data: Data) {
        self.data = data
    }

    func delete() {
        data = nil
    }

    func currentData() -> Data? {
        data
    }
}
