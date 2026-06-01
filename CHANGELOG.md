# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-01

### Added

- Runtime validation of every tool's arguments via the `McpServer` API and zod
  input schemas, so bad input yields a clear error instead of a malformed
  `simctl` call.

### Changed

- `boot` now waits for the device to be ready before returning, instead of
  returning while the device is still booting (#13).
- The `simctl` layer uses async `execFile` instead of the blocking
  `execFileSync`, so tool calls no longer block the event loop (#12).
- Bumped `@modelcontextprotocol/sdk` and other dependencies to current versions.

### Fixed

- Corrected the `simctl status_bar` subcommand and cellular flags, which were
  previously malformed.
- Tightened `isUdid` to match the canonical 8-4-4-4-12 UUID shape so device
  names that merely look UUID-ish are no longer misclassified (#11).

## [1.0.0] - 2026-05-31

### Added

- Initial release: a Model Context Protocol server that drives the iOS Simulator
  through `xcrun simctl` — screenshots, taps, swipes, opening URLs/deep links,
  light/dark appearance, status-bar overrides, and device boot/shutdown.

[1.1.0]: https://github.com/miccou/simulator-mcp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/miccou/simulator-mcp/releases/tag/v1.0.0
