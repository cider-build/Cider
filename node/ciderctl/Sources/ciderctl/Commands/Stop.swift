import ArgumentParser
import Foundation

struct Stop: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "stop",
        abstract: "Stop a running sandbox VM by sending SIGTERM to its ciderctl-run process."
    )

    @Argument(help: "Sandbox id.")
    var id: String

    @Option(name: .long, help: "Seconds to wait for graceful shutdown before SIGKILL.")
    var timeout: Int = 30

    func run() throws {
        let bundle = VMBundle(url: Paths.vmDir(id: id))
        guard let pid = bundle.readPID() else { return }

        if kill(pid, 0) != 0 {
            bundle.clearPID()
            return
        }

        Log.info("stopping sandbox \(id) (pid \(pid))")
        kill(pid, SIGTERM)

        let deadline = Date().addingTimeInterval(TimeInterval(timeout))
        while Date() < deadline {
            if kill(pid, 0) != 0 { return }
            Thread.sleep(forTimeInterval: 0.5)
        }

        Log.error("graceful stop timed out; sending SIGKILL")
        kill(pid, SIGKILL)
        bundle.clearPID()
    }
}
