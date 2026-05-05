# Putz

**A modern, cross-platform local developer terminal** — Windows, macOS, Linux. Built with Tauri, React, and Rust.

Putz is a terminal first. On top of that base it bundles the productivity surfaces that usually pull you out of a terminal — diagrams, git history, file editing — and one feature you won't find elsewhere: a local **swarm** so multiple AI coding agents on the same machine can see each other and coordinate.

---

## Features

### Terminal core

- **Cross-platform PTYs** via `portable_pty` — same behaviour on Windows, macOS, Linux
- **xterm.js renderer** with proper bracketed paste and a custom OSC parser
- **Tabs** with drag-to-reorder, close, and per-tab title
- **Splits** — horizontal and vertical, recursive layout (split a split a split)
- **Workspaces** — save and switch between named layouts
- **Broadcast bar** — type once, send the input to N panes simultaneously
- **Bookmarks** — quick-access bar + panel for `cd`-ing to common dirs
- **Themes, fonts, key bindings** — fully customizable; preset themes included
- **Keyword highlighting** — regex-based, preset themes for log scanning

### Modern terminal protocols

- **OSC 7** — accurate cwd reporting per shell (no more PEB hacks)
- **OSC 133** — prompt boundaries with handshake gating; per-command exit-code dots; right-click previous-command navigation
- **Shell integration installer** — one-click setup for bash / zsh / fish / pwsh + cmd.exe registry helper, with preview + uninstall

### Built-in tabs beyond the terminal

- **Canvas tab** — infinite Excalidraw-style canvas for architecture diagrams, mind maps, scratch thinking — alongside your terminals, persisted with the workspace
- **Git Graph tab** — branch visualization, commit history, per-file diffs over the current repo
- **Editor tabs** — Monaco-based file editor for quick edits without context-switching
- **Settings tab** — themes, fonts, key bindings, shell integration, swarm, Copilot integration

### Scripting

- **Script editor + runner** — write a snippet once, send it to a target PTY (record / save / replay)

### Swarm — multi-agent coordination

Local-only multi-agent collaboration for AI coding sessions:

- **Bundled Copilot CLI extension** auto-installs into `~/.copilot/extensions/putz-colleague/`. Loads automatically in every `copilot` session inside a Putz tab.
- **7 coordination tools** the agent can call: `swarm_claim` / `swarm_release` / `swarm_check` / `swarm_list_claims` / `swarm_send` / `swarm_broadcast` / `swarm_status`.
- **Per-prompt `<swarm-context>` injection** — every user prompt is prefixed with active peers, claims (with TTL), and unread peer messages.
- **Sidebar** with per-colleague status (idle / running / done / error from OSC 133), cwd, heartbeat, exit-code dots, last notification preview.
- **Tab notification rings** — colored dots for unread peer messages (urgent / normal / ambient).
- **`Cmd+J` Inbox** — unified message panel.
- **`Cmd+K` Spawn Palette** — quick-spawn from `.putz/spawn.json` recipes.
- **`copilot-instructions.snippet.md`** — drop-in agent instructions.

Architecture: Unix domain socket (macOS/Linux) / Windows named pipe, `chmod 600`, current-user-only DACL. Length-prefixed JSON wire format. No broker, no network, no cloud. Same machine, same user only.

### App platform

- **Cross-platform builds** — DMG (macOS), MSI (Windows), AppImage + .deb (Linux)
- **Auto-update** — built-in via `tauri-plugin-updater`; in-app **Update Now / Later / Skip**
- **Single binary** per platform (no runtime dependencies for end users)

---

## Quickstart

### Install

