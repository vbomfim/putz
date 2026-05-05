# Changelog

All notable changes to **Putz** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.1] — 2026-05-05

### Fixed
- **Copilot CLI detection on Windows (and other platforms with PATH-inheritance quirks)** — Putz was probing `gh copilot --version`, but the swarm integrates with the **standalone `copilot` CLI** (`~/.copilot/`), not the `gh copilot` gh-extension. Detection now runs `copilot --version`. On Windows, when the bare-name PATH lookup fails (GUI processes inherit System PATH only, but the `copilot` installer often only updates User PATH), Putz also probes common install locations under `%LOCALAPPDATA%\Programs\` and `%ProgramFiles%\` before reporting "not detected".
- Spawn palette default entry renamed from "Spawn: gh copilot" to "Spawn: copilot" with the correct executable.
- Settings card now says "Copilot CLI detected/not detected" (was incorrectly "GitHub Copilot CLI"). Docs link points to the standalone Copilot CLI page.

### Notes
- Internal API renames: `gh_copilot_available` → `copilot_available`, `DEFAULT_SPAWN_GH_COPILOT` → `DEFAULT_SPAWN_COPILOT`, `probe_gh_copilot` → `probe_copilot`. No user-facing impact.

## [0.5.0] — 2026-05-04

### Added — Swarm: Putz ↔ Copilot CLI integration

End-to-end multi-agent coordination across `gh copilot` sessions running in Putz tabs. Designed for users running multiple Copilot agents in the same dev environment that share resources (deploys, git worktrees, env locks).

- **Local IPC transport** — Unix domain socket on macOS/Linux, Windows named pipe. `chmod 600` / current-user-only DACL. No HTTP, no network, no broker process. (T1 / #145)
- **Bundled Copilot CLI extension** at `extensions/copilot-swarm/` — installs into `~/.copilot/extensions/putz-colleague/` via Settings → Copilot Integration → Install. Auto-loads in every `gh copilot` session inside a Putz tab via `@github/copilot-sdk`'s `joinSession` hook. (T2 / #156)
- **Per-colleague status projection** from OSC 133 prompt boundaries + OSC 7 cwd updates. Dual projection: TS selector for ≤16 ms local UI latency, Rust `RosterUpdate` mirror for peer visibility. (T3 / #155)
- **Swarm UX surface** — collapsible sidebar (left/right/hidden), per-tab notification rings (urgent/normal/ambient), `Cmd+J` inbox panel, `Cmd+K` spawn palette with `.putz/spawn.json` recipe support. (T4 / #157)
- **Coordination tools** — 7 tools the Copilot agent can call to coordinate:
  - `swarm_claim(resource, ttl_minutes, message)` — acquire a named lock (e.g., `deploy-prod`, `git-worktree`) with TTL
  - `swarm_release(resource)` — release early
  - `swarm_check(resource)` — see who holds a resource
  - `swarm_list_claims()` — list all active claims
  - `swarm_send(target, message)` — acknowledged direct message to a peer
  - `swarm_broadcast(message, severity)` — message all peers
  - `swarm_status()` — human-readable swarm summary
- **Per-prompt context injection** — every user prompt is automatically prefixed with a `<swarm-context>` block listing active peers, claims (with TTL countdown), and unread peer messages, so the agent decides about freezes/coordination without surprise.
- **`copilot-instructions.snippet.md`** — drop-in instructions to teach the agent the claim → work → release pattern. Paste into your project's `.github/copilot-instructions.md`.
- **Settings → Copilot Swarm** card: enable swarm, sidebar position, install/reinstall/uninstall the extension.

### Removed
- **Command Templates** panel and `Ctrl+Shift+T` shortcut.
- **Command History** panel and `Ctrl+R` shortcut.
- Tauri IPC commands: `template_list`, `template_get`, `template_create`,
  `template_delete`, `template_execute`, `history_add`, `history_search`,
  `history_get_recent`, `history_clear`.
- Cargo dependency: `rusqlite` (templates/history were the sole consumers).
- Frontend modules `src/components/Templates/` and `src/components/History/`
  and the `addTemplateTab` / `addHistoryTab` `layoutStore` actions.

### Migration
- Schema bump **v1 → v2** — legacy `templates` / `history` tabs are
  auto-removed from persisted regions on first launch.
- Auto-cleanup of legacy localStorage keys (`putz-history`, `putz-templates`,
  `putz-command-history`, `putz-command-templates`) on every launch
  (idempotent sweep, defense-in-depth).

### Privacy
- Frame payloads, claim messages, send/broadcast messages, inbox entries — all classified Tier-2 PII per spec PRI-002. Never logged, never persisted to disk, never transmitted off-host. In-memory only; cleared on shutdown.
- Unicode bidi/zero-width-space characters stripped from peer messages (Trojan-Source CVE-2021-42574 defense for messages flowing into LLM context).

### Notes
- **On-disk legacy artifacts** (`~/Library/Application Support/putz/command_history.db`
  on macOS, `~/.config/putz/command_history.db` on Linux, `%APPDATA%\putz\command_history.db`
  on Windows; plus the `templates/` directory next to it) are **not auto-deleted**
  in this release — single-user dev environment, acceptable per user. Delete
  manually if desired:
  ```sh
  # macOS
  rm -rf ~/Library/Application\ Support/putz/command_history.db* \
         ~/Library/Application\ Support/putz/templates
  # Linux
  rm -rf ~/.config/putz/command_history.db* ~/.config/putz/templates
  ```

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
