import ArgumentParser
import Foundation

struct Delete: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "delete",
        abstract: "Stop (if running) and remove a sandbox VM bundle."
    )

    @Argument(help: "Sandbox id.")
    var id: String

    func run() throws {
        let bundle = VMBundle(url: Paths.vmDir(id: id))
        guard bundle.exists else { return }

        // Bundle is about to be erased, so we skip the graceful-shutdown dance
        // Stop does. SIGKILL releases the run process's file descriptors
        // immediately at the kernel level; we don't need to wait for the
        // process to be reaped (it can sit as a zombie — its FDs are already
        // gone, so rm -rf below is unaffected).
        if let pid = bundle.readPID(), kill(pid, 0) == 0 {
            Log.info("force-killing run pid \(pid)")
            kill(pid, SIGKILL)
        }
        bundle.clearPID()

        Log.info("removing bundle \(bundle.url.path)")
        try FileManager.default.removeItem(at: bundle.url)
    }
}