Download the installer for your platform from [Releases](https://github.com/vbomfim/putz/releases), or build from source:

```bash
git clone https://github.com/vbomfim/putz.git
cd putz
npm install
npm run dev          # dev mode with hot reload
# or
npm run build        # production bundle in src-tauri/target/release/bundle/
```

### Try the swarm (optional)

```bash
# 1. In Putz: Settings → Copilot Swarm → toggle Enable + Install extension
# 2. Teach your agents to use the swarm tools:
mkdir -p .github
cat ~/.copilot/extensions/putz-colleague/copilot-instructions.snippet.md \
  >> .github/copilot-instructions.md
# 3. Open two Putz tabs, run `copilot` in each
```

---

## Tech stack

| Layer       | Tech                                                    |
|-------------|---------------------------------------------------------|
| App shell   | Tauri 2.x (Rust + React + TypeScript)                   |
| Terminal    | xterm.js + portable_pty                                 |
| Editor      | Monaco                                                  |
| Canvas      | Excalidraw-style engine                                 |
| Swarm IPC   | `interprocess` crate (Rust) + `net.connect({path})` (Node) |
| Build       | Vite + Cargo                                            |
| Test        | Vitest + `cargo test` + `node --test`                   |
| Lint        | ESLint + Prettier + clippy + rustfmt                    |

---

## Prerequisites (build from source)

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) latest stable
- [Tauri 2 platform prerequisites](https://tauri.app/start/prerequisites/)
- [Copilot CLI](https://docs.github.com/en/copilot/github-copilot-in-the-cli) — optional, for swarm

---

## Scripts

```bash
npm run dev                       # dev mode with hot reload
npm run build                     # production bundle
npm test                          # frontend + backend tests
npm run test:frontend             # Vitest only
npm run test:backend              # cargo test only
npm run lint / lint:fix           # ESLint
npm run format / format:check     # Prettier
npm run version:bump -- --minor   # sync version across package.json, Cargo.toml, tauri.conf.json

# Bundled extension tests:
node --test extensions/copilot-swarm/tests/*.test.mjs
```

---

## Project layout

```
putz/
├── src/                            # React frontend
│   ├── components/
│   │   ├── Terminal/               # xterm.js + PTY + OSC parser
│   │   ├── Canvas/                 # infinite canvas
│   │   ├── GitGraph/               # commit graph + diff viewer
│   │   ├── Swarm/                  # sidebar, inbox, spawn palette
│   │   └── Settings/
│   ├── hooks/, lib/, stores/
├── src-tauri/                      # Rust backend
│   └── src/
│       ├── pty/                    # portable_pty wrapping
│       ├── swarm/                  # coordinator, socket, wire
│       ├── ipc/                    # Tauri command handlers
│       └── theme/, highlight/, …
├── extensions/copilot-swarm/       # Bundled Copilot CLI extension
├── specs/                          # Spec Kit-compatible feature specs
├── scripts/                        # version-bump, perf measurement
└── .github/workflows/              # CI + release builds
```

---

## Cutting a release

```bash
npm run version:bump -- --minor              # or --patch / --major / explicit 1.2.3
git add -A && git commit -m "chore: release vX.Y.Z"
git tag -a vX.Y.Z -m "vX.Y.Z release notes one-liner"
git push origin main --tags
```

The [`release.yml`](.github/workflows/release.yml) workflow triggers on the tag, builds for all three platforms, and uploads artifacts to a GitHub Release. Auto-update notifies users on next launch.

Releases are currently **unsigned**. macOS Gatekeeper requires right-click → Open on first launch. Code signing setup is documented in `tauri.conf.json` comments.

---

## Privacy

Swarm message content (claim messages, send/broadcast text, inbox entries, peer notifications) is treated as **Tier-2 PII** end-to-end:

- Never written to disk
- Never logged to stderr / tracing
- Never transmitted off-host (the socket / pipe is local-only)
- Cleared from memory on shutdown
- Unicode bidi / zero-width-space chars stripped from peer messages (Trojan-Source CVE-2021-42574 defense for content flowing into LLM prompt context)

Full model: [`specs/putz-copilot-swarm/spec.md`](specs/putz-copilot-swarm/spec.md) sections PRI-001 / PRI-002.

---

## Contributing

PRs welcome. The codebase has a "Guardian" SDLC pipeline (PO → Developer → QA + Security + Privacy + Code Review × 2 in parallel) — most non-trivial PRs run through it before merge. See `.github/instructions/`.

---

## License

MIT — see [LICENSE](LICENSE).
