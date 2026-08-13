import XCTest

final class BeecodeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testSessionShellCreatesAndOpensASession() {
        let application = XCUIApplication()
        application.launchArguments.append("--ui-testing-signed-in")
        application.launch()

        let createButton = application.buttons["beecode.session.create"]
        XCTAssertTrue(createButton.waitForExistence(timeout: 5))
        createButton.tap()

        let newSession = application.staticTexts["新会话"]
        XCTAssertTrue(newSession.waitForExistence(timeout: 5))
        newSession.tap()
        XCTAssertTrue(application.staticTexts["beecode.session.detail"].waitForExistence(timeout: 5))
    }
}
