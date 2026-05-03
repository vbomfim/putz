> # ⚠️ SUPERSEDED
>
> **This spec has been superseded by [`specs/putz-copilot-swarm/spec.md`](../../putz-copilot-swarm/spec.md).**
>
> The Swarm v2 design below was scoped as a vendor-neutral, multi-language, public open standard with an HTTP broker, bearer-token auth, SSE, and reference SDKs across npm/PyPI/crates.io. After implementation began, the user clarified that the *only* in-scope integration is **Putz ↔ GitHub Copilot CLI** on the same machine, same user. Vendor neutrality, multi-language SDKs, the HTTP broker, the public protocol, and the cross-network trust model are all explicitly out of scope.
>
> The replacement spec collapses the design to: a Unix-socket / Windows-named-pipe IPC between Putz (Tauri/Rust host) and Copilot CLI extensions (Node) running inside Putz tabs. The UX layer (notification rings, Cmd+J inbox, Cmd+K spawn palette, sidebar colleague rows, OSC 133-derived status) survives intact and was the well-decided part of this document.
>
> Epic [#127](https://github.com/vbomfim/putz/issues/127) and tickets W1–W9 (#129–#137) were closed as superseded when the new spec landed. This file is retained for historical context — *why* the over-engineering was abandoned — and should not be implemented from.

---

# Feature Specification: Swarm Protocol v2 — Open Multi-Agent Terminal Protocol

**Feature Branch**: `docs/spec-swarm-v2`
**Created**: 2026-05-03
**Status**: Superseded — see top of file
**Input**: Redesign of the Putz Swarm subsystem from Phase 1 HTTP-only broker to an open, vendor-neutral multi-agent terminal protocol.

**Owner**: PO Guardian via Copilot
**Last updated**: 2026-05-03
**Issue tracker**: [Epic #127](https://github.com/vbomfim/putz/issues/127)
**Version**: 0.1.0
**Tickets**: [To be created during decomposition — each ticket references this spec]

---

## Strategic Positioning

Putz's competitor in this space is [cmux](https://github.com/manaflow-ai/cmux)
— a polished native macOS terminal built on Ghostty/libghostty that ships
**Claude Code Teams**: a Claude-specific multi-agent feature with native splits,
sidebar metadata, notification rings, and a scriptable CLI/socket API.

cmux is impressive UX-wise but **Anthropic-coupled** and **macOS-only**. Its
design philosophy is "a terminal and browser with a CLI, and the rest is up to
you" — composable primitives, not an opinionated orchestrator.

**Putz Swarm v2** should be positioned as **"the open multi-agent terminal
protocol — vendor-neutral, cross-platform, documented wire format."** cmux =
polished proprietary Claude path. Putz = the open standard that Copilot CLI,
Claude Code, Gemini CLI, custom scripts, and in-house agents all plug into.

The differentiator is **openness, not polish**: a published wire format with
three reference SDK packages (npm, PyPI, crates.io), a conformance test suite,
and cross-platform support (macOS / Linux / Windows). Any AI CLI that reads 3
env vars and makes 2 HTTP calls can join the swarm in < 50 LOC.

---

## User Scenarios & Testing

### User Story 1 — Zero-Config Colleague Detection (Priority: P1)

As a developer, I install Putz, open a tab, run `gh copilot` (or `claude` or
`gemini`), and within 2 seconds the tab shows a "colleague" badge with the
agent's session info — without any configuration.

**Why this priority**: The core value proposition. If agent detection doesn't
"just work," nothing else matters. This is the first-run experience.

**Independent Test**: Open a fresh Putz tab, run `gh copilot` with the Swarm
extension installed. Verify the tab badge appears within 2 seconds displaying
the agent name and "idle" status.

**Acceptance Scenarios**:

1. **Given** Putz is running with Swarm enabled, **When** the user opens a new
   tab and runs an AI CLI that has the `@putz/swarm-client` integration,
   **Then** the PTY env injection provides `PUTZ_SWARM_URL`, `PUTZ_SWARM_TOKEN`,
   and `PUTZ_TAB_ID`, and the agent auto-registers within 2s.
2. **Given** a registered agent in tab A, **When** the user opens tab B and runs
   another AI CLI, **Then** both tabs show colleague badges and each agent's
   roster includes the other.
3. **Given** an agent registered via Unix socket (local fast-path), **When** the
   agent sends a heartbeat, **Then** round-trip latency is <1ms (vs ~10ms for
   HTTP on the same machine).

---

### User Story 2 — Trust-Gated External Registration (Priority: P1)

As a security-aware user, when an unknown agent (not spawned by Putz) tries to
register with the swarm, I get a UI prompt and can deny it.

**Why this priority**: Security is table-stakes. The trust model must be in
place before multi-agent features are usable in any professional context.

**Independent Test**: Start a standalone script that sends a registration request
to the Swarm broker. Verify a trust prompt appears in Putz's UI. Click "Deny"
and verify the registration is rejected with 403.

**Acceptance Scenarios**:

1. **Given** Putz Swarm is running, **When** an agent spawned by Putz (via
   Cmd+K or `swarm_spawn`) attempts to register, **Then** registration succeeds
   immediately via the env-injected one-time token — no prompt shown.
2. **Given** Putz Swarm is running, **When** an external process sends a
   registration request using a manually-obtained token (e.g., from a script),
   **Then** a UI prompt appears: "Agent 'foo' wants to join the swarm.
   [Allow] [Deny] [Always allow this name]".
3. **Given** the user clicks "Always allow this name," **When** the same agent
   name registers again in a future session, **Then** registration succeeds
   without a prompt.
4. **Given** the user navigates to Settings → Swarm → Trusted Agents, **When**
   they view the list, **Then** they can revoke any "always allow" entry.

---

### User Story 3 — Pane Notification Rings (Priority: P2)

As a developer running 3 AI agents in split panes, I can see at a glance which
agent has new output or needs attention — a colored ring appears on the tab/pane
border when there's unread activity.

**Why this priority**: Multi-agent is useless without attention management.
This is the #1 cmux feature to match. Without it, users must constantly check
each pane manually.

**Independent Test**: Open 3 tabs with registered agents. Focus tab 1. Have
agent in tab 2 produce output. Verify tab 2's tab bar entry shows a
notification ring. Focus tab 2 and verify the ring clears.

**Acceptance Scenarios**:

1. **Given** an agent in an unfocused tab, **When** the agent produces PTY
   output, **Then** the tab shows a colored notification ring (matching Putz's
   existing tab indicator style, reference: cmux's
   `docs/assets/notification-rings.png`).
2. **Given** an agent emits a `notify` event via the Swarm protocol, **When**
   the tab is unfocused, **Then** the ring appears with the event's severity
   color (urgent = red, normal = blue, ambient = subtle).
3. **Given** a tab with an active notification ring, **When** the user focuses
   that tab, **Then** the ring clears.

---

### User Story 4 — Cmd+J Inbox Modal (Priority: P2)

As a developer, I press Cmd+J and see a list of all colleagues with unread
output/notifications, sorted by recency. Clicking an entry jumps to that tab.

**Why this priority**: Aggregated notification view is essential for >2 agents.
cmux reference: "Notification panel — see all pending notifications in one
place, jump to most recent unread."

**Independent Test**: Run 3 agents. Have 2 produce unread output while focus
is on the 3rd. Press Cmd+J. Verify the inbox shows 2 entries sorted by
recency. Click one. Verify it jumps to the correct tab and marks it as read.

**Acceptance Scenarios**:

1. **Given** 3 registered colleagues, 2 with unread output, **When** the user
   presses Cmd+J (macOS) or Ctrl+J (Windows/Linux), **Then** the inbox modal
   opens showing the 2 unread entries, most recent first.
2. **Given** an inbox entry for agent "claude," **When** the user clicks it,
   **Then** Putz focuses the tab containing that agent.
3. **Given** an inbox entry, **When** the user focuses the corresponding tab
   (either via click or Cmd+J), **Then** the entry is marked as read and
   removed from the inbox on next open.
4. **Given** the inbox is open, **When** the user presses Escape, **Then** the
   modal closes without changing focus.

---

### User Story 5 — Sidebar Colleague Rows (Priority: P2)

As a developer, I can see per-colleague metadata in the sidebar: cwd, last
message preview, exit-code dot stream for the last 10 commands, and heartbeat
status badge.

**Why this priority**: Persistent metadata visibility is the second-most
valuable cmux pattern. The sidebar replaces the need to focus each tab to check
agent status. Reference: cmux's vertical sidebar showing "git branch, linked
PR status/number, working directory, listening ports, and latest notification
text."

**Independent Test**: Open a tab with a registered agent. Verify the sidebar
shows the agent's cwd, a "last message" preview, and a heartbeat badge. Run
5 commands in the agent's tab. Verify the exit-code dot stream shows 5 dots
with correct colors.

**Acceptance Scenarios**:

1. **Given** a registered colleague, **When** the sidebar is visible, **Then**
   the colleague row shows: name, cwd (from `cwdRegistry` via OSC 7 — S2),
   heartbeat status badge (Active/Stale/Dead from Swarm broker sweep), last
   Swarm message preview (first 80 chars), and the last 10 exit-code dots
   (from `commandBlockStore` — S4/S5).
2. **Given** the colleague's cwd changes, **When** the OSC 7 update arrives,
   **Then** the sidebar row updates within 1 frame.
3. **Given** a colleague transitions from Active to Stale (60s no heartbeat),
   **When** the sweeper runs, **Then** the badge updates to yellow "Stale."

---

### User Story 6 — Cmd+K Spawn Command Palette (Priority: P2)

As a developer, I press Cmd+K and can spawn a new agent from auto-discovered
AI CLIs or project-specific recipes.

**Why this priority**: Spawn ergonomics make the difference between "can do
multi-agent" and "wants to do multi-agent." cmux reference: "Custom commands —
Define project-specific actions in `cmux.json` that launch from the command
palette."

**Independent Test**: Press Cmd+K. Verify the palette shows auto-discovered
CLIs (e.g., `gh copilot`, `claude`) from PATH. Add a `.putz/spawn.json` with
a "review" recipe. Reopen the palette. Verify "Spawn: review" appears. Select
it. Verify a new tab opens with the recipe's command and env vars.

**Acceptance Scenarios**:

1. **Given** `claude` is in PATH, **When** the user opens Cmd+K and types
   "spawn," **Then** the palette shows "Spawn: claude" as an option.
2. **Given** `.putz/spawn.json` contains
   `{"recipes": [{"name": "review", "cmd": "claude", "args": ["--workdir", "."], "env": {"REVIEW_MODE": "1"}}]}`,
   **When** the user selects "Spawn: review," **Then** a new tab opens running
   `claude --workdir .` with `REVIEW_MODE=1` and swarm env vars injected.
3. **Given** the user selects a spawn action, **When** the tab opens, **Then**
   the new process auto-registers as a colleague within 2s and Swarm env vars
   are injected into the PTY.

---

### User Story 7 — First-Run AI CLI Auto-Detection Wizard (Priority: P3)

As a new user, when I first open Settings → Shell Integration, Putz scans my
PATH for known AI CLIs and offers to install Swarm integration for each.

**Why this priority**: Lowers the barrier to entry. Without this, users must
manually learn about the Swarm protocol and install extensions. cmux reference:
"Browser import" concept translated to the AI CLI domain.

**Independent Test**: On a fresh install with `gh copilot` and `claude` in
PATH, open Settings → Shell Integration. Verify both CLIs appear with "Install
Swarm integration" buttons. For CLIs not in the known list, verify a
"Documentation: build your own agent" link is shown.

**Acceptance Scenarios**:

1. **Given** first launch of Settings → Shell Integration, **When** the Swarm
   section is visible, **Then** Putz scans PATH for known AI CLIs (`gh copilot`,
   `claude`, `gemini`, `ollama`) and shows a card per detected CLI.
2. **Given** a detected CLI, **When** the user clicks "Install Swarm
   integration," **Then** the appropriate SDK wrapper is installed/configured.
3. **Given** an unknown CLI, **When** the user clicks "Custom agent," **Then**
   Putz opens a link to the public protocol documentation + SDK repos.

---

### User Story 8 — Derived Status via OSC 133 (Priority: P1)

As a developer, I see per-colleague status in the sidebar that is derived from
actual command execution (via OSC 133 command boundaries), not from agents
pushing status manually.

**Why this priority**: Eliminates a class of protocol complexity. Today's Swarm
mixes coordination messages with status messages. OSC 133 already tracks
command boundaries and exit codes — the Swarm should consume that data, not
duplicate it.

**Independent Test**: Run a command in an agent's tab. Verify the
`/colleagues/{id}/status` endpoint returns the last command's exit code and cwd
without the agent explicitly pushing that information.

**Acceptance Scenarios**:

1. **Given** a registered colleague in tab A with shell integration active,
   **When** the agent runs a command that exits with code 1, **Then** the
   `commandBlockStore` records the exit code via OSC 133 D marker, and
   `GET /swarm/colleagues/{id}/status` returns
   `{"last_exit_code": 1, "cwd": "/current/dir", "heartbeat": "active"}`.
2. **Given** the Swarm `messages` endpoint, **When** an agent sends a message,
   **Then** the message body is used for explicit cross-agent coordination only
   (e.g., "@bob check this PR") — not for status reporting.
3. **Given** a colleague without shell integration (no OSC 133 handshake),
   **When** the status endpoint is queried, **Then** it falls back to
   heartbeat-only status (`{"heartbeat": "active", "last_exit_code": null}`).

---

### User Story 9 — Third-Party Agent in < 50 LOC (Priority: P1)

As an agent developer, I can write a swarm-aware agent that registers, sends
heartbeats, and receives messages in < 50 lines of code using one of the
three reference SDKs.

**Why this priority**: This is the "open standard" promise. If third-party
adoption requires > 50 LOC, the protocol is too complex.

**Independent Test**: Write a Python script using `putz-swarm-client` that
registers, sends one heartbeat, queries the roster, and deregisters. Verify
it is < 50 LOC and works without reading any source code beyond the SDK's
README.

**Acceptance Scenarios**:

1. **Given** the npm package `@putz/swarm-client`, **When** a developer writes
   `const client = createSwarmClient(); await client.register(); ...`,
   **Then** the agent is visible in the Putz roster within 2s.
2. **Given** the protocol spec at `specs/swarm-protocol/spec.md`, **When** a
   developer reads the "Wire Format" section, **Then** they can implement
   registration in any language without the SDK — the HTTP/JSON endpoints are
   fully documented.
3. **Given** the conformance test suite at `tests/swarm-protocol-conformance/`,
   **When** a third-party client runs the tests against Putz's broker, **Then**
   all tests pass if the client correctly implements the protocol.

---

### Edge Cases

- **Socket path collision on shared dev machines**: Two users running Putz on
  the same machine with the same port could collide on the Unix socket path.
  Mitigation: include PID + random suffix in socket path.
- **Agent crashes without deregistering**: The stale sweeper (60s → Stale, 300s
  → Dead) handles this, same as Phase 1. Socket transport adds immediate
  disconnect detection (EOF on socket read).
- **Rapid tab open/close**: Tab opens, agent starts registering, tab closes
  before registration completes. The `deregister_by_tab` cleanup already handles
  this via the `swarm://tab-closed` lifecycle event (Phase 2 wiring).
- **Windows named pipe permissions**: Named pipes on Windows have ACL semantics.
  Putz must create the pipe with the current user's SID only — no "everyone"
  access.
- **Protocol version mismatch**: An old agent tries to connect to a new broker
  (or vice versa). Capability negotiation must reject unsupported versions
  gracefully with a clear error message.
- **Concurrent registration from same colleague ID**: Two processes with the
  same env vars (e.g., user duplicates a tab). Second registration should
  replace the first (idempotent, already implemented in Phase 1).
- **OSC 133 not available**: Agent runs in a tab without shell integration. The
  status endpoint gracefully degrades to heartbeat-only data.

---

## Requirements

### Functional Requirements

#### FR-Transport — Socket + HTTP Dual Transport

- **FR-001**: System MUST support Unix domain socket transport on macOS/Linux
  and named pipe transport on Windows as the primary low-latency path for
  agents spawned by Putz.
- **FR-002**: System MUST retain the existing HTTP transport (Axum on
  `127.0.0.1:0`) as the cross-network / external-agent fallback.
- **FR-003**: Socket path convention MUST be:
  - Unix: `/tmp/putz-swarm-<port>-<pid>-<random>.sock`
  - Windows: `\\.\pipe\putz-swarm-<username>-<port>`
    where `<username>` is the current OS user (via `whoami::username()` or
    `std::env::var("USERNAME")`). Including the username prevents cross-user
    collisions on shared Windows machines. The pipe name omits PID/random to
    stay within the 256-char limit and because Windows DACL (user-SID-only)
    provides the isolation that Unix socket permissions (`0700`) provide on
    Unix.
  where `<port>` is the HTTP server port, `<pid>` is the Putz process ID, and
  `<random>` is a 6-character hex suffix to prevent collisions (Unix only).
- **FR-004**: Socket framing MUST use length-prefixed JSON: 4-byte big-endian
  `u32` frame length followed by a UTF-8 JSON payload. Maximum frame size:
  64 KiB (consistent with existing HTTP body limit).
- **FR-005**: Agents spawned by Putz MUST receive `PUTZ_SWARM_SOCKET` env var
  pointing to the socket path, in addition to `PUTZ_SWARM_URL` and
  `PUTZ_SWARM_TOKEN`. Agents that detect `PUTZ_SWARM_SOCKET` SHOULD prefer it
  over HTTP.
- **FR-006**: Socket and HTTP transports MUST share the same JSON message schema
  — the wire format is transport-agnostic. Only the framing layer differs.
- **FR-007**: System MUST implement capability negotiation on socket connect:
  client sends `{"protocol": "putz-swarm", "version": "0.1.0", "capabilities": ["socket"]}`;
  server responds with `{"ok": true, "version": "0.1.0", "capabilities": ["socket", "http"]}`.
  Incompatible versions MUST be rejected with
  `{"ok": false, "error": "unsupported_version", "min_version": "0.1.0"}`.
- **FR-008**: Socket connections MUST be authenticated via the same bearer token
  used for HTTP. The first frame after connect MUST be an auth frame:
  `{"type": "auth", "token": "<bearer_token>"}`. Server responds with
  `{"type": "auth_ok"}` or `{"type": "auth_fail", "error": "unauthorized"}`.

#### FR-Trust — Two Trust Tiers

- **FR-010**: **Tier 1 (Spawned-by-Putz)**: Agents spawned by Putz (via Cmd+K
  palette, `swarm_spawn` tool, or future APIs) MUST receive a one-time-use token
  via `PUTZ_SWARM_TOKEN` env var and auto-register without any user prompt.
- **FR-011**: **Tier 2 (External)**: Agents not spawned by Putz that attempt to
  register MUST trigger a UI prompt: "Agent '[name]' wants to join the swarm.
  [Allow] [Deny] [Always allow this name]".
- **FR-012**: The "Always allow this name" persistence MUST be stored
  **per-machine** in the standard Tauri app config directory, under the settings
  key `swarm.trustedAgents` (array of agent name patterns). Per-machine scope
  matches the macOS Accessibility permission model — a user trusts an agent for
  their entire machine, not per-workspace. This simplifies the UI and avoids
  the "which workspace am I in?" confusion.
- **FR-013**: System MUST provide a Settings → Swarm → Trusted Agents panel
  where users can view and revoke "always allow" entries.
- **FR-014**: Trust-tier detection MUST use the registration request's origin:
  if the request arrives via a socket connection AND the socket path was only
  communicated via env injection, it is Tier 1. If it arrives via HTTP with a
  manually-obtained token, it is Tier 2.
- **FR-015**: Pattern reference: the OSC 133 handshake gating from S4 (#102 in
  epic #98). Same defense-in-depth philosophy — features unlock only after a
  trusted handshake. The trust prompt UX follows the same UX pattern as macOS
  Accessibility permission dialogs.

#### FR-Status — Derived from OSC 133, Not a Parallel Channel

- **FR-020**: The Swarm broker MUST expose a per-colleague status endpoint:
  `GET /swarm/colleagues/{id}/status`.
- **FR-021**: The status response MUST be derived, not pushed:
  - `last_exit_code`: from `commandBlockStore` (last completed `CommandBlock`
    for the colleague's session)
  - `cwd`: from `cwdRegistry` (last OSC 7 update for the session)
  - `heartbeat`: from the broker's stale sweeper (Active/Stale/Dead)
  - `last_command_at`: timestamp of the last OSC 133 D marker
- **FR-022**: The existing `POST /swarm/messages` endpoint MUST be reserved for
  explicit cross-agent coordination only. Status reporting via messages is
  deprecated.
- **FR-023**: For sessions without shell integration (no OSC 133 handshake), the
  status endpoint MUST gracefully degrade: `last_exit_code` and
  `last_command_at` return `null`, `cwd` falls back to the registered cwd,
  `heartbeat` remains functional.
- **FR-024**: Socket transport MUST support a `status` frame type that returns
  the same data as the HTTP endpoint, using the same JSON schema.

#### FR-Notifications — Pane Rings + Cmd+J Inbox

- **FR-030**: System MUST render a colored ring on tab bar entries for colleagues
  with unread PTY output (since the user last focused that tab).
- **FR-031**: Colleagues MAY emit a `notify` event via the protocol:
  `{"type": "notify", "from": "<id>", "severity": "urgent|normal|ambient", "body": "<text>"}`.
  This triggers a ring AND adds an entry to the Cmd+J inbox.
- **FR-032**: The Cmd+J modal MUST list all colleagues with unread
  notifications/output, sorted by recency (most recent first).
- **FR-033**: Each inbox entry MUST show: colleague name, timestamp, and a
  preview of the notification body (first 80 characters) or "New terminal
  output" for PTY-output-only notifications.
- **FR-034**: Clicking an inbox entry MUST focus the corresponding tab and mark
  the entry as read.
- **FR-035**: "Read" state MUST be per-session (clears when the Putz window
  session ends, not persisted to disk).
- **FR-036**: Ring visual style MUST be consistent with Putz's existing tab
  indicator style (see `RegionTabBar.tsx`). Colors: urgent = red, normal = blue
  (cmux reference: `docs/assets/notification-rings.png`), ambient = subtle/gray.

#### FR-Sidebar — Per-Colleague Rows

- **FR-040**: `RegionTabBar` MUST be extended (or a companion sidebar component
  created) to show per-colleague metadata rows when a tab hosts a registered
  colleague.
- **FR-041**: Each colleague row MUST display:
  - Agent name and heartbeat status badge (Active = green, Stale = yellow,
    Dead = red)
  - Current working directory (from `cwdRegistry` — S2)
  - Last Swarm message preview (first 80 chars, from Swarm message buffer)
  - Exit-code dot stream for the last 10 commands (from `commandBlockStore` —
    S5 reuse: same dot-rendering logic as `CommandGutter.tsx`)
- **FR-042**: Colleague rows MUST refresh on: OSC 7 CWD update, Swarm message
  receipt, OSC 133 D marker (command completion), sweeper status transition.
- **FR-043**: Refresh cadence for heartbeat badge: every 5 seconds (matching
  the sweeper interval).

#### FR-Spawn — Cmd+K Palette + .putz/spawn.json

- **FR-050**: The existing command palette (Cmd+K) MUST be extended with
  "Spawn: <agent>" actions. **Keybinding: smart-intercept** — Cmd+K is consumed
  by Putz ONLY when the terminal pane does NOT have focus (i.e., focus is on the
  tab bar, sidebar, or app chrome). When the terminal viewport has focus, Cmd+K
  passes through to the shell (e.g., zsh clear-screen). Implementation: subscribe
  to `document.activeElement` and check whether it's within a terminal viewport
  element before intercepting.
- **FR-051**: Auto-discovered agents MUST be populated by scanning PATH for
  known AI CLI binaries: `gh` (for `gh copilot`), `claude`, `gemini`, `ollama`.
  Discovery MUST run at most once per Putz session (cached in memory).
- **FR-052**: Project-local recipes MUST be loaded from `.putz/spawn.json` in
  the workspace root. Schema:
  ```json
  {
    "$schema": "https://putz.dev/schemas/spawn.json",
    "recipes": [
      {
        "name": "review",
        "cmd": "claude",
        "args": ["--workdir", "."],
        "env": {"REVIEW_MODE": "1"},
        "cwd": "."
      }
    ]
  }
  ```
- **FR-053**: Each spawn action MUST: (a) open a new tab, (b) inject Swarm env
  vars via the PTY, (c) execute the specified command. The new tab's process
  auto-registers as a colleague via the env-injected token.
- **FR-054**: The `.putz/spawn.json` schema MUST be published at
  `specs/swarm-protocol/spawn-schema.json` in the Putz repo.
- **FR-055**: When `.putz/spawn.json` recipe env vars conflict with
  Swarm-injected env vars (e.g., both define `PUTZ_SWARM_URL`), **Swarm env
  vars always win** — they are infrastructure. The spawn confirmation UI MUST
  show a warning: "Note: [VAR_NAME] was overridden by Swarm" for each
  overridden variable, so the user is aware of the precedence.

#### FR-Discovery — First-Run Wizard

- **FR-060**: The Settings → Shell Integration panel (S3 from epic #98) MUST
  include a "Swarm Agents" section that auto-detects known AI CLIs in PATH.
- **FR-061**: Each detected CLI MUST show a card with: name, path, version (if
  detectable), and an "Install Swarm integration" button.
- **FR-062**: For unknown CLIs, the panel MUST show a "Build your own agent"
  link pointing to the public protocol docs and SDK repos.
- **FR-063**: The wizard MUST run PATH scanning at most once per Settings open
  (not on every render).

#### FR-PublicAPI — Stable Wire Format

- **FR-070**: The Swarm protocol wire format (JSON schemas for registration,
  heartbeat, roster, messages, spawn, status, notify, focus, stream) MUST be
  documented in this spec and considered a public API surface.
- **FR-071**: Wire format changes MUST follow semver discipline:
  - Additive fields = minor version bump (backward compatible)
  - Removed/renamed fields = major version bump (breaking)
  - The `version` field in capability negotiation governs compatibility.
- **FR-072**: Three reference SDK packages MUST be published (separate
  implementation tickets, not in this spec's scope):
  - `@putz/swarm-client` (npm, TypeScript) — < 200 LOC
  - `putz-swarm-client` (PyPI, Python) — < 200 LOC
  - `putz-swarm-client` (crates.io, Rust) — < 200 LOC
- **FR-073**: The Copilot CLI extension in PR #126's `extensions/colleagues/`
  MUST be refactored to be a thin wrapper over `@putz/swarm-client`, not a
  bespoke implementation. The extension's `core.mjs` (~224 LOC) contains HTTP
  helpers, roster formatting, and heartbeat logic that belongs in the SDK.
- **FR-074**: A protocol conformance test suite MUST be created at
  `tests/swarm-protocol-conformance/` that any SDK or third-party client can
  run against a live Putz broker to verify correctness.

### Key Entities

- **Colleague**: A registered agent in the swarm. Fields: `id`, `name`,
  `parent`, `tab_id`, `pid`, `cwd`, `status`, `trust_tier`, `transport`
  (socket | http), `last_seen`, `registered_at`.
- **SwarmMessage**: An explicit cross-agent coordination message. Fields: `id`,
  `from`, `to`, `severity` (urgent | normal | ambient), `body`, `sent_at`.
- **ColleagueStatus** (derived): `last_exit_code`, `cwd`, `heartbeat`,
  `last_command_at`. Computed from `commandBlockStore` + `cwdRegistry` +
  sweeper — not stored as a first-class entity.
- **SpawnRecipe**: A project-local agent template from `.putz/spawn.json`.
  Fields: `name`, `cmd`, `args`, `env`, `cwd`.
- **TrustEntry**: An "always allow" persistence record. Fields: `name`,
  `created_at`, `scope` (per-machine | per-workspace — TBD).

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: User installs Putz, runs a Copilot CLI in a tab, and sees the
  colleague badge within 2 seconds — without any manual configuration. Measured
  by automated test: time from PTY spawn to colleague badge render < 2000ms.
- **SC-002**: Cmd+J inbox correctly aggregates notifications across N
  colleagues (N = 1..10). Verified by automated test: spawn N agents, trigger
  notifications from each, verify inbox shows N entries sorted by recency.
- **SC-003**: Spawning via Cmd+K + recipe creates a tab with correct env vars
  in < 1 second. Measured: time from palette selection to new tab's first prompt
  byte < 1000ms.
- **SC-004**: Public protocol is documented well enough that a third-party agent
  can implement registration in < 50 LOC. Verified: the conformance test suite
  includes a minimal reference client in each SDK language.
- **SC-005**: Trust prompt fires for any agent NOT spawned by Putz. Verified by
  automated test: external registration without Putz spawn → prompt fires.
  Internal spawn → no prompt.
- **SC-006**: Cross-platform: Swarm protocol works on macOS, Linux, and Windows.
  Verified by CI matrix: conformance tests run on all three platforms.
- **SC-007**: The spec cleanly supersedes PR #126's broker model. Verified:
  every feature in PR #126 (env injection, tab lifecycle, extension, trust model)
  has a corresponding FR in this spec, and the spec explicitly addresses the
  disposition of PR #126.
- **SC-008**: Socket transport latency is ≤ 1ms round-trip for heartbeats on
  localhost (vs. ~10ms for HTTP). Measured by benchmark test.
- **SC-009**: Protocol version negotiation correctly rejects mismatched versions
  with a clear error. Verified by conformance test.

---

## Assumptions

- **A-001**: Putz targets local developer workstations only — no remote/SSH
  multi-machine swarm (per #86 decommissioning decision). Cross-machine swarm
  is explicitly deferred (see Out of Scope).
- **A-002**: Epic #98 (Modern Terminal Protocols) is complete. The Swarm v2
  spec depends on `commandBlockStore`, `oscParser`, `cwdRegistry`, and the
  shell-integration install panel being in place.
- **A-003**: AI CLI agents (Copilot CLI, Claude Code, Gemini CLI) support
  extension/plugin mechanisms or can read env vars. The protocol's env-var-based
  bootstrap (`PUTZ_SWARM_URL`, `PUTZ_SWARM_TOKEN`, `PUTZ_TAB_ID`,
  `PUTZ_SWARM_SOCKET`) is the universal handshake.
- **A-004**: The Tauri 2.0 runtime supports Unix domain sockets (via tokio's
  `UnixListener`) on macOS/Linux and named pipes (via tokio's
  `windows::net::NamedPipeServer`) on Windows. No Tauri-side changes needed.
- **A-005**: The existing HTTP broker (Axum on `127.0.0.1:0` with bearer auth)
  remains the reference transport. Socket is additive, not a replacement.
- **A-006**: The Copilot CLI extension SDK (`@github/copilot-sdk/extension`)
  supports the `joinSession` API for tool registration and lifecycle hooks.
  This is verified by the Phase 2 branch's working extension.
- **A-007**: The `.putz/spawn.json` file is trusted — it lives in the workspace
  root alongside other config files (`.vscode/`, `.github/`). No sandboxing of
  spawn recipes is required for v1.

---

<!--
=============================================================================
  END OF SPEC KIT-COMPATIBLE CONTENT
=============================================================================
  Sections below are SDLC Guardian extensions.
=============================================================================
-->

## Decomposition

### Module map

| Module | Purpose | Tickets |
|--------|---------|---------|
| Transport | Unix socket + named pipe server alongside existing HTTP | TBD |
| Trust | Two-tier trust model with UI prompt + persistence | TBD |
| Derived Status | `/colleagues/{id}/status` endpoint consuming commandBlockStore + cwdRegistry | TBD |
| Notification Rings | Tab bar ring indicators for unread colleague activity | TBD |
| Inbox Modal | Cmd+J aggregated notification view | TBD |
| Sidebar Rows | Per-colleague metadata in RegionTabBar / companion component | TBD |
| Spawn Palette | Cmd+K spawn actions + .putz/spawn.json | TBD |
| Discovery Wizard | Settings panel AI CLI auto-detection | TBD |
| Public API & SDKs | Wire format docs, conformance tests, 3 SDK packages | TBD |
| PR #126 Reconciliation | Rebase/close Phase 2 branch, extract reusable work | TBD |

### Sequencing and dependencies

```
Phase A (transport foundation):
  Transport → Trust → Derived Status
    ↓
Phase B (UX, parallelizable after Trust):
  Notification Rings ─┐
  Inbox Modal ────────├── all depend on Transport + Trust
  Sidebar Rows ───────┘
    ↓
Phase C (spawn & discovery, parallelizable with B):
  Spawn Palette → Discovery Wizard
    ↓
Phase D (public API, after transport stabilizes):
  Public API & SDKs → Conformance Tests
    ↓
Phase E (cleanup):
  PR #126 Reconciliation
```

Hard dependencies:
- Epic #98 (complete) → provides commandBlockStore, oscParser, cwdRegistry,
  Settings/Shell Integration panel
- Transport MUST land before Trust (trust detection depends on transport type)
- Trust MUST land before any UX tickets (all UX reads the colleague registry,
  which requires trust-gated registration)

### Decomposition rationale

The protocol stack is layered bottom-up: transport → authentication/trust →
derived state → UX consumption. This mirrors the Phase 1 → Phase 2 evolution
but replaces the stalled linear progression with parallelizable tracks. The UX
modules (rings, inbox, sidebar) have no dependencies on each other and can ship
independently. The spawn palette and discovery wizard are orthogonal to the
notification UX and can proceed in parallel. The public API module is last
because it stabilizes after the wire format is proven by internal usage.

---

## Guardian Consultation Results

### Security Guardian

- **Socket path permissions**: Unix sockets MUST be created with `0700`
  permissions (owner-only). Named pipes on Windows MUST use the current user's
  SID in the DACL. Reference: OWASP recommendation for IPC security.
- **One-time token scope**: The env-injected `PUTZ_SWARM_TOKEN` MUST be a
  single-use token for the spawned process. [Decision deferred: current Phase 1
  uses a session-wide token shared across all spawned agents. A per-agent token
  adds complexity but reduces blast radius if one agent is compromised. V1
  retains the session-wide token; V2 explores per-agent tokens.]
- **Trust prompt bypass risk**: An attacker who can read env vars of a Putz
  process can extract the bearer token and register without a prompt. Mitigation:
  socket path is only communicated via env vars to child processes (not
  discoverable via network scan), and the token changes on every Swarm restart.
- **Rate limiting for external registrations**: Tier 2 registration attempts
  MUST be rate-limited to prevent prompt fatigue attacks (flooding the user with
  "Allow?" dialogs). Proposed: max 3 pending prompts; additional attempts
  receive 429 until a prompt is resolved.
- **Constant-time token comparison**: Retained from Phase 1 (`subtle::ConstantTimeEq`
  in `http_server.rs`). Socket auth frames MUST use the same constant-time
  comparison.

### Privacy Guardian

- N/A — Swarm operates entirely on localhost. No PII, PHI, or user-identifying
  data is transmitted outside the machine. Agent names and message bodies stay
  in-process memory and are not persisted to disk (except the "always allow"
  trust list, which stores only agent name strings, not conversation content).

### Platform Guardian

- N/A — Putz is a desktop application (Tauri 2.0). No Kubernetes or cloud
  infrastructure. The socket transport is a localhost-only IPC mechanism,
  not a network service.

### Delivery Guardian

- **Feature flagging**: The Swarm v2 features (socket transport, notification
  rings, inbox, sidebar, spawn palette) SHOULD ship behind feature flags in
  Settings, defaulting to ON for the initial release. The HTTP-only Phase 1
  broker remains as the fallback.
- **Rollout sequence**: Transport + Trust first (no user-visible UX change —
  just faster IPC). Then notification rings + inbox (highest UX value). Then
  spawn palette. Then sidebar rows. Then discovery wizard.
- **CI gates**: Conformance tests MUST be CI-blocking before any SDK is
  published. Socket transport tests MUST run on all 3 OS platforms in CI.

### Code Review Guardian (architectural impact)

- **New module boundary**: `src-tauri/src/swarm/transport/` introduces a
  transport abstraction layer. The coordinator must become transport-agnostic —
  currently it's tightly coupled to the HTTP server's lifecycle. Recommend a
  `Transport` trait with `Socket` and `Http` implementations.
- **Frontend state fan-in**: The sidebar rows consume data from 4 different
  stores (`commandBlockStore`, `cwdRegistry`, Swarm coordinator state, Swarm
  message buffer). This creates a fan-in risk where any store update triggers
  a sidebar re-render. Recommend a `useColleagueStatus` hook that subscribes
  to all 4 and debounces updates (100ms window).
- **Cmd+J / Cmd+K keybinding conflicts**: Verify these keybindings don't
  conflict with existing Putz shortcuts or common shell keybindings. Cmd+K is
  frequently used by shells (clear screen in zsh). Putz should intercept it at
  the app level only when the command palette is explicitly invoked, not when
  the terminal has focus.

---

## System Impact

### Affected components

| Component | Change type | Description |
|-----------|-------------|-------------|
| `src-tauri/src/swarm/coordinator.rs` | Modified | Add transport abstraction, capability negotiation, trust-tier field on Colleague, derived status selectors consuming commandBlockStore data via Tauri events. Currently 555 LOC. |
| `src-tauri/src/swarm/http_server.rs` | Modified | Add `/swarm/colleagues/{id}/status` endpoint, trust-prompt round-trip (emit prompt event → wait for frontend response). Add `/swarm/notify` endpoint. Currently 366 LOC. |
| `src-tauri/src/swarm/models.rs` | Modified | Add `TrustTier` enum, `TransportType` enum, `NotifyEvent`, `StatusResponse`, `CapabilityNegotiation` structs. Currently 300 LOC. |
| `src-tauri/src/swarm/transport/` | **New** | `mod.rs` + `socket.rs` — Unix socket server (tokio `UnixListener`) + Windows named pipe server. Frame parsing, auth handshake, multiplexed client connections. |
| `src/components/Settings/SwarmTrustPrompt.tsx` | **New** | UI modal for Tier 2 trust prompts. Listens for `swarm://trust-prompt` Tauri event, renders Allow/Deny/Always, sends response via `swarm_resolve_trust_prompt` IPC command. |
| `src/components/Inbox/InboxModal.tsx` | **New** | Cmd+J modal. Subscribes to notification store. Lists unread colleague notifications with click-to-focus. |
| `src/components/Region/ColleagueSidebarRow.tsx` | **New** | Per-colleague metadata row. Consumes cwdRegistry, commandBlockStore, Swarm state. |
| `src/components/Region/RegionTabBar.tsx` | Modified | Add notification ring rendering on tab entries for colleagues with unread activity. Currently ~200 LOC. |
| `src/components/CommandPalette/SpawnRecipes.tsx` | **New** | Cmd+K spawn actions. PATH scanning, .putz/spawn.json loading, spawn action dispatch. |
| `src/stores/notificationStore.ts` | **New** | Zustand store for per-colleague unread notifications. Tracks read/unread state per session. |
| `src/stores/swarmStore.ts` | **New** (or extend existing IPC) | Frontend mirror of Swarm coordinator state: colleague list, trust entries, notification counts. |

### Affected contracts

| Contract | Change | Backward compatible? |
|----------|--------|---------------------|
| `PUTZ_SWARM_URL` env var | No change — retained | Yes |
| `PUTZ_SWARM_TOKEN` env var | No change — retained | Yes |
| `PUTZ_TAB_ID` env var | No change — retained | Yes |
| `PUTZ_SWARM_SOCKET` env var | **New** — socket path for local fast-path | Yes (additive) |
| `POST /swarm/register` | Add optional `trust_tier` response field | Yes (additive) |
| `GET /swarm/colleagues/{id}/status` | **New endpoint** | Yes (additive) |
| `POST /swarm/notify` | **New endpoint** | Yes (additive) |
| Socket wire protocol | **New** — length-prefixed JSON frames | N/A (new transport) |
| `.putz/spawn.json` | **New file format** | N/A (new config surface) |
| `swarm://trust-prompt` Tauri event | **New event** | Yes (additive) |
| `swarm://notification` Tauri event | **New event** | Yes (additive) |
| Existing `COPILOT_COLLEAGUE_*` env vars | No change — retained from Phase 2 | Yes |

### Architectural deltas

- **Assumption that changes**: The Swarm broker is no longer HTTP-only. It is a
  multi-transport system with a transport abstraction layer. The coordinator
  dispatches to/from both socket and HTTP clients transparently.
- **Assumption that changes**: Agent status is no longer self-reported via
  heartbeat status fields alone. It is derived from the terminal's own semantic
  state (OSC 133 command blocks + OSC 7 CWD). The heartbeat becomes a liveness
  signal only; the rich status is computed.
- **Assumption that changes**: The Swarm is no longer a backend-only feature.
  It has first-class frontend UX: notification rings, inbox modal, sidebar
  rows, spawn palette, trust prompt. The existing `SwarmStatePublic` event model
  must be extended to support these reactive UI components.
- **New assumption**: The `.putz/` directory is a configuration namespace for
  project-level Putz settings (starting with `spawn.json`). This establishes a
  convention that may be extended in the future (e.g., `.putz/settings.json`).

### Backward compatibility and migration

- **Breaking changes**: None. The HTTP-only Phase 1 broker remains functional.
  Socket transport is additive. All new endpoints are additive. Existing agents
  using `PUTZ_SWARM_URL` + `PUTZ_SWARM_TOKEN` continue to work unchanged.
- **Migration path**: Agents that adopt `PUTZ_SWARM_SOCKET` automatically use
  the faster path. No forced migration. The reference SDKs will auto-detect and
  prefer socket when available, with HTTP fallback.
- **Deprecation timeline**: The `messages` endpoint for status reporting is
  deprecated in favor of the derived status endpoint. No removal timeline —
  messages remain available for explicit coordination.

### Risk surface

- **Risks introduced:**
  - Socket transport adds a new IPC surface. A bug in frame parsing could
    cause crashes or state corruption. **Mitigation:** Fuzz testing of the
    frame parser; length-capped frames (64 KiB max).
  - Trust prompt UI is a new security-critical interaction. A UX bug could
    auto-allow untrusted agents. **Mitigation:** Default to deny on timeout;
    prompt requires explicit user click.
  - Fan-in from 4 stores to sidebar risks jank on rapid updates. **Mitigation:**
    Debounced `useColleagueStatus` hook (100ms).
  - `.putz/spawn.json` executes arbitrary commands. **Mitigation:** Spawn
    recipes only execute when the user explicitly selects them from the Cmd+K
    palette — no auto-execution. File is in workspace root, same trust level
    as `.vscode/tasks.json`.
- **Risks reduced:**
  - Socket transport eliminates HTTP overhead for local agents, reducing
    latency by ~10× and removing the TCP stack from the hot path.
  - Derived status eliminates a class of protocol complexity (agents no longer
    need to implement status-push logic correctly).
  - Trust prompt prevents unauthorized agent registration, which Phase 1
    currently allows for anyone who obtains the bearer token.

---

## Product Impact

### Positioning shift

This spec transforms Putz from "terminal with a colleague registry" to **"the
open multi-agent terminal platform."** The strategic differentiator vs. cmux is
explicit:

| Dimension | cmux | Putz Swarm v2 |
|-----------|------|---------------|
| Agent support | Claude Code Teams (Anthropic-only) | Vendor-neutral: Copilot CLI, Claude, Gemini, Ollama, custom |
| Platform | macOS only (Swift/AppKit) | macOS, Linux, Windows (Tauri) |
| Protocol | Proprietary CLI/socket API | Open spec + 3 reference SDKs |
| Extensibility | `cmux.json` custom commands | `.putz/spawn.json` recipes + public wire format |
| Notification UX | Notification rings, panel, Cmd+Shift+U | Notification rings, Cmd+J inbox, sidebar rows |
| Terminal engine | libghostty (native) | xterm.js (web-based, cross-platform) |

Putz does NOT try to compete on native-macOS polish (cmux wins there). Putz
competes on **openness** (any agent, any OS, documented protocol) and
**semantic depth** (OSC 133-derived status, command-block-aware sidebar).

### Scope boundary changes

- **Opens**: Multi-agent orchestration UX as a product category for Putz.
- **Opens**: Public SDK packages as a developer-relations surface.
- **Opens**: `.putz/` directory as a project-level configuration namespace.
- **Explicitly closes**: Cross-machine / multi-user swarm (see Out of Scope).
- **Explicitly closes**: In-app browser (cmux has it; Putz isn't going there).

### Roadmap dependencies

- **Unlocks**: AI terminal assistant consuming colleague context (future epic).
- **Unlocks**: Agent-to-agent delegation workflows (agent A spawns agent B
  with a task prompt and monitors completion).
- **Unlocks**: Swarm analytics dashboard (which agents are used most, average
  task duration, failure rates).
- **Depends on**: Epic #98 Modern Terminal Protocols (complete) — provides
  commandBlockStore, oscParser, cwdRegistry, shell-integration install panel.
- **Depends on**: Settings/Shell Integration panel (S3 from #98) for the
  first-run discovery wizard.
- **Soft dep on**: PR #126 Phase 2 wiring — this spec supersedes it, but the
  branch contains reference material for env injection, tab lifecycle, and the
  Copilot CLI extension.
- **Blocks or delays**: None — this spec is additive.

### User-facing communication

- **Internal stakeholders**: None (solo project).
- **External communication**: CHANGELOG entry for the Swarm v2 release.
  README update with "Multi-Agent Terminal Protocol" section. Public spec at
  `specs/swarm-protocol/spec.md` serves as both documentation and marketing.
  Consider a blog post comparing the open-protocol approach to cmux's
  closed-ecosystem model.

---

## Spec Drift Handling for Phase 2 PR #126

### Current PR #126 content

PR #126 (`feat/swarm-phase2-wiring`, branch `feat/swarm-phase2-wiring`, draft)
contains:

| Component | LOC | What it does |
|-----------|-----|-------------|
| `extensions/colleagues/core.mjs` | 224 | HTTP helpers, roster formatting, heartbeat, spawn, message, focus — all as pure functions with injected `fetch` |
| `extensions/colleagues/extension.mjs` | 207 | Copilot CLI extension: `joinSession` with 4 tools (`swarm_roster`, `swarm_spawn`, `swarm_send_message`, `swarm_focus`), heartbeat loop, initial-prompt delivery |
| `src-tauri/src/pty/manager.rs` diff | +618 | Copilot binary resolution, shell classification, arg validation |
| `src-tauri/src/ipc/swarm.rs` diff | +135 | Trust-model ADR, IPC command wrappers |
| Frontend (App.tsx, layoutStore, tests) | ~400 | Tab spawn event handling, closeRegion deregister, focus-tab wiring |

### Recommendation: **Close PR #126 and create fresh implementation tickets**

> **Status: Closed 2026-05-03 per this spec's recommendation.** Branch archived
> as reference material. Patterns extracted as design references for fresh
> implementation tickets.

**Rationale:**

1. **Conflict surface is too large**: PR #126 is 94 commits behind main and
   predates both epic #86 (SecureCRT decommissioning) and epic #98 (Modern
   Terminal Protocols). The branch touches `pty/manager.rs` which has been
   substantially refactored (PEB hack removed in S2, perf instrumentation
   added in S6, logging decoupled in T4). Rebase would require re-resolving
   conflicts across 533 changed files.

2. **Architecture has diverged**: This spec introduces socket transport,
   derived status, and trust prompts — none of which exist in PR #126. Rebasing
   the branch would immediately require rewriting most of the broker-side code
   to match the new architecture.

3. **The extension should wrap the SDK**: PR #126's `core.mjs` is a bespoke
   HTTP client. This spec mandates that the Copilot CLI extension wraps
   `@putz/swarm-client` instead. The extension code needs to be rewritten, not
   rebased.

4. **Valuable reference material**: The branch contains battle-tested patterns
   for env injection, tab lifecycle wiring, trust-model ADR content, and
   Copilot CLI extension structure. These should be extracted as reference
   during fresh implementation — not carried as git history.

**Action items:**
1. Close PR #126 with a comment linking to this spec and the new epic.
2. Archive the branch (do not delete — it's reference material).
3. Create fresh implementation tickets from this spec's decomposition.
4. The env injection logic from `pty/manager.rs` can be cherry-picked where
   the diff applies cleanly to current main.

---

## Resolved Decisions

All open questions have been resolved. Decisions are locked into the relevant
spec sections.

| # | Question | Resolution | Resolved |
|---|----------|------------|----------|
| OQ-1 | **Trust persistence scope**: per-machine or per-workspace? | **Per-machine.** Stored in Tauri app config dir, key `swarm.trustedAgents` (array of agent name patterns). Matches macOS Accessibility permission model. Simpler UX, no "which workspace?" confusion. | 2026-05-03 |
| OQ-2 | **Spawn env var precedence**: recipe vars vs Swarm-injected vars? | **Swarm vars always win** — they are infrastructure. Overridden vars trigger a warning in the spawn confirmation UI: "Note: [VAR_NAME] was overridden by Swarm." | 2026-05-03 |
| OQ-3 | **Cmd+K keybinding conflict** with shell clear-screen? | **Smart-intercept.** Cmd+K consumed by Putz only when terminal pane does NOT have focus (focus on tab bar, sidebar, or app chrome). When terminal has focus, passes through to shell. Implementation: check `document.activeElement` against terminal viewport elements. | 2026-05-03 |
| OQ-4 | **Windows named pipe naming**: include username? | **Yes.** Format: `\\.\pipe\putz-swarm-{username}-{port}`. Username via `whoami::username()` or `std::env::var("USERNAME")`. Rationale: shared-machine isolation without relying solely on DACL. | 2026-05-03 |
| OQ-5 | **Per-agent vs session-wide token**? | **Deferred to v2.1.** v2.0 keeps the session-wide shared token (simpler). v2.1 introduces per-agent tokens for better blast-radius isolation. Trade-off documented in "Future Work" below. | 2026-05-03 |
| OQ-6 | **Epic number**: this spec needs a parent epic issue. | **#127.** Created at spec publish time. | 2026-05-03 |

### Future Work: Per-Agent Token Isolation (v2.1)

The v2.0 Swarm uses a **session-wide bearer token** shared across all agents
spawned within a single Swarm session. This is simpler to implement and
sufficient for the localhost-only threat model.

**v2.1 improvement**: Mint a unique per-agent token at spawn time. Each agent
receives its own token via env injection. Benefits:
- **Blast-radius isolation**: A compromised agent's token cannot impersonate
  other agents.
- **Revocation granularity**: Individual agents can be revoked without
  restarting the entire Swarm session.
- **Audit trail**: Token-per-agent enables per-agent activity logging.

**Trade-off**: Per-agent tokens add complexity to the coordinator (token
registry, per-request lookup) and to the trust model (token rotation,
expiration). The Security Guardian recommends this as the next security
hardening step after v2.0 stabilizes.

---

## Out of Scope

These are explicitly NOT part of this epic:

- **In-app browser** — cmux has it; Putz is a terminal, not a browser. See
  cmux's `docs/assets/built-in-browser.png`. Not in Putz's roadmap.
- **Native renderer** — Tauri + xterm.js stays. cmux uses libghostty (Swift/
  AppKit native). Different architectural choice, not a target for Putz.
- **SSH workspace mode** — Putz dropped SSH in epic #86. cmux has `cmux ssh`
  for remote workspaces. Not in Putz's scope.
- **Browser import** — cmux's "Import cookies, history, and sessions from
  Chrome, Firefox, Arc." Not relevant for a terminal-only product.
- **Multi-user / cross-machine swarm** — The protocol is localhost-only.
  Cross-machine orchestration (agents on different dev machines) is a separate
  epic, if ever pursued.
- **Agent conversation routing** — The Swarm routes coordination messages; it
  does NOT route LLM conversations. Each agent manages its own LLM context
  independently. The Swarm is a metadata and notification layer, not a
  conversation multiplexer.
- **SDK package publishing** — This spec defines the wire format and
  references the three SDK packages. The actual SDK implementation, packaging,
  and publishing are separate tickets.
- **Phase 1 broker removal** — The existing HTTP-only broker on main is NOT
  removed. It is extended. Phase 1 clients continue to work. Removal of
  deprecated-only paths (if any) is a future cleanup ticket.
- **Per-agent token isolation** — Deferred to v2.1. v2.0 uses a session-wide
  shared token. See "Future Work: Per-Agent Token Isolation" in Resolved
  Decisions for the trade-off analysis.

---

## Dependencies & Sequencing

### Hard dependencies

| Dependency | Type | Status | Why |
|------------|------|--------|-----|
| Epic #98 — Modern Terminal Protocols | Epic | Complete | Provides `commandBlockStore`, `oscParser`, `cwdRegistry`, shell-integration install panel. FR-Status depends on commandBlockStore. FR-Sidebar depends on cwdRegistry + commandBlockStore. |
| Settings / Shell Integration panel (S3 #101) | Ticket | Complete (part of #98) | FR-Discovery extends this panel with the AI CLI wizard section. |
| Phase 1 Swarm broker (main) | Code | Shipped | The coordinator, HTTP server, models, SSE streaming, stale sweeper — all on main. FR-Transport extends, not replaces. |

### Soft dependencies

| Dependency | Type | Status | Why |
|------------|------|--------|-----|
| PR #126 Phase 2 wiring | Branch | Closed (2026-05-03) | Reference material for env injection, tab lifecycle, Copilot CLI extension. This spec supersedes the branch. Patterns extracted as design references for fresh implementation. |
| `@github/copilot-sdk/extension` | External | Stable | The Copilot CLI extension depends on this SDK. No Putz control over its API stability. |

---

## Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R-1 | **Trust UX annoyance**: Too many prompts for external agents frustrate users | Medium | "Always allow this name" memory + smart defaults. Rate-limit to max 3 pending prompts. Default-deny on timeout (30s). |
| R-2 | **Socket path collisions on shared dev machines** | Medium | Include PID + random suffix in socket path. Unix: `0700` permissions. Windows: user-SID DACL. |
| R-3 | **Backwards compat with Phase 1 HTTP broker** | Low | HTTP transport retained as-is. All new endpoints are additive. Protocol version negotiation rejects incompatible clients gracefully. |
| R-4 | **cmux ships polished UX faster** | Low (strategic) | Not a technical risk. Putz's differentiator is openness (vendor-neutral, cross-platform, documented wire format), not UX polish. The spec emphasizes protocol openness, not feature parity. |
| R-5 | **Vendor SDK divergence**: Copilot vs Claude vs Gemini agents implement slightly different protocol variants | Medium | Conformance test suite at `tests/swarm-protocol-conformance/`. All SDKs must pass. Wire format is the contract, not the SDK implementation. |
| R-6 | **Fan-in jank from 4 stores to sidebar** | Medium | Debounced `useColleagueStatus` hook (100ms window). Benchmark with 10 active colleagues producing rapid output. |
| R-7 | **PR #126 rebase complexity** | ~~High~~ Resolved | PR #126 closed 2026-05-03 per spec recommendation. Fresh implementation tickets will be created. |
| R-8 | **Cmd+K keybinding conflict with shell "clear screen"** | ~~Medium~~ Resolved | Smart-intercept: Cmd+K consumed only when terminal does not have focus. See OQ-3 resolution. |
| R-9 | **`.putz/spawn.json` command injection** | Medium | Spawn only on explicit user selection from Cmd+K palette. No auto-execution. Same trust model as `.vscode/tasks.json`. Validate JSON schema before execution. |
| R-10 | **v2.0 → v2.1 token migration**: Session-wide token in v2.0 must migrate to per-agent tokens in v2.1 without breaking existing agents | Low | v2.1 token migration will be backward-compatible: agents presenting the session-wide token will be accepted (with a deprecation warning in logs) until v3.0. New agents will receive per-agent tokens. See "Future Work" in Resolved Decisions. |

---

## Wire Format Reference

> This section documents the Swarm protocol wire format. It is the public API
> surface (FR-070) and the basis for the three reference SDKs.

### HTTP Endpoints (retained from Phase 1 + additions)

| Method | Path | Purpose | Body |
|--------|------|---------|------|
| POST | `/swarm/register` | Register a colleague | `RegisterRequest` |
| POST | `/swarm/deregister` | Deregister a colleague | `{colleague_id}` |
| POST | `/swarm/heartbeat` | Liveness signal | `{colleague_id, status}` |
| GET | `/swarm/roster` | List all colleagues | — |
| POST | `/swarm/spawn` | Spawn a new agent tab | `SpawnRequest` |
| POST | `/swarm/messages` | Send coordination message | `MessageRequest` |
| GET | `/swarm/stream?id=<colleague_id>` | SSE event stream | — |
| POST | `/swarm/focus` | Focus a colleague's tab | `{tab_id}` |
| **GET** | **`/swarm/colleagues/{id}/status`** | **Derived status** (new) | — |
| **POST** | **`/swarm/notify`** | **Emit notification** (new) | `NotifyRequest` |

### Socket Frame Format

```
┌─────────────┬──────────────────────────────────────────┐
│ Length (4B)  │  JSON payload (UTF-8)                    │
│ big-endian   │  max 65536 bytes                         │
│ u32          │                                          │
└─────────────┴──────────────────────────────────────────┘
```

First frame after connection: `{"type": "auth", "token": "<bearer>"}`.
Server response: `{"type": "auth_ok", ...}` or `{"type": "auth_fail", ...}`.

After auth, all subsequent frames are the same JSON messages as HTTP request/
response bodies, wrapped in a type envelope:
```json
{"type": "register", "payload": { /* RegisterRequest */ }}
{"type": "heartbeat", "payload": { /* HeartbeatRequest */ }}
{"type": "status", "payload": { "colleague_id": "..." }}
{"type": "notify", "payload": { /* NotifyRequest */ }}
```

Server-to-client frames (push):
```json
{"type": "event", "payload": { /* SseEvent equivalent */ }}
{"type": "status_response", "payload": { /* StatusResponse */ }}
```

### New Message Schemas

```typescript
// NotifyRequest (new)
interface NotifyRequest {
  from: string;          // colleague_id
  severity: "urgent" | "normal" | "ambient";
  body: string;          // max 4096 chars
}

// StatusResponse (new — derived, not stored)
interface StatusResponse {
  colleague_id: string;
  heartbeat: "active" | "stale" | "dead";
  last_exit_code: number | null;  // from commandBlockStore
  cwd: string | null;             // from cwdRegistry
  last_command_at: string | null; // ISO 8601 timestamp
}

// CapabilityNegotiation (new — socket only)
interface CapabilityNegotiation {
  protocol: "putz-swarm";
  version: string;       // semver, e.g., "0.1.0"
  capabilities: string[]; // e.g., ["socket", "http", "notify"]
}
```

---

## Appendix — References

- [cmux — Ghostty-based macOS terminal for AI agents](https://github.com/manaflow-ai/cmux) — competitive reference for notification rings, sidebar, custom commands, Claude Code Teams
- [cmux notification rings](https://github.com/manaflow-ai/cmux/blob/main/docs/assets/notification-rings.png) — visual reference for FR-030
- [cmux sidebar](https://github.com/manaflow-ai/cmux/blob/main/docs/assets/vertical-horizontal-tabs-and-splits.png) — visual reference for FR-040
- [cmux custom commands](https://cmux.com/docs/custom-commands) — reference for `.putz/spawn.json` design
- Putz Epic #98 — [Modern Terminal Protocols spec](specs/modern-terminal-protocols/spec.md) — provides commandBlockStore, oscParser, cwdRegistry
- Putz PR #126 — [Phase 2 Swarm wiring](https://github.com/vbomfim/putz/pull/126) — reference material for env injection, tab lifecycle
- Putz Phase 1 Swarm code — `src-tauri/src/swarm/` (coordinator.rs, http_server.rs, models.rs)
- [OSC 9/99/777 — Terminal notification sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html) — cmux uses these for notification detection
- [Spec Kit](https://github.com/github/spec-kit) — Sections 1–4 of this spec are Spec Kit-compatible
- [12-Factor App — Config](https://12factor.net/config) — env-var-based bootstrap pattern
