import ArgumentParser
import Foundation
import Virtualization

/// Foreground-runs a sandbox VM. Designed to be spawned by the node service
/// (which manages lifecycle via the written PID file).
struct Run: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "run",
        abstract: "Boot a sandbox VM headlessly in the foreground."
    )

    @Argument(help: "Sandbox id (under ~/.cider/vms/) OR absolute bundle path.")
    var id: String

    @Flag(name: .long, help: "Force a cold boot even if state.bin exists.")
    var cold: Bool = false

    func run() throws {
        let bundleURL = Self.resolveBundle(idOrPath: id)
        let bundle = VMBundle(url: bundleURL)
        guard bundle.isInstalled else {
            throw CiderError("bundle \(bundleURL.path) is not installed")
        }

        let cfg = try bundle.loadConfig()
        let vmc = try VMRunner.buildConfig(bundle: bundle, config: cfg, graphical: false)

        let host = VMHost(bundle: bundle, configuration: vmc, coldBoot: cold)
        try host.runUntilStopped()
    }

    static func resolveBundle(idOrPath: String) -> URL {
        if idOrPath.contains("/") {
            return URL(fileURLWithPath: idOrPath)
        }
        return Paths.vmDir(id: idOrPath)
    }
}

/// Owns the VM lifecycle for a single foreground run. Writes vm.pid on start,
/// removes it on exit. Listens for SIGTERM/SIGINT and requests a graceful stop.
final class VMHost: NSObject, VZVirtualMachineDelegate, @unchecked Sendable {
    private let bundle: VMBundle
    private let configuration: VZVirtualMachineConfiguration
    private let coldBoot: Bool
    private let queue = DispatchQueue(label: "cider.vm")
    private var vm: VZVirtualMachine?
    private let stopSem = DispatchSemaphore(value: 0)
    private var signalSources: [DispatchSourceSignal] = []

    init(bundle: VMBundle, configuration: VZVirtualMachineConfiguration, coldBoot: Bool = false) {
        self.bundle = bundle
        self.configuration = configuration
        self.coldBoot = coldBoot
    }

    func runUntilStopped() throws {
        var vm: VZVirtualMachine!
        queue.sync {
            vm = VZVirtualMachine(configuration: self.configuration, queue: self.queue)
            vm.delegate = self
            self.vm = vm
        }

        // If the bundle has a saved snapshot AND we weren't asked for a cold
        // boot, restore from state.bin (instant resume); otherwise fresh start.
        // Restoration that fails (e.g. stale state across a macOS update) also
        // falls back to a fresh start so we never get stuck.
        if bundle.hasState && !coldBoot {
            Log.info("restoring from snapshot at \(bundle.stateURL.path)…")
            do {
                try restoreAndResume(vm: vm)
            } catch {
                Log.error("restore failed: \(error); falling back to cold boot")
                try coldStart(vm: vm)
            }
        } else {
            if coldBoot && bundle.hasState {
                Log.info("--cold set; ignoring state.bin and cold-booting")
            }
            try coldStart(vm: vm)
        }

        try bundle.writePID(getpid())
        Log.info("VM running (pid \(getpid())); bundle=\(bundle.url.path)")

        installSignalHandlers()
        stopSem.wait()

        bundle.clearPID()
        Log.info("VM stopped")
    }

    private func coldStart(vm: VZVirtualMachine) throws {
        let sem = DispatchSemaphore(value: 0)
        var startError: Error?
        queue.async {
            vm.start { result in
                if case .failure(let err) = result { startError = err }
                sem.signal()
            }
        }
        sem.wait()
        if let err = startError { throw err }
    }

    private func restoreAndResume(vm: VZVirtualMachine) throws {
        let restoreSem = DispatchSemaphore(value: 0)
        var restoreError: Error?
        queue.async {
            vm.restoreMachineStateFrom(url: self.bundle.stateURL) { error in
                restoreError = error
                restoreSem.signal()
            }
        }
        restoreSem.wait()
        if let err = restoreError { throw err }

        let resumeSem = DispatchSemaphore(value: 0)
        var resumeError: Error?
        queue.async {
            vm.resume { result in
                if case .failure(let err) = result { resumeError = err }
                resumeSem.signal()
            }
        }
        resumeSem.wait()
        if let err = resumeError { throw err }
    }

    private func installSignalHandlers() {
        for sig in [SIGTERM, SIGINT] {
            let src = DispatchSource.makeSignalSource(signal: sig, queue: queue)
            src.setEventHandler { [weak self] in self?.requestStop() }
            signal(sig, SIG_IGN)
            src.resume()
            signalSources.append(src)
        }
    }

    private func requestStop() {
        guard let vm else { return }
        Log.info("graceful stop requested")
        if vm.canRequestStop {
            do {
                try vm.requestStop()
            } catch {
                Log.error("requestStop failed: \(error); forcing stop")
                vm.stop { _ in }
            }
        } else {
            vm.stop { _ in }
        }
    }

    // MARK: – VZVirtualMachineDelegate (callbacks land on `queue`)

    func guestDidStop(_ virtualMachine: VZVirtualMachine) {
        stopSem.signal()
    }

    func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        Log.error("VM stopped with error: \(error)")
        stopSem.signal()
    }
}
