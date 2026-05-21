import Foundation

/// JSON shapes ciderctl prints on stdout. Kept here so a future schema bump
/// only touches one file. snake_case to match the Python node service.
struct ExecOutput: Encodable {
    let stdout: String
    let stderr: String
    let exit_code: Int32
}

struct SandboxListEntry: Encodable {
    let id: String
    let running: Bool
    let path: String
}

enum Wire {
    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.sortedKeys]
        return e
    }()

    static func writeLine<T: Encodable>(_ value: T) throws {
        let data = try encoder.encode(value)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}
