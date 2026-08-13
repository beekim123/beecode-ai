import Foundation

enum AppConfigurationError: Error, LocalizedError, Sendable {
    case missingValue(String)
    case invalidURL(String)

    var errorDescription: String? {
        switch self {
        case .missingValue(let key):
            "Missing application configuration: \(key)"
        case .invalidURL(let key):
            "Invalid URL in application configuration: \(key)"
        }
    }
}

struct AppConfiguration: Sendable {
    static let oauthClientID = "beecode-ios"

    let apiBaseURL: URL
    let oauthRedirectURI: URL

    var oauthCallbackScheme: String {
        oauthRedirectURI.scheme ?? ""
    }

    static func live(bundle: Bundle = .main) throws -> AppConfiguration {
        let apiBaseURL = try configuredURL(for: "BEECODE_API_BASE_URL", in: bundle)
        let redirectURI = try configuredURL(for: "BEECODE_IOS_OAUTH_REDIRECT_URI", in: bundle)
        guard redirectURI.scheme?.isEmpty == false else {
            throw AppConfigurationError.invalidURL("BEECODE_IOS_OAUTH_REDIRECT_URI")
        }
        return AppConfiguration(apiBaseURL: apiBaseURL, oauthRedirectURI: redirectURI)
    }

    private static func configuredURL(for key: String, in bundle: Bundle) throws -> URL {
        guard let value = bundle.object(forInfoDictionaryKey: key) as? String,
              value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false else {
            throw AppConfigurationError.missingValue(key)
        }
        guard let url = URL(string: value) else {
            throw AppConfigurationError.invalidURL(key)
        }
        return url
    }
}
