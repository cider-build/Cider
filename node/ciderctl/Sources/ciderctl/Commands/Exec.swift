import ArgumentParser
import Foundation

struct Exec: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "exec",
        abstract: "Run a shell command inside a sandbox VM over SSH and print {stdout, stderr, exit_code} JSON."
    )

    @Argument(help: "Sandbox id.")
    var id: String

    @Argument(parsing: .captureForPassthrough, help: "Command to run (joined with spaces).")
    var command: [String]

    @Option(name: .long, help: "Seconds to wait for SSH to come up.")
    var timeout: Int = 60

    func run() throws {
        let bundle = VMBundle(url: Paths.vmDir(id: id))
        guard bundle.isInstalled else { throw CiderError("sandbox not found: \(id)") }

        let cfg = try bundle.loadConfig()
        guard let ip = try IPResolver.wait(forMac: cfg.macAddress, timeout: TimeInterval(timeout)) else {
            throw CiderError("could not resolve sandbox IP")
        }

        let key = try SSHKey.ensure().privateKey
        let joined = command.joined(separator: " ")

        let result = try Shell.run("/usr/bin/ssh", [
            "-i", key.path,
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "LogLevel=ERROR",
            "-o", "ConnectTimeout=\(timeout)",
            "\(cfg.sshUser)@\(ip)",
            joined,
        ])

        try Wire.writeLine(ExecOutput(
            stdout: result.stdout,
            stderr: result.stderr,
            exit_code: result.exitCode
        ))
    }
}
