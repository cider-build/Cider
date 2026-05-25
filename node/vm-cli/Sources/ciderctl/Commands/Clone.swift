import ArgumentParser
import Foundation

struct Clone: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "clone",
        abstract: "APFS-clone a base bundle into a new sandbox VM."
    )

    @Argument(help: "Path to the base bundle to clone from.")
    var base: String

    @Argument(help: "ID of the new sandbox.")
    var id: String

    func run() throws {
        let baseURL = URL(fileURLWithPath: base)
        let baseBundle = VMBundle(url: baseURL)
        guard baseBundle.isInstalled else {
            throw CiderError("base bundle at \(base) is not installed")
        }

        try Paths.ensureRoot()
        let targetURL = Paths.vmDir(id: id)

        if FileManager.default.fileExists(atPath: targetURL.path) {
            throw CiderError("sandbox already exists: \(id)")
        }

        Log.info("cloning \(baseURL.lastPathComponent) → \(id)")
        let result = try Shell.run("/bin/cp", ["-c", "-R", baseURL.path, targetURL.path])
        if result.exitCode != 0 {
            throw CiderError("clone failed: \(result.stderr)")
        }

        let target = VMBundle(url: targetURL)

        // Cold-boot clones get a fresh MAC so multiple can coexist on the host
        // vmnet bridge. Snapshot-restore clones MUST keep base's MAC because
        // the saved state has the MAC baked into the network device's runtime
        // state — mismatch leaves networking dead in the restored guest.
        // The trade-off: only one snapshot-restore clone at a time per base.
        if !target.hasState {
            var cfg = try target.loadConfig()
            cfg.macAddress = VMRunner.randomMAC()
            try target.saveConfig(cfg)
        }
        target.clearPID()

        FileHandle.standardOutput.write(Data("\(targetURL.path)\n".utf8))
    }
}
