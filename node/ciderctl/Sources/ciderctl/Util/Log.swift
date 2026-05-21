import Foundation

enum Log {
    static func info(_ message: String) {
        FileHandle.standardError.write(Data("[ciderctl] \(message)\n".utf8))
    }

    static func error(_ message: String) {
        FileHandle.standardError.write(Data("[ciderctl] error: \(message)\n".utf8))
    }
}

struct CiderError: Error, CustomStringConvertible {
    let message: String
    init(_ message: String) { self.message = message }
    var description: String { message }
}
