// swift-tools-version: 5.9

import PackageDescription

let package = Package(
	name: "GuideScreenCaptureKitHelper",
	platforms: [
		.macOS(.v13)
	],
	products: [
		.executable(
			name: "guidestudio-screencapturekit-helper",
			targets: ["GuideScreenCaptureKitHelper"]
		),
		.executable(
			name: "guidestudio-macos-cursor-helper",
			targets: ["GuideMacOSCursorHelper"]
		)
	],
	targets: [
		.executableTarget(
			name: "GuideScreenCaptureKitHelper",
			path: "Sources/GuideScreenCaptureKitHelper"
		),
		.executableTarget(
			name: "GuideMacOSCursorHelper",
			path: "Sources/GuideMacOSCursorHelper"
		)
	]
)
