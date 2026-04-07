# Changelog

All notable changes to **Putz** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Auto-update checker with in-app notification (Update Now / Later / Skip)
- GitHub Actions release workflow for cross-platform builds
- Version bump script (`npm run version:bump`)
- Platform-specific installers: MSI (Windows), DMG (macOS), AppImage/DEB (Linux)

## [0.1.0] — 2024-12-01

### Added

- **Terminal Emulator Core** (#3) — xterm.js integration with PTY backend, WebGL renderer, Unicode 11 support
- **Session Manager** (#4) — saved profiles, folders, search, import/export
- **Tabbed & Split-Pane UI** (#5) — drag-to-reorder tabs, horizontal/vertical splits, recursive layout
- **Telnet Protocol** (#7) — Telnet client with IAC negotiation, NAWS, echo suppression
- **Serial Protocol** (#8) — serial port support with configurable baud rate, data bits, parity, flow control
- **Credential Vault** (#9) — OS-native secure credential storage (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- **Keyword Highlighting** (#10) — rule engine with regex/plain-text matching, preset themes (Cisco, Linux), custom highlight sets
- **SSH Protocol** (#11) — russh-based SSH client, password/key auth, known hosts verification, agent forwarding
- **SFTP File Transfer** (#11) — remote file browser, upload/download, rename, delete, mkdir
- **Session Logging** (#30) — start/stop/status log controls per session

### Infrastructure

- Tauri 2.0 + React 19 + TypeScript project scaffolding
- CI pipeline: lint (ESLint + Prettier + Clippy + rustfmt), test (Vitest + Cargo test), build matrix (Linux, macOS, Windows)
- Security audit (cargo-audit) in CI
- Comprehensive test suite: unit tests, contract tests, integration tests, edge-case tests, accessibility tests
