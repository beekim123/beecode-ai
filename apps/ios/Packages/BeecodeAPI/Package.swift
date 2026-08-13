// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "BeecodeAPI",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "BeecodeAPI", targets: ["BeecodeAPI"]),
    ],
    dependencies: [
        .package(
            url: "https://github.com/apple/swift-openapi-generator.git",
            exact: "1.13.0"
        ),
        .package(
            url: "https://github.com/apple/swift-openapi-runtime.git",
            exact: "1.12.0"
        ),
    ],
    targets: [
        .target(
            name: "BeecodeAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator"),
            ]
        ),
    ]
)
