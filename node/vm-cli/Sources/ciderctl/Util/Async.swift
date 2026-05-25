import Foundation

/// Block the current (typically main) thread until the async operation completes.
/// Used to bridge sync ParsableCommand.run() into async Virtualization APIs.
func blockingRun<T>(_ op: @Sendable @escaping () async throws -> T) throws -> T {
    let sem = DispatchSemaphore(value: 0)
    var result: Result<T, Error>!
    Task.detached {
        do {
            let value = try await op()
            result = .success(value)
        } catch {
            result = .failure(error)
        }
        sem.signal()
    }
    sem.wait()
    return try result.get()
}
