import Foundation

enum SSHKey {
    static func ensure() throws -> (privateKey: URL, publicKey: URL) {
        try Paths.ensureRoot()

        if !FileManager.default.fileExists(atPath: Paths.sshKey.path) {
            Log.info("generating SSH keypair at \(Paths.sshKey.path)")
            let result = try Shell.run("/usr/bin/ssh-keygen", [
                "-t", "ed25519",
                "-f", Paths.sshKey.path,
                "-N", "",
                "-C", "cider@host",
                "-q",
            ])
            if result.exitCode != 0 {
                throw CiderError("ssh-keygen failed: \(result.stderr)")
            }
        }
        return (Paths.sshKey, Paths.sshKeyPub)
    }

    static func publicKeyContents() throws -> String {
        _ = try ensure()
        return try String(contentsOf: Paths.sshKeyPub, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
