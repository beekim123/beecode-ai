import Foundation
import Testing
@testable import Beecode

struct SSEParserTests {
    @Test(arguments: ["\n", "\r\n"])
    func lineFramerPreservesBlankEventDelimitersAndUTF8(lineEnding: String) {
        let payload = [
            "event: stream.connected",
            "data: {\"message\":\"连接成功\"}",
            "",
        ].joined(separator: lineEnding) + lineEnding
        var framer = SSELineFramer()
        var lines: [String] = []

        for byte in payload.utf8 {
            if let line = framer.consume(byte) {
                lines.append(line)
            }
        }
        if let finalLine = framer.finish() {
            lines.append(finalLine)
        }

        #expect(lines == [
            "event: stream.connected",
            "data: {\"message\":\"连接成功\"}",
            "",
        ])
    }

    @Test
    func parsesCRLFMultilineDataAndIgnoresHeartbeatsAndUnknownFields() {
        var parser = SSEParser()
        #expect(parser.consume(": heartbeat\r") == nil)
        #expect(parser.consume("event: agent\r") == nil)
        #expect(parser.consume("id: evt_1\r") == nil)
        #expect(parser.consume("retry: 5000\r") == nil)
        #expect(parser.consume("data: first\r") == nil)
        #expect(parser.consume("data: second\r") == nil)

        #expect(
            parser.consume("\r") == SSEMessage(
                event: "agent",
                id: "evt_1",
                data: "first\nsecond"
            )
        )
    }

    @Test
    func decodesAConnectedEventAndAgentEnvelopeWithUnknownJSONFields() throws {
        let connected = try SessionStreamEvent(
            message: SSEMessage(
                event: "stream.connected",
                id: nil,
                data: "{\"sequence\":4,\"future\":true}"
            )
        )
        #expect(connected == .connected(sequence: 4))

        let agent = try SessionStreamEvent(
            message: SSEMessage(
                event: "agent",
                id: "evt_5",
                data: """
                {
                  "eventId":"evt_5",
                  "sessionId":"ses_1",
                  "turnId":"turn_1",
                  "sequence":5,
                  "occurredAt":"2026-08-13T00:00:05.000Z",
                  "future":"ignored",
                  "event":{
                    "type":"message.delta",
                    "sessionId":"ses_1",
                    "turnId":"turn_1",
                    "messageId":"msg_1",
                    "partId":"part_1",
                    "textDelta":"2"
                  }
                }
                """
            )
        )

        guard case .agent(let envelope) = agent,
              case .messageDelta(_, _, _, _, let text) = envelope.event else {
            Issue.record("Expected an agent message.delta event")
            return
        }
        #expect(envelope.sequence == 5)
        #expect(text == "2")
    }
}
