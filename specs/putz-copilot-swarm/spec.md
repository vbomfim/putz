# Feature Specification: Putz ↔ Copilot CLI Swarm

**Feature Branch**: `docs/spec-putz-copilot-swarm`
**Created**: 2026-05-04
**Status**: Draft
**Input**: Replace the over-engineered Swarm v2 (vendor-neutral public protocol, HTTP broker, multi-language SDKs) with a narrowly-scoped local IPC integration between Putz and GitHub Copilot CLI extensions running in Putz PTY tabs.

**Owner**: PO Guardian via Copilot
**Last updated**: 2026-05-15 (T3 PR #155 fixup — full-snapshot status semantics + `lastTenExitCodes` field; FR-012 latency contract clarified; SC-004 LOC budget revised to ≤2500 test LOC.)
**Issue tracker**: [Epic — to be created on landing this spec](https://github.com/vbomfim/putz/issues)
**Tickets**: T1–T5 — created from the Decomposition section below
**Supersedes**: [`specs/_archive/swarm-protocol-v2-vendor-neutral/spec.md`](../_archive/swarm-protocol-v2-vendor-neutral/spec.md) (Epic #127, tickets #129–#137 — all closed)

---

## Strategic Positioning

This is **not** a public protocol. It is **not** a multi-vendor standard. It is **not** an SDK ecosystem. It is an **internal integration** between two pieces of software — Putz (the host) and the GitHub Copilot CLI (the colleague) — running on a single user's single machine.

The previous spec mistook a UX problem ("multiple AI agents in tabs that know about each other") for a platform problem ("an open protocol any vendor can implement"). The platform framing produced ~3,000 LOC of HTTP broker, bearer-token auth, SSE, DNS rebinding protection, and conformance test scaffolding before anyone had used the feature once. **All of that is being deleted.**

The product surface stays the same: a developer opens 2–3 Putz tabs, runs `gh copilot` in each, and gets per-tab status rings, a Cmd+J inbox of unread agent activity, and a Cmd+K palette to spawn new agents. What changes is the substrate: instead of an HTTP server with a public wire format, Putz exposes a per-instance Unix socket (or Windows named pipe) that the bundled Copilot CLI extension connects to via Node's `net.connect({path})`. Both ends are spawned by the same Putz process for the same OS user. OS file permissions are the auth model.

If a future user demands "Claude Code support" or "Gemini CLI support", that is a separate feature with its own spec — not a generalization of this one.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Zero-Config Colleague Detection (Priority: P1)

As a developer, I install Putz, open a tab, run `gh copilot`, and within 2 seconds the tab shows a colleague badge with the agent's session info — without any configuration.

**Why this priority**: The core value proposition. If detection doesn't "just work" the moment a user opens a Copilot CLI tab, no other feature matters.

**Independent Test**: Open a fresh Putz tab on a machine with `gh copilot` installed. Verify the tab badge appears within 2 seconds and shows the agent name and "idle" status. No config files touched.

**Acceptance Scenarios**:

1. **Given** Putz is running, **When** the user opens a new tab and starts `gh copilot`, **Then** Putz injects `PUTZ_SWARM_PATH` and `PUTZ_TAB_ID` into the PTY env, the bundled Copilot CLI extension reads them and connects to the socket, and the agent appears in the roster within 2s.
2. **Given** a registered agent in tab A, **When** the user opens tab B and starts a second `gh copilot`, **Then** both tabs show colleague badges and each agent's roster includes the other.
3. **Given** an agent registered via the local socket, **When** the agent sends a heartbeat, **Then** round-trip latency is < 5 ms p95 measured at the Rust coordinator.

### User Story 2 — Per-Tab Notification Rings + Cmd+J Inbox (Priority: P1)

As a developer running 2–3 Copilot agents across tabs, I can see at a glance which agent has new output, and press Cmd+J to see them all in one list.

**Why this priority**: Multi-agent without attention management is worse than single-agent — the user has to focus each tab manually. This is the one cmux feature that must be matched.

**Independent Test**: Open 3 tabs with Copilot running. Focus tab 1. Have agents in tabs 2 and 3 produce output (e.g., a long-running prompt completion). Verify tabs 2 and 3 show colored rings on their tab indicators. Press Cmd+J. Verify both appear in the inbox, sorted by recency. Click one, verify focus jumps to the correct tab and the ring clears.

**Acceptance Scenarios**:

1. **Given** an agent in an unfocused tab, **When** the agent produces PTY output OR emits a `notify` message via the socket, **Then** the tab shows a colored notification ring (urgent = red, normal = blue, ambient = subtle).
2. **Given** ≥ 1 unread tab, **When** the user presses Cmd+J (macOS) or Ctrl+J (Linux/Windows), **Then** the inbox modal opens listing each unread colleague with most recent first.
3. **Given** an inbox entry, **When** the user clicks it OR focuses the corresponding tab any other way, **Then** the entry is marked read and the ring clears.

### User Story 3 — Cmd+K Spawn Palette (Priority: P2)

As a developer, I press Cmd+K and can spawn a new Copilot CLI tab from a list of project-specific recipes defined in `.putz/spawn.json`, in addition to a default "new Copilot tab" entry.

**Why this priority**: Spawn ergonomics make the difference between "I can do multi-agent" and "I want to do multi-agent". Out of the cmux feature set this is the third pillar after rings/inbox.

**Independent Test**: Add `.putz/spawn.json` with a "review" recipe. Press Cmd+K, type "review", select the entry. Verify a new tab opens, runs the recipe's command with the recipe's env applied, and the agent auto-registers within 2s.

**Acceptance Scenarios**:

1. **Given** Putz is running, **When** the user presses Cmd+K, **Then** the palette shows at minimum a "Spawn: gh copilot" default entry plus any recipes from `.putz/spawn.json` in the workspace root.
2. **Given** `.putz/spawn.json` contains `{"recipes":[{"name":"review","cmd":"gh","args":["copilot","--mode","review"],"env":{"REVIEW":"1"}}]}`, **When** the user selects "Spawn: review", **Then** a new tab opens running `gh copilot --mode review` with `REVIEW=1` and the swarm env vars (`PUTZ_SWARM_PATH`, `PUTZ_TAB_ID`) injected.
3. **Given** a spawned tab, **When** the new process starts, **Then** the swarm env vars take precedence over the recipe's env if there is a name collision (Putz's vars are non-overridable).

### Edge Cases

- **Socket path collision**: Multiple Putz instances for the same user. Each instance gets a unique socket path: `$XDG_RUNTIME_DIR/putz/swarm-<pid>.sock` on Linux, `$TMPDIR/putz-swarm-<pid>.sock` on macOS, `\\.\pipe\putz-swarm-<pid>` on Windows.
- **Agent crashes without disconnecting cleanly**: Socket EOF triggers immediate deregister. A 30s heartbeat timeout is the secondary signal.
- **Tab opens, agent starts, tab closes before registration**: Coordinator drops orphan registrations on tab-close lifecycle event (already wired in Phase 1).
- **Windows named pipe ACL**: Pipe is created with the current user's SID only. No "Everyone" or "Authenticated Users" access.
- **Copilot CLI extension not installed yet**: First-run sees no extension; tab works as a regular terminal. Putz Settings shows a "Copilot CLI integration not installed — Install" card. Clicking installs the bundled extension. (Bundled with the Putz binary; install = copy/symlink to the user's Copilot extensions dir.)
- **OSC 133 not available**: Status badge degrades to heartbeat-only ("active" / "stale" / "dead") with no exit-code dots.
- **Two PTYs in the same tab (split panes)**: Each PTY gets a distinct `PUTZ_TAB_ID` (really a pane ID). Roster shows them as separate colleagues sharing a parent tab.
- **Putz quits while extensions are connected**: Sockets close, extensions get EOF and exit cleanly. No orphan files (unlinked on coordinator drop).

---

## Requirements *(mandatory)*

### Functional Requirements

#### FR-Transport — Local IPC

- **FR-001**: Putz MUST host a single per-process IPC endpoint — Unix domain socket on macOS/Linux, Windows named pipe on Windows — created at startup and removed at shutdown.
- **FR-002**: The endpoint MUST be readable/writable only by the OS user that started Putz (Unix `chmod 600`; Windows ACL with the user SID only).
- **FR-003**: The wire format MUST be length-prefixed JSON: 4-byte big-endian unsigned length, then UTF-8 JSON. No HTTP, no SSE, no bearer tokens.
- **FR-004**: The protocol MUST consist of exactly these message types: `register`, `register_ack`, `heartbeat`, `notify`, `send_to`, `recv_from`, `disconnect`. Adding a new type is a breaking change.
- **FR-005**: Putz MUST tear down a connection if the first message after connect is not a valid `register` within 1 second.
- **FR-006**: There MUST be no remote/network endpoint. The HTTP broker (`src-tauri/src/swarm/http_server.rs`) is removed.

#### FR-Discovery — Zero-Config Registration

- **FR-007**: When spawning a PTY, Putz MUST inject `PUTZ_SWARM_PATH` (absolute socket/pipe path) and `PUTZ_TAB_ID` (UUID) into the child process environment.
- **FR-008**: The bundled Copilot CLI extension MUST read those env vars on startup and connect within 2 seconds. If absent, the extension MUST exit cleanly with no error output (running outside Putz is not an error).
- **FR-009**: Registration MUST be idempotent: re-registering with the same `tab_id` replaces the prior registration.
- **FR-010**: Putz MUST detect the Copilot CLI binary on first run and offer to install the bundled extension via a Settings card. Installation copies/symlinks the extension into the user's Copilot CLI extension directory and is reversible.

#### FR-Status — OSC 133-Derived Per-Colleague Status

- **FR-011**: Per-colleague status (last exit code, current cwd, command running flag) MUST be derived from existing `commandBlockStore` (OSC 133) and `cwdRegistry` (OSC 7), not pushed by the agent.
- **FR-012**: When `commandBlockStore` records a new command boundary in a tab with a registered colleague, the colleague's badge MUST update within 1 frame (≤ 16 ms). *Latency contract — two paths:* (a) the **local UI badge** uses the synchronous TS selector (`getColleagueStatus`) and updates within one frame (≤ 16 ms) of the OSC marker landing in `commandBlockStore`; (b) **peer roster sync** via `RosterUpdate` is eventual, with up to ~350 ms cumulative latency (100 ms frontend coalescing throttle in `statusPusher` + 250 ms backend coalescing throttle in `coordinator`). The two-stage throttle intentionally trades a small amount of peer-update lag for a calm wire under bursty OSC streams (e.g., a `make -j` that emits hundreds of prompt boundaries per second).
- **FR-013**: If a tab has no OSC 133 shell integration, the badge MUST gracefully degrade to heartbeat-only state (no exit-code dots).

#### FR-UX — Notification Rings + Inbox + Sidebar + Spawn Palette

- **FR-014**: Each tab with a registered colleague MUST display a notification ring on the tab indicator when (a) PTY output arrives while the tab is unfocused, or (b) a `notify` message arrives via the socket.
- **FR-015**: Ring color MUST encode severity: urgent = red, normal = blue, ambient = subtle. `notify` severity defaults to `normal` if unspecified.
- **FR-016**: Focusing a tab (any input method) MUST clear its ring within 1 frame.
- **FR-017**: Cmd+J (macOS) / Ctrl+J (Linux/Windows) MUST open an Inbox modal listing all unread colleagues, sorted by most recent activity, with click-to-jump.
- **FR-018**: The sidebar MUST show one row per registered colleague with: name, cwd (from OSC 7), heartbeat badge (Active/Stale/Dead), last 10 exit-code dots (from OSC 133), last `notify` message preview (first 80 chars).
- **FR-019**: Cmd+K (macOS) / Ctrl+K (Linux/Windows) MUST open a Spawn palette listing a default "Spawn: gh copilot" entry plus all recipes from `.putz/spawn.json` in the workspace root.
- **FR-020**: When a recipe is selected, Putz MUST spawn a new tab with the recipe's `cmd`, `args`, and `env`. `PUTZ_SWARM_PATH` and `PUTZ_TAB_ID` are non-overridable — Putz's values win on collision.

### Key Entities

- **Coordinator** (Rust): Owns the listening socket, the colleague roster, and the per-colleague socket writer. Replaces `coordinator.rs`'s HTTP-side code.
- **Colleague**: One registered Copilot CLI session, identified by `tab_id`. Holds `name`, `pid`, `cwd`, `heartbeat_at`, last `notify`, and a back-channel writer.
- **Wire message**: One of the 7 frame types. JSON shape defined in the implementation tickets, not duplicated here.
- **Spawn recipe**: An entry in `.putz/spawn.json` — `{name, cmd, args[], env{}}`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From `gh copilot` process start to colleague visible in the Putz roster: < 2 s p95 on a developer laptop (M-series Mac, Linux x86_64, Windows 11).
- **SC-002**: Heartbeat round-trip latency: < 5 ms p95 measured at the Rust coordinator.
- **SC-003**: Notification ring appears within 1 frame (≤ 16 ms) of `notify` arrival on a 60 Hz display.
- **SC-004**: Total Rust LOC for the swarm subsystem after implementation: ≤ 1500 production LOC (excludes test code) and ≤ 2500 test LOC. Down from 3,019 in the prior HTTP-broker design. Zero LOC of HTTP server code. *Rationale: revised twice from the initial ≤ 600 estimate — first to ≤ 1200 after T1, then to ≤ 2500 after T3 PR #155 fixup. High-confidence concurrency tests (lifecycle race, debounce burst collapse, full-snapshot clear semantics, sentinel-cwd log redaction) and cross-platform path tests genuinely consume more lines than the initial estimate. Production-vs-test split documented separately so substantial regression test coverage (a project goal) does not push back against the size budget.*
- **SC-005**: Total Node LOC for the bundled Copilot CLI extension: ≤ 250.
- **SC-006**: A user with `gh copilot` installed can open Putz, accept the "install Copilot integration" prompt, open a new tab, and see the colleague appear without ever opening a config file or reading documentation.
- **SC-007**: Zero open-network ports introduced by the swarm subsystem (verified via integration test that opens a tab, registers a colleague, then asserts no listening TCP/UDP socket appears in `lsof`/`netstat` for the Putz process other than what existed before the test).

## Assumptions

- Same machine, same OS user, same Putz process. No SSH, no remote agents, no coworker visibility.
- The user has GitHub Copilot CLI installed and on PATH. Detection on first run is best-effort; manual config path exists in Settings.
- Node ≥ 18 for the bundled extension (Copilot CLI's own minimum).
- Rust crate `interprocess` (or equivalent battle-tested crate) is acceptable for the cross-platform socket abstraction.
- The Tauri/main-process work in this repo is allowed to break the public IPC surface for the swarm — there are no external consumers; Phase 1 was never released.

---

## Decomposition

### Module map

| Module | Purpose | Tickets |
|--------|---------|---------|
| Transport | Per-instance Unix socket / named pipe; length-prefixed JSON; coordinator owns roster | T1 |
| Copilot CLI extension | Bundled Node extension that auto-registers, heartbeats, forwards `notify`/`send_to`/`recv_from`. Includes first-run discovery + install flow. | T2 |
| Status integration | Wire OSC 133 / OSC 7 / `commandBlockStore` into per-colleague badges and exit-code dots | T3 |
| UX surface | Tab notification rings, Cmd+J Inbox modal, sidebar colleague rows, Cmd+K Spawn palette + `.putz/spawn.json` | T4 |
| Tests + docs | Integration tests, port-presence test (SC-007), socket-perms test, README + `docs/swarm.md` | T5 |

### Sequencing and dependencies

- **Phase A (foundation, sequential):** T1 (Transport) — everything else depends on the socket and the new coordinator API.
- **Phase B (parallel after T1):** T2 (extension), T3 (status integration). T2 unblocks any end-to-end test; T3 needs only the coordinator's roster API.
- **Phase C (after T2 + T3):** T4 (UX surface). Rings/inbox depend on `notify` arriving via the extension; sidebar depends on T3.
- **Phase D (last):** T5 (tests + docs). Integration tests need the full pipeline.

### Decomposition rationale

Five tickets, not nine. The previous spec split UX into one ticket per surface (rings / inbox / sidebar / spawn) because the substrate was being co-developed and parallelism was needed. With the substrate locked to a single ~400 LOC Rust transport, the UX surfaces share enough state (roster, unread set, focus tracking) that splitting them produces 4 tickets that all touch the same React store and end up serializing anyway. T4 is the right granularity. Discovery + zero-config is folded into T2 because the extension *is* the integration — separating "the code that connects" from "the code that decides whether to install" creates an artificial boundary.

---

## Guardian Consultation Results

> Captured at the feature level. Consulted in PO Step 5b; tickets reference these by ID rather than restating.

### Security Guardian

- **SEC-001**: Socket file MUST be `chmod 600` on Unix; named pipe MUST be created with current-user-only ACL on Windows. Verified by automated test in T5. *(OWASP A01:2021 — Broken Access Control.)*
- **SEC-002**: No bearer tokens, no shared secrets, no auth headers. The auth model is "you're the same OS user that started Putz" — verified by OS file permissions, not by application code. Removing application-level auth removes a class of bugs. *(Defense in depth: rely on the OS layer that already enforces this.)*
- **SEC-003**: First message after connect MUST be `register` within 1 s; otherwise the connection is dropped. Prevents slow-loris-style local DoS by malformed clients (FR-005).
- **SEC-004**: Length prefix MUST be bounded (proposed: 1 MiB max per frame). Reject and disconnect on overflow. Prevents memory-exhaustion via crafted oversized frames.
- **SEC-005**: `register.name` MUST be sanitized before display in the sidebar/inbox (terminal control sequences stripped). The colleague's claimed name is user-facing UI input from an untrusted-but-local process.
- **SEC-006**: Bundled extension installer MUST refuse to overwrite an existing extension file without an explicit user confirmation step. *(Supply-chain hygiene — don't silently clobber third-party Copilot extensions.)*
- **SEC-007**: Re-registration on the same `tab_id` is rate-limited (≤5 evictions/sec/tab) to prevent eviction-as-DoS within the trust boundary. A buggy or hostile colleague that re-registers in a tight loop would otherwise force constant evictions of its predecessor and burn coordinator CPU + spam writers. The first register on a fresh tab is always allowed; only successive re-registers within `TAB_EVICTION_MIN_INTERVAL` (200ms) are refused with `rate_limited`. *(Defense in depth: the OS-permission trust boundary keeps non-same-UID processes out, but a same-UID buggy/compromised process is still in scope for resource-abuse defenses.)*
- **SEC-008** *(Windows)*: The swarm named pipe MUST be created with an explicit DACL granting `GENERIC_ALL` to the current user's SID and **no other principal** (`D:P(A;;GA;;;<sid>)` — Discretionary, Protected from inheritance, single Allow ACE). Relying on the process token's default DACL was rejected because that DACL is configurable system-wide via group policy or token tweaks and we cannot guarantee it won't grant access to additional principals. Validated by a Windows-only test asserting the bound pipe's DACL has exactly one ACE.

### Privacy Guardian

- **PRI-001**: Colleague `cwd`, command history, and `notify` payloads stay in-process. Nothing is logged to disk by the swarm subsystem. (User's own Copilot CLI may log; that's not in scope.) — Confirmed N/A for GDPR/HIPAA — no cross-network transmission, no third-party processor.
- **PRI-002**: `.putz/spawn.json` is workspace-local and may contain command lines that include secrets in `args` or `env`. Putz MUST NOT log spawn recipes verbatim in any telemetry. Document this expectation in `docs/swarm.md`.

### Platform Guardian

- N/A — no Kubernetes, no infrastructure, no networking. Pure local IPC. The only platform-ish concerns are filesystem path conventions (XDG_RUNTIME_DIR on Linux, TMPDIR on macOS, `\\.\pipe\` on Windows) — already covered in FR + Edge Cases.

### Delivery Guardian

- **DEL-001**: Removing the HTTP broker is a breaking change to the Phase 1 ad-hoc API surface. Acceptable: Phase 1 was never released and has no external consumers (verified — no PRs against W1–W9 substrates landed).
- **DEL-002**: The bundled Copilot CLI extension ships inside the Tauri app bundle. CI must produce extension artifacts on every release. T5 covers the test/CI work.
- **DEL-003**: No SLI/SLO infrastructure required (local feature, no service). Per-tab perf budgets enforced via integration tests (SC-001 through SC-003).

### Code Review Guardian (architectural impact)

- **ARCH-001**: This is a net-negative-LOC change (≈ -2,400 LOC swarm subsystem). The architectural simplification is the primary value proposition — review should reject any reintroduction of HTTP/SSE/bearer scaffolding "just in case".
- **ARCH-002**: The coordinator becomes the single source of truth for roster + back-channel writers. Confirm no other subsystem (PTY manager, OSC parser, IPC layer) holds parallel roster state.
- **ARCH-003**: `.putz/spawn.json` introduces a new workspace-local config surface. Confirm the loader follows the project's existing config conventions (likely `serde_json` with `#[serde(deny_unknown_fields)]` to fail closed on typos).

---

## System Impact

### Affected components

| Component | Change type | Description |
|-----------|-------------|-------------|
| `src-tauri/src/swarm/http_server.rs` | **Removed** | 366 LOC. HTTP broker is deleted in T1. |
| `src-tauri/src/swarm/coordinator.rs` | **Heavily modified** | 1805 LOC → ≈ 400 LOC. HTTP-facing methods removed; replaces with socket listener + per-conn task. Roster + heartbeat sweeper survives. |
| `src-tauri/src/swarm/models.rs` | **Heavily modified** | 737 LOC → ≈ 150 LOC. Bearer-token, capability-negotiation, trust-tier types deleted. Wire message structs added for the 7 new frame types. |
| `src-tauri/src/ipc/swarm.rs` | **Modified** | 93 LOC. Tauri command surface adjusted for the new coordinator API. |
| `src-tauri/src/swarm/mod.rs` | **Modified** | Module exports trimmed. |
| New: `src-tauri/src/swarm/socket.rs` | **New** | Cross-platform socket/pipe listener via `interprocess` crate. ≈ 150 LOC. |
| New: `extensions/copilot-swarm/` (Node) | **New** | Bundled Copilot CLI extension. ≈ 250 LOC including discovery/install flow. |
| New: `src/swarm/InboxModal.tsx`, `SpawnPalette.tsx`, `ColleagueRow.tsx`, `TabRing.tsx` | **New** | UX surface (T4). |
| Existing: `src/state/cwdRegistry.ts`, `src/state/commandBlockStore.ts` | **Read-only consumers added** | T3 wires existing state into colleague badges. No write-side changes. |

### Affected contracts

| Contract | Change | Backward compatible? |
|----------|--------|---------------------|
| Phase 1 HTTP API (`POST /swarm/register`, `GET /swarm/colleagues`, etc.) | **Removed entirely** | No — but no external consumers. Phase 1 unreleased. |
| Tauri IPC commands under `swarm::*` | **Re-shaped** | No — frontend is co-updated in T4. |
| PTY env injection | **Adds** `PUTZ_SWARM_PATH`, `PUTZ_TAB_ID`. **Removes** `PUTZ_SWARM_URL`, `PUTZ_SWARM_TOKEN` (Phase 1). | No external consumer dependency. |
| `.putz/spawn.json` | **New** workspace-local config file. Schema: `{recipes: [{name, cmd, args[], env{}}]}` with `deny_unknown_fields`. | N/A — new surface. |

### Architectural deltas

- "Putz exposes a network-listening server" → **false**. No port is opened.
- "Swarm clients can be written in any language" → **false**. The only supported client is the bundled Node extension.
- "Trust is a runtime concern with prompts and persistence" → **false**. Trust is an OS file-permission concern, set at socket creation.
- "Status is pushed by agents" → **false**. Status is derived from existing OSC 133 / OSC 7 state owned by Putz.

### Backward compatibility and migration

- **Breaking changes:** Phase 1 HTTP broker removed; Phase 1 env vars removed; Phase 1 IPC commands re-shaped.
- **Migration path:** None needed — Phase 1 was never released and has no users. Anyone running a `main` build with Phase 1 active will get the new behavior on next pull. No data migration (no persistent state).
- **Deprecation timeline:** Immediate. Phase 1 code is deleted in T1, not deprecated.

### Risk surface

- **Risks introduced:**
  - One new local IPC endpoint per Putz process (mitigated: `chmod 600` / user-SID ACL; bounded frame size; register-or-die handshake).
  - Bundled extension installer touches the user's Copilot CLI extension directory (mitigated: refuse to overwrite without confirmation; reversible).
  - `.putz/spawn.json` is workspace-trusted — opening a malicious workspace and pressing Cmd+K could spawn an attacker-chosen command. Mitigation: same trust model as the existing terminal — Putz already runs commands from the workspace; surface this in `docs/swarm.md`. *Open question whether to require explicit user-approval-on-first-load — see Open Questions below.*
- **Risks reduced:**
  - Open TCP listener removed → no DNS rebinding, no localhost cross-app attacks, no port-scan exposure.
  - Bearer-token store removed → no secret rotation, no token-leak class of bugs.
  - ~2,400 LOC of HTTP/middleware/auth removed → less audit surface.

---

## Product Impact

### Positioning shift

Putz stops claiming to be "the open multi-agent terminal protocol" and instead claims to be "the best place to run GitHub Copilot CLI". This is a narrower but more honest pitch that is actually deliverable. The cmux comparison stays valid at the UX layer (rings, inbox, palette) — Putz still differentiates on cross-platform support and integration with Putz's existing OSC 133/OSC 7 stack — but drops the "vendor-neutral" framing that was never going to be earned by a single team.

### Scope boundary changes

- **Narrowed:** No public protocol, no SDKs, no conformance suite, no third-party agent contract.
- **Closed off:** Future "support Claude Code / Gemini CLI / custom agents" requires a new spec — *not* a generalization of this one. Each integration is its own feature with its own bundled extension. This is the right answer; vendor-neutrality is a 10× cost multiplier that should only be paid when there's a second customer.

### Roadmap dependencies

- **Unlocks:** Anything that wants to talk to Copilot CLI from Putz internals (e.g., a future "@-mention another tab's agent" feature) gets a clean API to build on.
- **Blocks or delays:** "Generic agent SDK" work is now off-roadmap until and unless a second-vendor integration is requested.
- **Depends on:** Modern Terminal Protocols epic (#98) for OSC 133 / OSC 7 (already complete and on `main`).

### User-facing communication

- **Internal stakeholders to inform:** None — Phase 1 was never publicized.
- **External communication needed:** Mention in next CHANGELOG / release notes. No blog post needed; this is a course-correction, not a launch.

---

## Appendix — References

- Superseded predecessor: [`specs/_archive/swarm-protocol-v2-vendor-neutral/spec.md`](../_archive/swarm-protocol-v2-vendor-neutral/spec.md)
- Modern Terminal Protocols epic (dependency): [`specs/modern-terminal-protocols/`](../modern-terminal-protocols/)
- Phase 1 code being deleted: `src-tauri/src/swarm/{coordinator.rs, http_server.rs, models.rs}`, `src-tauri/src/ipc/swarm.rs`
- cmux (UX reference, not protocol reference): https://github.com/manaflow-ai/cmux
- GitHub Copilot CLI: https://docs.github.com/en/copilot/github-copilot-in-the-cli
- Node `net.connect({path})` docs (Unix socket + named pipe via libuv): https://nodejs.org/api/net.html
- Rust `interprocess` crate (cross-platform local IPC): https://docs.rs/interprocess
