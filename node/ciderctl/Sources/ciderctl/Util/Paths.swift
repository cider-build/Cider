import Foundation

enum Paths {
    static let root: URL = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home.appendingPathComponent(".cider", isDirectory: true)
    }()

    static let vmsDir: URL = root.appendingPathComponent("vms", isDirectory: true)

    static let sshKey: URL = root.appendingPathComponent("ssh_key")
    static let sshKeyPub: URL = root.appendingPathComponent("ssh_key.pub")

    static func vmDir(id: String) -> URL {
        vmsDir.appendingPathComponent(id, isDirectory: true)
    }

    static func ensureRoot() throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: vmsDir, withIntermediateDirectories: true)
    }
}
