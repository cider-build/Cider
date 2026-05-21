// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "ciderctl",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "ciderctl", targets: ["ciderctl"])
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-argument-parser.git", from: "1.5.0")
    ],
    targets: [
        .executableTarget(
            name: "ciderctl",
            dependencies: [
                .product(name: "ArgumentParser", package: "swift-argument-parser")
            ]
        )
    ]
)
