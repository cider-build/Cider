import ArgumentParser
import Foundation

struct List: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "list",
        abstract: "List sandbox VMs and their running status as JSON."
    )

    func run() throws {
        try Paths.ensureRoot()
        let fm = FileManager.default
        let entries = (try? fm.contentsOfDirectory(at: Paths.vmsDir, includingPropertiesForKeys: nil)) ?? []

        var items: [SandboxListEntry] = []
        for entry in entries {
            guard (try? entry.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true else { continue }
            let bundle = VMBundle(url: entry)
            guard bundle.isInstalled else { continue }

            let running: Bool
            if let pid = bundle.readPID(), kill(pid, 0) == 0 {
                running = true
            } else {
                if bundle.readPID() != nil { bundle.clearPID() }
                running = false
            }

            items.append(SandboxListEntry(
                id: entry.lastPathComponent,
                running: running,
                path: entry.path
            ))
        }

        try Wire.writeLine(items)
    }
}
