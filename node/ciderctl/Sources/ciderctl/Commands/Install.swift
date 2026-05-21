import ArgumentParser
import Foundation
import Virtualization

struct Install: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "install",
        abstract: "Install macOS from an .ipsw restore image into a new VM bundle."
    )

    @Argument(help: "Path to the macOS restore .ipsw image.")
    var ipsw: String

    @Argument(help: "Bundle directory to create.")
    var bundle: String

    @Option(name: .long, help: "CPU count.")
    var cpus: Int = 4

    @Option(name: .long, help: "Memory in GiB.")
    var memory: Int = 3

    @Option(name: .long, help: "Disk size in GiB.")
    var disk: Int = 64

    func run() throws {
        let ipswURL = URL(fileURLWithPath: ipsw)
        guard FileManager.default.fileExists(atPath: ipswURL.path) else {
            throw CiderError("ipsw not found: \(ipsw)")
        }

        let bundleURL = URL(fileURLWithPath: bundle)
        let vm = VMBundle(url: bundleURL)
        if vm.exists && vm.isInstalled {
            throw CiderError("bundle already installed at \(bundle); delete it first")
        }
        try vm.create()

        Log.info("loading restore image \(ipsw)")
        let restoreImage = try runOnMain { try await VZMacOSRestoreImage.image(from: ipswURL) }

        guard let support = restoreImage.mostFeaturefulSupportedConfiguration else {
            throw CiderError("this host can't run any configuration of \(ipsw)")
        }

        let cfg = VMConfig(
            cpuCount: cpus,
            memorySizeBytes: UInt64(memory) * 1024 * 1024 * 1024,
            diskSizeBytes: UInt64(disk) * 1024 * 1024 * 1024,
            macAddress: VMRunner.randomMAC(),
            sshUser: "admin"
        )

        try support.hardwareModel.dataRepresentation.write(to: vm.hwModelURL)
        let machineID = VZMacMachineIdentifier()
        try machineID.dataRepresentation.write(to: vm.machineIDURL)
        _ = try VZMacAuxiliaryStorage(creatingStorageAt: vm.auxURL, hardwareModel: support.hardwareModel)
        try VMRunner.createDiskImage(at: vm.diskURL, sizeBytes: cfg.diskSizeBytes)
        try vm.saveConfig(cfg)

        Log.info("starting unattended macOS install — this typically takes 15-30 minutes")

        let vmConfig = try VMRunner.buildConfig(bundle: vm, config: cfg, graphical: false)
        try runOnMain { try await Self.runInstall(ipswURL: ipswURL, vmConfig: vmConfig) }

        try Data().write(to: vm.url.appendingPathComponent("installed.marker"))
        Log.info("install complete. next: `ciderctl bootstrap \(bundle)` to finish setup interactively")
    }

    /// VZMacOSInstaller and VZVirtualMachine (no queue arg) must run on main.
    @MainActor
    private static func runInstall(ipswURL: URL, vmConfig: VZVirtualMachineConfiguration) async throws {
        let virtualMachine = VZVirtualMachine(configuration: vmConfig)
        let installer = VZMacOSInstaller(virtualMachine: virtualMachine, restoringFromImageAt: ipswURL)

        let observer = installer.progress.observe(\.fractionCompleted, options: [.initial, .new]) { progress, _ in
            let pct = Int(progress.fractionCompleted * 100)
            FileHandle.standardError.write(Data("[ciderctl] install progress \(pct)%\r".utf8))
        }
        defer {
            observer.invalidate()
            FileHandle.standardError.write(Data("\n".utf8))
        }

        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            installer.install { result in
                switch result {
                case .success: cont.resume()
                case .failure(let err): cont.resume(throwing: err)
                }
            }
        }
    }
}

/// Drive a @MainActor async closure to completion by pumping the main run loop.
/// We run from a sync ParsableCommand on the main thread, so we can't simply
/// `await` — there's no awaiter. Pumping lets MainActor-isolated work execute.
func runOnMain<T>(_ work: @MainActor @Sendable @escaping () async throws -> T) throws -> T {
    precondition(Thread.isMainThread, "runOnMain must be called from the main thread")
    var box: Result<T, Error>?
    Task { @MainActor in
        do { box = .success(try await work()) }
        catch { box = .failure(error) }
    }
    while box == nil {
        RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.05))
    }
    return try box!.get()
}
