import ArgumentParser
import Foundation
import SwiftUI
import Virtualization

struct Bootstrap: ParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "bootstrap",
        abstract: "Open a base bundle in a graphical window for first-time setup (create user, enable Remote Login, paste SSH pubkey)."
    )

    @Argument(help: "Bundle path (the one created by `install`).")
    var bundle: String

    func run() throws {
        let bundleURL = URL(fileURLWithPath: bundle)
        let vmBundle = VMBundle(url: bundleURL)
        guard vmBundle.isInstalled else {
            throw CiderError("bundle \(bundle) is not installed")
        }

        let (_, pub) = try SSHKey.ensure()
        let pubContents = try String(contentsOf: pub, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        printInstructions(pubkey: pubContents)

        let cfg = try vmBundle.loadConfig()
        let vmc = try VMRunner.buildConfig(bundle: vmBundle, config: cfg, graphical: true)

        // ParsableCommand.run() runs on the main thread; we assert that isolation
        // so we can build the @MainActor session without a Task hop.
        BootstrapEntry.session = MainActor.assumeIsolated {
            BootstrapSession(bundle: vmBundle, configuration: vmc)
        }
        BootstrapEntry.main()
    }

    private func printInstructions(pubkey: String) {
        FileHandle.standardError.write(Data("""

        ─── First-time bootstrap ─────────────────────────────────────
        A window will open showing the VM. Inside the VM:
          1. Finish Setup Assistant. Create user `admin`.
          2. System Settings → General → Sharing → enable Remote Login.
          3. Open Terminal and run:

             mkdir -p ~/.ssh && chmod 700 ~/.ssh
             cat >> ~/.ssh/authorized_keys <<'EOF'
        \(pubkey)
        EOF
             chmod 600 ~/.ssh/authorized_keys

          4. Apple menu → Shut Down. The window closes; ciderctl exits.
        ──────────────────────────────────────────────────────────────

        """.utf8))
    }
}

/// Owns a VM for one bootstrap run. Acts as the VZ delegate. ObservableObject so
/// SwiftUI can hold it through @StateObject.
@MainActor
final class BootstrapSession: NSObject, ObservableObject, VZVirtualMachineDelegate {
    let bundle: VMBundle
    let vm: VZVirtualMachine

    init(bundle: VMBundle, configuration: VZVirtualMachineConfiguration) {
        self.bundle = bundle
        self.vm = VZVirtualMachine(configuration: configuration)
        super.init()
        self.vm.delegate = self
    }

    func boot() async {
        Log.info("starting VM…")
        do {
            #if arch(arm64)
            let options = VZMacOSVirtualMachineStartOptions()
            options.startUpFromMacOSRecovery = false
            try await vm.start(options: options)
            #else
            try await vm.start()
            #endif
            Log.info("VM started — guest should render within a few seconds")
        } catch {
            Log.error("vm.start failed: \(error)")
            NSApp.terminate(nil)
        }
    }

    nonisolated func guestDidStop(_ virtualMachine: VZVirtualMachine) {
        let marker = bundle.url.appendingPathComponent("bootstrap.marker")
        try? Data().write(to: marker)
        Log.info("bootstrap.marker written; bundle ready for cloning")
        DispatchQueue.main.async { NSApp.terminate(nil) }
    }

    nonisolated func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
        Log.error("vm stopped with error: \(error)")
        DispatchQueue.main.async { NSApp.terminate(nil) }
    }
}

/// SwiftUI's `App.main()` doesn't accept arguments, so we hand it the session via
/// a static slot the App initializer reads. Set exactly once by `Bootstrap.run()`.
struct BootstrapEntry: App {
    nonisolated(unsafe) static var session: BootstrapSession?

    @StateObject private var session: BootstrapSession
    @NSApplicationDelegateAdaptor private var appDelegate: BootstrapAppDelegate

    init() {
        guard let s = Self.session else {
            preconditionFailure("BootstrapEntry.session must be assigned before App entry")
        }
        _session = StateObject(wrappedValue: s)
    }

    var body: some Scene {
        WindowGroup("ciderctl bootstrap") {
            VMBootstrapView(session: session)
                .frame(minWidth: 1280, minHeight: 800)
        }
        .windowResizability(.contentSize)
    }
}

final class BootstrapAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        let app = NSApplication.shared
        app.setActivationPolicy(.regular)
        app.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

struct VMBootstrapView: View {
    @ObservedObject var session: BootstrapSession

    var body: some View {
        VMView(vm: session.vm)
            .task { await session.boot() }
    }
}

struct VMView: NSViewRepresentable {
    let vm: VZVirtualMachine

    func makeNSView(context: Context) -> VZVirtualMachineView {
        let view = VZVirtualMachineView()
        view.capturesSystemKeys = true
        if #available(macOS 14.0, *) {
            view.automaticallyReconfiguresDisplay = true
        }
        view.virtualMachine = vm
        return view
    }

    func updateNSView(_ nsView: VZVirtualMachineView, context: Context) {
        nsView.virtualMachine = vm
    }
}
