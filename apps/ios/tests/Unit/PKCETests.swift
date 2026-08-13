import Testing
@testable import Beecode

struct PKCETests {
    @Test
    func requestUsesValidS256Values() throws {
        let request = try PKCERequest.make()

        #expect(request.state.count >= 43)
        #expect((43...128).contains(request.verifier.count))
        #expect(request.challenge.count == 43)
        #expect(request.verifier.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
        #expect(request.challenge.allSatisfy { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" })
    }
}
