# Changelog

All notable changes to **Putz** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] — 2026-05-02

### BREAKING CHANGES

This release removes all remote connection features. Putz is now a **local-only developer terminal** with Canvas and Git Graph tabs.

**Removed features (and their on-disk data):**

- SSH client (`russh` integration, key management, known_hosts, port forwarding)
- Telnet client
- Serial port support
- SFTP file browser
- Credential vault (OS keyring storage)
- Saved-connection session manager + import/export
- Quick Connect dialog
- Autologin profiles
- Session-to-file logging
- Compliance / change-window enforcement
- Network engineering tools: Ping Dashboard, ConfigDiff, InterfaceStatus, MacArpViewer, Backup
- ChatView (structured command/response view)
- Scripting `putz.vault.get()` API (removed from engine + autocomplete)

**Stale on-disk data**

Existing installations may have data left behind in the following locations. Putz no longer reads or writes these — they are safe to leave in place, or you can clean them up manually:

| Location | What it contains | How to remove |
|---|---|---|
| OS Keyring (service: `"putz"`) | Saved credentials | macOS: `security delete-generic-password -s "putz"` · Windows: Credential Manager → search "putz" → delete · Linux: `secret-tool clear service putz` |
| `~/.config/putz/sessions.json` | Saved hostnames, usernames | `rm ~/.config/putz/sessions.json` (Win: `%APPDATA%\putz\sessions.json`) |
| `~/.config/putz/vault-index.json` | Credential metadata (no secrets) | `rm ~/.config/putz/vault-index.json` |
| `~/.config/putz/autologin.json` | Autologin profiles | `rm ~/.config/putz/autologin.json` |
| `~/.config/putz/known_hosts` | SSH server fingerprints | `rm ~/.config/putz/known_hosts` |
| `~/putz-logs/*.log` | Historical terminal session output (may contain typed passwords) | `rm -rf ~/putz-logs/` |
| `~/putz-backups/*.txt` | Saved network device configs | `rm -rf ~/putz-backups/` |

For Windows, paths are typically under `%APPDATA%\putz\` and `%USERPROFILE%\putz-logs\`.

### Removed

- ~39,000 LOC of remote-connection code (frontend + backend) across ~183 files
- 9 Cargo dependencies: `russh`, `russh-keys`, `russh-sftp`, `serialport`, `keyring`, `zeroize`, `sha2`, `socket2`, `async-trait`
- 60 backend IPC commands deregistered
- 13 frontend component directories removed
- Entire Session menu removed; File menu trimmed (Quick Connect, Import/Export Sessions); Tools menu trimmed (Ping Dashboard)

### Internal

- Scripting engine simplified — `putz.send()`, `putz.tab.*`, `putz.terminal.*`, `putz.notify`, etc. all intact
- Swarm (AI-agent coordination), Highlight engine, Templates, History, Bookmarks, Broadcast, Canvas, Git Graph all unchanged

### Migration

No automated migration. The app silently ignores stale on-disk data on launch.
See the stale data table above for manual cleanup commands.

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
