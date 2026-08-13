struct AppMetadata: Equatable, Sendable {
    let productName: String
    let surface: String

    static let current = AppMetadata(
        productName: "Beecode",
        surface: "ios"
    )
}
