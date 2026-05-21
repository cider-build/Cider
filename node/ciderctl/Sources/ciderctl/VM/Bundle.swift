import Foundation

/// On-disk layout of a single VM bundle:
///
/// <bundle>/
///   config.json     # cpu, memory, mac, ssh user
///   disk.img        # boot disk (sparse, APFS-cloneable)
///   nvram.bin       # NVRAM
///   aux.bin         # MacAuxiliaryStorage
///   state.bin       # OPTIONAL: VZ saveMachineState snapshot (RAM+CPU)
///   vm.pid          # written when running headless (deleted on stop)
struct VMBundle {
    let url: URL

    var configURL: URL { url.appendingPathComponent("config.json") }
    var diskURL: URL { url.appendingPathComponent("disk.img") }
    var nvramURL: URL { url.appendingPathComponent("nvram.bin") }
    var auxURL: URL { url.appendingPathComponent("aux.bin") }
    var stateURL: URL { url.appendingPathComponent("state.bin") }
    var pidURL: URL { url.appendingPathComponent("vm.pid") }

    var exists: Bool { FileManager.default.fileExists(atPath: url.path) }
    var hasDisk: Bool { FileManager.default.fileExists(atPath: diskURL.path) }
    var hasConfig: Bool { FileManager.default.fileExists(atPath: configURL.path) }
    var hasState: Bool { FileManager.default.fileExists(atPath: stateURL.path) }
    var isInstalled: Bool { hasDisk && hasConfig && FileManager.default.fileExists(atPath: auxURL.path) }

    func create() throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    func loadConfig() throws -> VMConfig {
        let data = try Data(contentsOf: configURL)
        return try JSONDecoder().decode(VMConfig.self, from: data)
    }

    func saveConfig(_ config: VMConfig) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(config)
        try data.write(to: configURL)
    }

    func readPID() -> pid_t? {
        guard let s = try? String(contentsOf: pidURL, encoding: .utf8),
              let pid = pid_t(s.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return nil
        }
        return pid
    }

    func writePID(_ pid: pid_t) throws {
        try String(pid).write(to: pidURL, atomically: true, encoding: .utf8)
    }

    func clearPID() {
        try? FileManager.default.removeItem(at: pidURL)
    }
}

struct VMConfig: Codable {
    var cpuCount: Int
    var memorySizeBytes: UInt64
    var diskSizeBytes: UInt64
    var macAddress: String
    var sshUser: String

    static let `default` = VMConfig(
        cpuCount: 4,
        memorySizeBytes: 3 * 1024 * 1024 * 1024,
        diskSizeBytes: 64 * 1024 * 1024 * 1024,
        macAddress: "",
        sshUser: "admin"
    )
}
