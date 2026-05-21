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

        if bundle.readPID() != nil {
            var stop = Stop()
            stop.id = id
            try stop.run()
        }

        Log.info("removing bundle \(bundle.url.path)")
        try FileManager.default.removeItem(at: bundle.url)
    }
}
