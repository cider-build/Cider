import Foundation

struct ShellResult {
    let stdout: String
    let stderr: String
    let exitCode: Int32
}

enum Shell {
    @discardableResult
    static func run(_ executable: String, _ args: [String], stdin: String? = nil) throws -> ShellResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = args

        let outPipe = Pipe()
        let errPipe = Pipe()
        process.standardOutput = outPipe
        process.standardError = errPipe

        let inPipe: Pipe?
        if let stdin {
            inPipe = Pipe()
            process.standardInput = inPipe
            try inPipe!.fileHandleForWriting.write(contentsOf: Data(stdin.utf8))
        } else {
            inPipe = nil
        }

        try process.run()
        try inPipe?.fileHandleForWriting.close()

        let outData = try outPipe.fileHandleForReading.readToEnd() ?? Data()
        let errData = try errPipe.fileHandleForReading.readToEnd() ?? Data()
        process.waitUntilExit()

        return ShellResult(
            stdout: String(data: outData, encoding: .utf8) ?? "",
            stderr: String(data: errData, encoding: .utf8) ?? "",
            exitCode: process.terminationStatus
        )
    }
}
