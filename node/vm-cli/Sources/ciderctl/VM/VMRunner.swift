import Foundation
import Virtualization

extension VMBundle {
    var hwModelURL: URL { url.appendingPathComponent("hwmodel.bin") }
    var machineIDURL: URL { url.appendingPathComponent("machineid.bin") }
}

enum VMRunner {

    // MARK: – disk image

    /// Create a sparse file of `sizeBytes` at `url`. Truncates if it exists.
    static func createDiskImage(at url: URL, sizeBytes: UInt64) throws {
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
        FileManager.default.createFile(atPath: url.path, contents: nil)
        let fh = try FileHandle(forWritingTo: url)
        try fh.truncate(atOffset: sizeBytes)
        try fh.close()
    }

    // MARK: – platform

    static func buildPlatform(bundle: VMBundle) throws -> VZMacPlatformConfiguration {
        let platform = VZMacPlatformConfiguration()

        guard let hwData = try? Data(contentsOf: bundle.hwModelURL),
              let hwModel = VZMacHardwareModel(dataRepresentation: hwData) else {
            throw CiderError("missing or invalid hardware model at \(bundle.hwModelURL.path)")
        }
        guard hwModel.isSupported else {
            throw CiderError("hardware model is not supported on this host")
        }
        platform.hardwareModel = hwModel

        guard let idData = try? Data(contentsOf: bundle.machineIDURL),
              let machineID = VZMacMachineIdentifier(dataRepresentation: idData) else {
            throw CiderError("missing or invalid machine id at \(bundle.machineIDURL.path)")
        }
        platform.machineIdentifier = machineID

        platform.auxiliaryStorage = VZMacAuxiliaryStorage(url: bundle.auxURL)
        return platform
    }

    // MARK: – common VM config

    static func buildConfig(
        bundle: VMBundle,
        config: VMConfig,
        graphical: Bool
    ) throws -> VZVirtualMachineConfiguration {
        let vmc = VZVirtualMachineConfiguration()
        vmc.platform = try buildPlatform(bundle: bundle)
        vmc.cpuCount = clampedCPUCount(config.cpuCount)
        vmc.memorySize = clampedMemorySize(config.memorySizeBytes)

        // Boot loader (macOS)
        vmc.bootLoader = VZMacOSBootLoader()

        // Disk
        let attachment = try VZDiskImageStorageDeviceAttachment(url: bundle.diskURL, readOnly: false)
        vmc.storageDevices = [VZVirtioBlockDeviceConfiguration(attachment: attachment)]

        // Network — NAT
        let netConfig = VZVirtioNetworkDeviceConfiguration()
        netConfig.attachment = VZNATNetworkDeviceAttachment()
        if let mac = VZMACAddress(string: config.macAddress) {
            netConfig.macAddress = mac
        }
        vmc.networkDevices = [netConfig]

        // Entropy
        vmc.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]

        // Memory balloon
        vmc.memoryBalloonDevices = [VZVirtioTraditionalMemoryBalloonDeviceConfiguration()]

        // Display + input. We attach these for *every* run, not just the
        // windowed bootstrap: macOS only runs WindowServer (= produces a
        // framebuffer VNC/Screen Sharing can serve) when there's a graphics
        // device attached. Without this, a headless `ciderctl run` boots a
        // VM whose desktop is permanently blank.
        let graphics = VZMacGraphicsDeviceConfiguration()
        graphics.displays = [
            VZMacGraphicsDisplayConfiguration(widthInPixels: 1920, heightInPixels: 1200, pixelsPerInch: 72)
        ]
        vmc.graphicsDevices = [graphics]
        vmc.keyboards = [VZUSBKeyboardConfiguration()]
        vmc.pointingDevices = [VZUSBScreenCoordinatePointingDeviceConfiguration()]
        // `graphical` is retained for callers that might want to branch later
        // (e.g. audio); for now both windowed and headless boots use the same
        // hardware set.
        _ = graphical

        try vmc.validate()
        return vmc
    }

    // Apple's framework enforces tight bounds; clamp into the allowed range.
    private static func clampedCPUCount(_ requested: Int) -> Int {
        let minCount = VZVirtualMachineConfiguration.minimumAllowedCPUCount
        let maxCount = VZVirtualMachineConfiguration.maximumAllowedCPUCount
        return min(max(requested, minCount), maxCount)
    }

    private static func clampedMemorySize(_ requested: UInt64) -> UInt64 {
        let minSize = VZVirtualMachineConfiguration.minimumAllowedMemorySize
        let maxSize = VZVirtualMachineConfiguration.maximumAllowedMemorySize
        return min(max(requested, minSize), maxSize)
    }
}

// Generate a fresh, locally-administered MAC like 'b6:...' so each VM differs.
extension VMRunner {
    static func randomMAC() -> String {
        var bytes = [UInt8](repeating: 0, count: 6)
        for i in 0..<6 { bytes[i] = UInt8.random(in: 0...255) }
        // Locally administered + unicast
        bytes[0] = (bytes[0] & 0xFE) | 0x02
        return bytes.map { String(format: "%02x", $0) }.joined(separator: ":")
    }
}
