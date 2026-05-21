import ArgumentParser
import Foundation
import Virtualization

/// Captures a fully-booted VM's state into `<bundle>/state.bin` via VZ's
/// `saveMachineStateTo`. Clones (APFS cp -c the whole bundle) inherit the
/// snapshot for free; `ciderctl run` on those clones restores from state
/// instead of cold-booting, cutting startup from ~30s to ~1-2s.
struct Snapshot: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "snapshot",
        abstract: "Boot a bundle to steady state and save its RAM/CPU snapshot for fast restore."
    )

    @Argument(help: "Bundle path (typically ~/.cider/base after bootstrap).")
    var bundle: String

    @Option(name: .long, help: "Seconds to wait for SSH (port 22) before settling.")
    var sshTimeout: Int = 120

    @Option(name: .long, help: "Seconds to wait after SSH is reachable, before snapshotting (let the desktop fully load).")
    var settle: Int = 20

    func run() throws {
        let bundleURL = URL(fileURLWithPath: bundle)
        let vmBundle = VMBundle(url: bundleURL)
        guard vmBundle.isInstalled else {
            throw CiderError("bundle \(bundle) is not installed")
        }

        let cfg = try vmBundle.loadConfig()
        let vmc = try VMRunner.buildConfig(bundle: vmBundle, config: cfg, graphical: false)

        // Remove any stale snapshot before we start; the new one will go in its place.
        try? FileManager.default.removeItem(at: vmBundle.stateURL)

        let host = SnapshotHost(
            bundle: vmBundle,
            configuration: vmc,
            sshTimeout: sshTimeout,
            settleSeconds: settle,
            mac: cfg.macAddress
        )
        try host.snapshotAndExit()
    }
}

final class SnapshotHost: NSObject, VZVirtualMachineDelegate, @unchecked Sendable {
    private let bundle: VMBundle
    private let configuration: VZVirtualMachineConfiguration
    private let sshTimeout: Int
    private let settleSeconds: Int
    private let mac: String
    private let queue = DispatchQueue(label: "cider.snapshot")
    private var vm: VZVirtualMachine?

    init(
        bundle: VMBundle,
        configuration: VZVirtualMachineConfiguration,
        sshTimeout: Int,
        settleSeconds: Int,
        mac: String
    ) {
        self.bundle = bundle
        self.configuration = configuration
        self.sshTimeout = sshTimeout
        self.settleSeconds = settleSeconds
        self.mac = mac
    }

    func snapshotAndExit() throws {
        var vm: VZVirtualMachine!
        queue.sync {
            vm = VZVirtualMachine(configuration: configuration, queue: queue)
            vm.delegate = self
            self.vm = vm
        }

        try runOnQueue { vm.start(completionHandler: $0) }
        Log.info("VM started; waiting for SSH on port 22…")
        try waitForSSH()
        Log.info("SSH reachable; settling \(settleSeconds)s before snapshot…")
        Thread.sleep(forTimeInterval: TimeInterval(settleSeconds))

        Log.info("pausing VM…")
        try runOnQueue { vm.pause(completionHandler: $0) }

        Log.info("saving state to \(bundle.stateURL.path)…")
        let saveSem = DispatchSemaphore(value: 0)
        var saveError: Error?
        queue.async {
            vm.saveMachineStateTo(url: self.bundle.stateURL) { error in
                saveError = error
                saveSem.signal()
            }
        }
        saveSem.wait()
        if let err = saveError {
            try? FileManager.default.removeItem(at: bundle.stateURL)
            throw CiderError("saveMachineState failed: \(err)")
        }

        Log.info("snapshot saved; stopping VM")
        // After save, just hard stop. State on disk reflects the paused-moment;
        // resuming would mutate it.
        let stopSem = DispatchSemaphore(value: 0)
        queue.async {
            vm.stop { _ in stopSem.signal() }
        }
        stopSem.wait()
        Log.info("done. clones of this bundle will fast-restore from state.bin")
    }

    /// Dispatch a completion-handler-based VZ call to our queue and wait.
    private func runOnQueue(_ op: @escaping (@escaping (Result<Void, Error>) -> Void) -> Void) throws {
        let sem = DispatchSemaphore(value: 0)
        var capturedError: Error?
        queue.async {
            op { result in
                if case .failure(let err) = result { capturedError = err }
                sem.signal()
            }
        }
        sem.wait()
        if let err = capturedError { throw err }
    }

    private func waitForSSH() throws {
        let normalized = IPResolver.normalize(mac)
        let deadline = Date().addingTimeInterval(TimeInterval(sshTimeout))
        while Date() < deadline {
            if let ip = try IPResolver.arpLookup(mac: normalized) {
                if probeTCP(host: ip, port: 22) {
                    return
                }
            }
            Thread.sleep(forTimeInterval: 1)
        }
        throw CiderError("SSH did not come up within \(sshTimeout)s")
    }

    private func probeTCP(host: String, port: Int) -> Bool {
        let result = (try? Shell.run("/usr/bin/nc", ["-z", "-G", "1", "-w", "1", host, "\(port)"]))
        return result?.exitCode == 0
    }

    // MARK: – Delegate

    func guestDidStop(_ virtualMachine: VZVirtualMachine) {}

    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        Log.error("VM stopped unexpectedly during snapshot: \(error)")
    }
}
