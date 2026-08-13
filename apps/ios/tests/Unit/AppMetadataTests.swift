import Testing
@testable import Beecode

struct AppMetadataTests {
    @Test
    func currentMetadataIdentifiesTheIOSApplication() {
        let metadata = AppMetadata.current

        #expect(metadata.productName == "Beecode")
        #expect(metadata.surface == "ios")
    }
}
