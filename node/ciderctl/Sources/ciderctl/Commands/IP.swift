import ArgumentParser
import Foundation

struct IP: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "ip",
        abstract: "Resolve a running sandbox's IP from the host's ARP cache."
    )

    @Argument(help: "Sandbox id.")
    var id: String

    @Option(name: .long, help: "Seconds to wait before giving up.")
    var timeout: Int = 60

    func run() throws {
        let bundle = VMBundle(url: Paths.vmDir(id: id))
        guard bundle.isInstalled else { throw CiderError("sandbox not found: \(id)") }

        let cfg = try bundle.loadConfig()
        let mac = cfg.macAddress
        guard !mac.isEmpty else { throw CiderError("sandbox has no mac address") }

        if let ip = try IPResolver.wait(forMac: mac, timeout: TimeInterval(timeout)) {
            FileHandle.standardOutput.write(Data("\(ip)\n".utf8))
        } else {
            throw CiderError("could not resolve IP for \(mac) within \(timeout)s")
        }
    }
}

enum IPResolver {
    static func wait(forMac mac: String, timeout: TimeInterval) throws -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        let normalizedMac = normalize(mac)
        while Date() < deadline {
            if let ip = try arpLookup(mac: normalizedMac) {
                return ip
            }
            Thread.sleep(forTimeInterval: 1.0)
        }
        return nil
    }

    /// `arp -an` lines look like:
    ///   ? (192.168.64.5) at b6:1a:2b:3c:4d:5e on bridge100 ifscope [bridge]
    static func arpLookup(mac: String) throws -> String? {
        let result = try Shell.run("/usr/sbin/arp", ["-an"])
        if result.exitCode != 0 { return nil }
        for line in result.stdout.split(separator: "\n") {
            let s = String(line)
            guard let macStart = s.range(of: " at ")?.upperBound else { continue }
            let macEnd = s[macStart...].firstIndex(of: " ") ?? s.endIndex
            let foundMac = normalize(String(s[macStart..<macEnd]))
            if foundMac == mac {
                if let l = s.range(of: "("), let r = s.range(of: ")") {
                    return String(s[l.upperBound..<r.lowerBound])
                }
            }
        }
        return nil
    }

    static func normalize(_ mac: String) -> String {
        mac.lowercased().split(separator: ":").map {
            let n = Int($0, radix: 16) ?? 0
            return String(format: "%x", n)
        }.joined(separator: ":")
    }
}
