import Foundation

struct SSELineFramer: Sendable {
    private var bytes: [UInt8] = []
    private var previousDelimiterWasCarriageReturn = false

    mutating func consume(_ byte: UInt8) -> String? {
        if previousDelimiterWasCarriageReturn {
            previousDelimiterWasCarriageReturn = false
            if byte == Self.lineFeed {
                return nil
            }
        }

        switch byte {
        case Self.carriageReturn:
            previousDelimiterWasCarriageReturn = true
            return takeLine()
        case Self.lineFeed:
            return takeLine()
        default:
            bytes.append(byte)
            return nil
        }
    }

    mutating func finish() -> String? {
        guard bytes.isEmpty == false else { return nil }
        return takeLine()
    }

    private mutating func takeLine() -> String {
        defer { bytes.removeAll(keepingCapacity: true) }
        return String(decoding: bytes, as: UTF8.self)
    }

    private static let carriageReturn = UInt8(ascii: "\r")
    private static let lineFeed = UInt8(ascii: "\n")
}

struct SSEMessage: Equatable, Sendable {
    let event: String?
    let id: String?
    let data: String
}

struct SSEParser: Sendable {
    private var event: String?
    private var id: String?
    private var dataLines: [String] = []
    private var hasFields = false

    mutating func consume(_ input: String) -> SSEMessage? {
        let line = input.last == "\r" ? String(input.dropLast()) : input
        guard line.isEmpty == false else {
            guard hasFields else { return nil }
            defer { reset() }
            return SSEMessage(event: event, id: id, data: dataLines.joined(separator: "\n"))
        }
        guard line.first != ":" else {
            return nil
        }

        let field: Substring
        var value: Substring
        if let colon = line.firstIndex(of: ":") {
            field = line[..<colon]
            value = line[line.index(after: colon)...]
            if value.first == " " {
                value = value.dropFirst()
            }
        } else {
            field = Substring(line)
            value = ""
        }

        switch field {
        case "event":
            event = String(value)
            hasFields = true
        case "id":
            if value.contains("\0") == false {
                id = String(value)
            }
            hasFields = true
        case "data":
            dataLines.append(String(value))
            hasFields = true
        default:
            break
        }
        return nil
    }

    private mutating func reset() {
        event = nil
        id = nil
        dataLines = []
        hasFields = false
    }
}

enum SessionStreamEvent: Equatable, Sendable {
    case connected(sequence: Int)
    case agent(AgentEventEnvelope)

    init(message: SSEMessage, decoder: JSONDecoder = JSONDecoder()) throws {
        switch message.event {
        case "stream.connected":
            let payload = try decoder.decode(
                StreamConnectedPayload.self,
                from: Data(message.data.utf8)
            )
            self = .connected(sequence: payload.sequence)
        case "agent":
            self = .agent(
                try decoder.decode(
                    AgentEventEnvelope.self,
                    from: Data(message.data.utf8)
                )
            )
        default:
            throw SessionEventStreamError.unknownEvent(message.event ?? "")
        }
    }
}

private struct StreamConnectedPayload: Decodable {
    let sequence: Int
}
