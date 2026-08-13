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
        XCTAssertTrue(
            application.descendants(matching: .any)["beecode.session.detail"].waitForExistence(timeout: 5)
        )
    }

    @MainActor
    func testConversationCompletesCalculatorFixture() {
        let application = XCUIApplication()
        application.launchArguments.append("--ui-testing-signed-in")
        application.launch()

        let session = application.staticTexts["真机体验"]
        XCTAssertTrue(session.waitForExistence(timeout: 5))
        session.tap()

        let composer = application.descendants(matching: .any)["beecode.conversation.composer"]
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        composer.tap()
        composer.typeText("计算 1+1")
        application.buttons["beecode.conversation.send"].tap()

        XCTAssertTrue(
            application.buttons["beecode.tool.calculator.completed"].waitForExistence(timeout: 5)
        )
        XCTAssertTrue(application.staticTexts["1+1 = 2"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            application.descendants(matching: .any)["beecode.tool.result"].waitForExistence(timeout: 5)
        )
    }
}
