import ArgumentParser

@main
struct CiderCtl: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "ciderctl",
        abstract: "Manage macOS sandbox VMs via Virtualization.framework.",
        subcommands: [
            Install.self,
            Bootstrap.self,
            Snapshot.self,
            Clone.self,
            Run.self,
            IP.self,
            Exec.self,
            Stop.self,
            Delete.self,
            List.self,
        ]
    )
}
