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

    func run() throws {
        let bundleURL = Self.resolveBundle(idOrPath: id)
        let bundle = VMBundle(url: bundleURL)
        guard bundle.isInstalled else {
            throw CiderError("bundle \(bundleURL.path) is not installed")
        }

        let cfg = try bundle.loadConfig()
        let vmc = try VMRunner.buildConfig(bundle: bundle, config: cfg, graphical: false)

        let host = VMHost(bundle: bundle, configuration: vmc)
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
    private let queue = DispatchQueue(label: "cider.vm")
    private var vm: VZVirtualMachine?
    private let stopSem = DispatchSemaphore(value: 0)
    private var signalSources: [DispatchSourceSignal] = []

    init(bundle: VMBundle, configuration: VZVirtualMachineConfiguration) {
        self.bundle = bundle
        self.configuration = configuration
    }

    func runUntilStopped() throws {
        var vm: VZVirtualMachine!
        var startError: Error?
        let startSem = DispatchSemaphore(value: 0)

        queue.sync {
            vm = VZVirtualMachine(configuration: self.configuration, queue: self.queue)
            vm.delegate = self
            self.vm = vm
        }

        queue.async {
            vm.start { result in
                if case .failure(let err) = result { startError = err }
                startSem.signal()
            }
        }
        startSem.wait()
        if let err = startError { throw err }

        try bundle.writePID(getpid())
        Log.info("VM started (pid \(getpid())); bundle=\(bundle.url.path)")

        installSignalHandlers()
        stopSem.wait()

        bundle.clearPID()
        Log.info("VM stopped")
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
