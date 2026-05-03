# Feature Specification: Modern Terminal Protocol Support

**Feature Branch**: `98-modern-terminal-protocols`
**Created**: 2026-05-02
**Status**: Draft
**Input**: Epic #98 — make Putz a first-class host for modern shells

**Owner**: PO Guardian via Copilot
**Last updated**: 2026-05-03
**Issue tracker**: [Epic #98](https://github.com/vbomfim/putz/issues/98)
**Version**: 1.0.0
**Tickets**:
- [#99](https://github.com/vbomfim/putz/issues/99) — S1: Bracketed paste audit + handler consolidation
- [#100](https://github.com/vbomfim/putz/issues/100) — S2: OSC 7 primary CWD — delete PEB/lsof hacks
- [#101](https://github.com/vbomfim/putz/issues/101) — S3: Shell-integration install script
- [#102](https://github.com/vbomfim/putz/issues/102) — S4: OSC 133 semantic command boundaries
- [#103](https://github.com/vbomfim/putz/issues/103) — S5: Per-command gutter UX
- [#104](https://github.com/vbomfim/putz/issues/104) — S6: Spawn-time SLO + performance test
- [#105](https://github.com/vbomfim/putz/issues/105) — S7: Shell compatibility test suite
- [#107](https://github.com/vbomfim/putz/issues/107) — S8: VT correctness test corpus

---

## User Scenarios & Testing

### User Story 1 — Safe Multi-Line Paste (Priority: P1)

As a developer, I right-click to paste a multi-line script and it runs as one
command, not line-by-line — the shell's bracketed paste mode wraps the pasted
text so the shell sees a single semantic paste event.

**Why this priority**: Broken paste is a daily pain point. Every mishandled
multi-line paste risks executing partial commands. This is table-stakes for a
modern terminal.

**Independent Test**: Paste a 5-line bash script into zsh with
`bracketed-paste-mode` on; verify the shell receives exactly one paste event
and the lines are not individually interpreted as commands.

**Acceptance Scenarios**:

1. **Given** zsh with bracketed paste mode enabled, **When** the user pastes a
   multi-line script via Ctrl+Shift+V or right-click → Paste, **Then** the
   shell receives `\e[200~<text>\e[201~` and treats it as a single input.
2. **Given** PowerShell 7 on Windows, **When** the user pastes via Ctrl+V,
   **Then** PSReadLine receives the text as a bracketed paste and does not
   execute line-by-line.
3. **Given** a shell that does NOT support bracketed paste (e.g. plain `sh`),
   **When** the user pastes, **Then** Putz falls back to raw write without
   brackets — no broken escape sequences.

---

### User Story 2 — Reliable CWD Tracking (Priority: P1)

As a developer using zsh, my terminal tab title and path bar show the correct
CWD in real time — even when I `cd` into a deeply nested folder — without any
lag or stale data.

**Why this priority**: CWD drives file-link resolution, the path bar, and tab
titles. Today's PEB hack on Windows is fragile (50–200 ms latency, unsafe FFI),
and macOS `lsof` is slow. OSC 7 is the industry-standard replacement.

**Independent Test**: On macOS, open a zsh tab, `cd /tmp/deeply/nested/dir`,
verify the path bar updates within one video frame of the prompt appearing.

**Acceptance Scenarios**:

1. **Given** macOS with zsh (default shell emits OSC 7), **When** the user
   `cd`s to a new directory, **Then** `cwdRegistry` records the new CWD via
   the OSC 7 handler within 1 frame — no `lsof` fallback invoked.
2. **Given** Windows with pwsh (Putz injects OSC 7 via `$prompt`), **When**
   the user `cd`s, **Then** the path bar updates immediately and no PEB hack
   code executes.
3. **Given** the PEB hack code is deleted from `pty/manager.rs`, **When** the
   full test suite runs on Windows, **Then** zero regressions — OSC 7 is the
   sole CWD source.

---

### User Story 3 — One-Click Shell Integration Install (Priority: P2)

As a developer on Windows, I install Putz and on first launch the Settings panel
offers to enable shell integration in pwsh — one click and it's working. No
manual editing of `$PROFILE`.

**Why this priority**: Shell integration is the prerequisite for OSC 7, OSC 133,
and every advanced feature. A poor install experience means adoption dies at
the door.

**Independent Test**: On a fresh Windows install with pwsh, open Settings →
Shell Integration, click "Install" on the PowerShell card, open a new tab,
verify OSC 7 CWD updates work.

**Acceptance Scenarios**:

1. **Given** a macOS system with zsh and bash installed, **When** the user opens
   Settings → Shell Integration, **Then** both shells appear as cards showing
   "Detected" status with an "Install" button.
2. **Given** the user clicks "Install" on the zsh card, **When** `~/.zshrc`
   does not contain a Putz integration block, **Then** Putz appends the snippet
   inside `# === putz shell integration ===` / `# === end ===` markers and
   reports success.
3. **Given** the user clicks "Install" on a shell that already has the snippet,
   **When** the version is outdated, **Then** Putz replaces the block between
   the markers (idempotent update) and reports "Updated."
4. **Given** the user wants to install manually, **When** they click "Show
   snippet" instead of "Install", **Then** the full snippet is displayed in a
   copyable code block.

---

### User Story 4 — Command Exit-Code Gutter (Priority: P2)

As a developer, I can scroll up in my terminal and see a green/red dot next to
each previous command showing whether it succeeded (exit 0) or failed (non-zero).

**Why this priority**: This is the signature UX payoff of OSC 133 full adoption
and the primary differentiator vs. vanilla xterm.js-based terminals. It turns
the terminal from a log stream into a structured command history.

**Independent Test**: Run `true && false && echo hello` in zsh with shell
integration installed. Scroll up and verify: green dot for `true`, red dot for
`false`, green dot for `echo hello`.

**Acceptance Scenarios**:

1. **Given** zsh with OSC 133 shell integration and a trusted session, **When**
   the user runs 3 commands, **Then** the gutter shows 3 dots with correct
   exit-code colors.
2. **Given** a previous command with exit code 1, **When** the user hovers the
   red dot, **Then** a tooltip shows "Exit code: 1".
3. **Given** a session with 50+ commands, **When** the user presses Cmd+↑
   (macOS) or Ctrl+↑ (Windows/Linux), **Then** the viewport scrolls to the
   previous prompt boundary.

---

### User Story 5 — Copy Command vs. Copy Output (Priority: P3)

As a developer, I can right-click a previous command and choose "Copy command"
vs. "Copy output" separately — I no longer need to manually select just the
command or just its output.

**Why this priority**: Depends on command-block tracking (S4/S5). High-value
UX but requires the full OSC 133 state model to be in place.

**Independent Test**: Run `ls -la /tmp` in bash with shell integration, then
right-click the output area → "Copy command" → verify clipboard contains
`ls -la /tmp`.

**Acceptance Scenarios**:

1. **Given** a completed command block tracked by `commandBlockTracker`,
   **When** the user right-clicks within the output region, **Then** the
   context menu shows "Copy Command" and "Copy Output" options.
2. **Given** the user clicks "Copy Command", **When** clipboard is read,
   **Then** it contains only the command text (not the prompt prefix or output).

---

### User Story 6 — Prompt Navigation (Priority: P3)

As a developer, I can press Cmd+↑ / Cmd+↓ to jump between prompts in my
scrollback — no more manual scrolling through pages of build output.

**Why this priority**: Natural keyboard navigation between command boundaries
is a high-frequency workflow accelerator. Requires OSC 133 command-block state.

**Independent Test**: Run a command that produces 200 lines of output, then
press Cmd+↑ and verify the viewport jumps to the prompt above the output.

**Acceptance Scenarios**:

1. **Given** 5 commands in scrollback, cursor at the bottom, **When** the
   user presses Cmd+↑ three times, **Then** the viewport scrolls to the 3rd
   command from the bottom.
2. **Given** the user is at the 3rd prompt, **When** they press Cmd+↓,
   **Then** the viewport scrolls to the 4th prompt.

---

### Edge Cases

- **Shell without bracketed paste support**: Putz must detect and fall back to
  raw write (no `\e[200~` prefix) — sending bracketed escapes to a
  non-supporting shell garbles input.
- **Nested shells**: User runs `bash` inside `zsh` — OSC 7/133 state must
  track the innermost shell. The handshake should re-negotiate on nested launch.
- **Ultra-long command output**: A command that produces 100K+ lines must not
  OOM the command-block tracker. Blocks should be capped or lazily indexed.
- **SSH passthrough**: OSC sequences from a remote host traverse the local PTY.
  The trust-gating handshake will NOT be present from the remote side — OSC 133
  features should be disabled for un-handshaked sessions.
- **`cat malicious.txt` injection**: A file containing `\e]133;A\a` should NOT
  create a fake prompt boundary — handshake gating prevents this.
- **Concurrent paste and OSC**: Pasting text that contains OSC sequences must
  not be interpreted as terminal control — bracketed paste isolates this.

---

## Requirements

### Functional Requirements

#### FR-Paste — Bracketed Paste (S1 #99)

- **FR-001**: System MUST consolidate all paste paths (context menu, Ctrl+Shift+V,
  Cmd+V, middle-click) into a single `pasteToTerminal` function that checks
  whether the PTY's terminal state has bracketed paste mode enabled.
- **FR-002**: When bracketed paste mode is enabled, the paste function MUST wrap
  the clipboard text with `\e[200~` prefix and `\e[201~` suffix.
- **FR-003**: When bracketed paste mode is NOT enabled, the paste function MUST
  write raw text without brackets.
- **FR-004**: System MUST NOT double-paste (the current dual-handler bug where
  both context menu and keyboard trigger separate paste calls).

#### FR-CWD — OSC 7 CWD Reporting (S2 #100)

- **FR-010**: System MUST use OSC 7 as the sole CWD source for all platforms
  where shell integration is active.
- **FR-011**: System MUST delete the Windows PEB hack (`pty/manager.rs:620-820`)
  and macOS `lsof` fallback (`manager.rs:600-618`).
- **FR-012**: System MUST retain `parseCwdFromTitle` (`cwdRegistry.ts:69`) as a
  last-resort fallback for sessions without shell integration, but MUST prefer
  OSC 7 when available.
- **FR-013**: The existing `parseCwdFromOsc7` function (`cwdRegistry.ts:46`) and
  OSC 7 handler (`useTerminal.ts:738`) MUST remain the canonical implementation;
  new work extends, not replaces.

#### FR-Install — Shell-Integration Install UX (S3 #101)

- **FR-020**: System MUST provide a Settings panel section showing detected
  shells as individual cards with install status, PLUS an "Install for all
  detected" button at the top of the panel for one-click bulk install.
- **FR-021**: Each card MUST offer a one-click "Install" button that writes the
  correct shell-integration snippet to the appropriate dotfile for the detected
  OS. The bulk "Install for all detected" button MUST invoke the same per-shell
  install logic for every shell whose status is "Detected" or "Outdated."
- **FR-022**: Each card MUST offer a "Show snippet" button for manual install.
- **FR-023**: Install scripts MUST use idempotent marker blocks:
  `# === putz shell integration ===` ... `# === end ===` (or platform equivalent).
- **FR-024**: Install scripts MUST back up the target dotfile before first write.
- **FR-025**: System MUST provide an "Uninstall" action that removes the marker
  block and restores the backup (if still available).
- **FR-026**: Shell-integration scripts MUST emit:
  - OSC 7 (CWD reporting) for all tier-1 shells
  - OSC 133 (command boundaries: prompt-start A, command-start B, command-end D
    with exit code) for all tier-1 shells
  - A Putz-specific handshake OSC at shell startup (for trust gating — see
    FR-Security)

#### FR-Boundaries — OSC 133 Command Boundaries (S4 #102)

> **Decision: Full adoption (Option A).** Refactor the renderer mental model for
> command blocks. ~2 sprints. This is architecturally the largest ticket.

- **FR-030**: System MUST parse OSC 133 sequences A (prompt start), B (command
  start), C (command end / output start), D (command complete, with exit code)
  from the PTY output stream.
- **FR-031**: System MUST maintain a per-tab ordered list of `CommandBlock`
  records: `{ promptStartLine, commandStartLine, commandText, outputStartLine,
  commandEndLine, exitCode, sessionId }`.
- **FR-032**: The `CommandBlock` list MUST survive scrollback trimming — entries
  whose markers are trimmed are evicted.
- **FR-033**: System MUST only populate `CommandBlock` records for sessions that
  have completed the shell-integration handshake (see FR-Security) — OSC 133
  from un-handshaked sessions MUST be silently ignored.
- **FR-034**: System MUST expose the `CommandBlock` list via a Zustand store
  keyed by `sessionId` (consistent with existing `layoutStore`, `tabStore`,
  `workspaceStore` patterns) so that UI components (gutter, nav, context menu)
  can read it without prop drilling.

#### FR-Gutter — Per-Command Gutter UX (S5 #103)

- **FR-040**: System MUST render a gutter column alongside the terminal viewport
  showing a colored dot (green = exit 0, red = non-zero) for each completed
  command block.
- **FR-041**: Hovering a dot MUST show a tooltip with the exit code.
- **FR-042**: System MUST support Cmd+↑ / Cmd+↓ (macOS) and Ctrl+↑ / Ctrl+↓
  (Windows/Linux) to navigate between prompt boundaries.
- **FR-043**: System MUST support right-click context menu on a command block
  with "Copy Command" and "Copy Output" actions.
- **FR-044**: System MUST support output folding — clicking a gutter dot (or a
  fold icon) collapses/expands the output region of a command block.
- **FR-045**: The gutter MUST be behind a Settings toggle initially (feature
  flag), defaulting to ON for sessions with active shell integration.

#### FR-Perf — Spawn-Time Measurement (S6 #104)

> **Decision: Measure first, set budget later.** S6 is two-phase.

- **FR-050**: Phase 1 MUST establish baseline spawn-time measurements across
  macOS (zsh), Linux (bash), and Windows (pwsh) in CI.
- **FR-051**: Phase 1 MUST measure cold-tab spawn time (time from `pty_spawn`
  invoke to first prompt byte received) as a p95 over 20 spawns.
- **FR-052**: Phase 2 (follow-up ticket after data) MUST define per-platform
  SLOs based on Phase 1 baselines and enforce them as CI gates.

#### FR-Compat — Shell Compatibility Test Suite (S7 #105)

- **FR-060**: System MUST have an automated test suite that drives real shell
  sessions through Putz's PTY and verifies rendering correctness.
- **FR-061**: Tests MUST cover: cursor positioning, `\e[K` (erase-in-line),
  autosuggestion dimming (fish, zsh-autosuggestions), syntax-highlight colors
  (fish, zsh-syntax-highlighting), history search overlay (Ctrl+R).
- **FR-062**: Tests MUST run for tier-1 shells: zsh, bash, fish (macOS/Linux);
  pwsh, cmd (Windows).

#### FR-Corpus — VT Correctness Fixtures (S8 #107)

- **FR-070**: System MUST port ≥100 VT/ANSI test fixtures from Windows Terminal
  and/or xterm.js test suites.
- **FR-071**: Fixtures MUST run in CI and block merges on regression.
- **FR-072**: Fixtures MUST cover: basic SGR (colors, bold, underline), cursor
  movement (CUP, CUU, CUD, CUF, CUB), erase (ED, EL), scrolling regions
  (DECSTBM), OSC 7 and OSC 133 parsing, bracketed paste mode toggle detection.

#### FR-Security — OSC Injection Threat Model

- **FR-080**: System MUST maintain an allowlist of parsed OSC sequences. Initial
  allowlist: OSC 7 (CWD), OSC 133 (prompt/command boundaries), bracketed paste
  mode toggles (CSI `?2004h` / `?2004l`). All other OSC sequences MUST be
  passed through to xterm.js without Putz-level interpretation.
- **FR-081**: OSC 133 prompt-marker tracking MUST only activate after the shell
  sends the Putz-specific integration handshake OSC (`\e]133;P;putz=1\a`) at
  session startup. Sessions that have not completed the handshake MUST treat
  OSC 133 as opaque data.
- **FR-082**: All OSC payloads MUST be validated as well-formed UTF-8 before
  string-interpolating into any Putz data structure.
- **FR-083**: Individual OSC payloads MUST be rejected if they exceed 8 KB.
- **FR-084**: The shell-integration install scripts (S3) MUST emit the handshake
  OSC at shell startup so that trust gating activates automatically for users who
  install integration.

### Key Entities

- **CommandBlock**: A semantic record of one command's lifecycle in a terminal
  session — prompt start line, command text, output region, exit code. Produced
  by `commandBlockTracker` from OSC 133 events.
- **ShellIntegrationStatus**: Per-shell detection state — `{ shell, version,
  detected, installed, snippetPath, os }`. Drives the Settings panel cards.
- **OscEvent**: Typed union emitted by `oscParser` — `OscCwd`, `OscPromptStart`,
  `OscCommandStart`, `OscCommandEnd`, `OscHandshake`.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Bracketed paste works correctly on macOS/Linux/Windows for zsh,
  bash, fish, pwsh — verified by automated tests. Zero duplicate-paste bugs.
- **SC-002**: OSC 7 CWD updates within 1 frame of prompt appearing for all
  tier-1 shells. PEB hack code (`manager.rs:620-820`) and lsof fallback
  (`manager.rs:600-618`) are deleted. Zero CWD regressions.
- **SC-003**: Shell-integration install button works on all 3 OSes for all
  tier-1 shells. Install is idempotent, backs up dotfiles, and is reversible.
- **SC-004**: OSC 133 prompt boundaries render correctly with PSReadLine (pwsh),
  fish native, zsh + ohmyzsh/powerlevel10k, bash + bash-preexec.
- **SC-005**: Per-command gutter renders exit codes with green/red dots. Cmd+↑ /
  Cmd+↓ navigation works. "Copy Command" and "Copy Output" context menu items work.
- **SC-006**: Phase 1 perf baseline established — p95 spawn time measured for
  all 3 platforms in CI. Phase 2 budgets set from data (follow-up ticket).
- **SC-007**: ≥100 VT correctness fixtures ported and running in CI, blocking
  merges on regression.
- **SC-008**: OSC injection threat model documented and enforced — handshake
  gating prevents `cat malicious.txt` from spoofing prompt boundaries.

---

## Assumptions

- **A-001**: Putz targets local developer workstations only — no remote/SSH
  session management (per #86 decommissioning decision).
- **A-002**: xterm.js's `terminal.parser.registerOscHandler()` API is stable
  and sufficient for intercepting OSC 7 and OSC 133 — no xterm.js fork needed.
- **A-003**: Tier-1 shells (zsh, bash, fish, pwsh) all support or can be taught
  to emit OSC 7 and OSC 133 via shell-integration scripts. cmd.exe support is
  limited to OSC 7 only (no prompt-marking concept).
- **A-004**: The Tauri 2.0 PTY layer (`pty/manager.rs`) passes bytes through
  transparently — it does not strip, buffer, or rewrite OSC sequences. The PTY
  layer requires no protocol-aware changes.
- **A-005**: Shell-integration scripts can be safely appended to user dotfiles
  using marker-delimited blocks without interfering with existing shell config.
- **A-006**: nushell is tier-2 (best-effort). It is not a CI-gating shell.
  nushell support may lag behind tier-1 shells.

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
| Paste Safety | Consolidate paste handlers, verify bracketed paste mode | S1 #99 |
| CWD Protocol | OSC 7 as primary CWD, delete legacy hacks | S2 #100 |
| Shell Integration Install | Settings UI + dotfile management + scripts | S3 #101 |
| Command Boundaries | OSC 133 parser + command-block state model | S4 #102 |
| Command Gutter UX | Exit-code gutter, nav, copy, folding | S5 #103 |
| Performance Baseline | Spawn-time measurement framework | S6 #104 |
| Shell Compat Tests | Real-shell rendering test suite | S7 #105 |
| VT Corpus | Ported VT/ANSI correctness fixtures | S8 #107 |

### Sequencing and dependencies

```
S1 (#99 paste) → S2 (#100 OSC 7) → S3 (#101 install) → S4 (#102 OSC 133) → S5 (#103 gutter)
                        ↓
                     S8 (#107 corpus, parallel after S2)
S6 (#104 perf) — independent, parallel
S7 (#105 shell compat) — independent, parallel
```

- **Phase A (foundation):** S1 #99 — paste audit. Low risk, validates the paste
  pipeline. Already in progress.
- **Phase B (CWD):** S2 #100 — OSC 7 primary. Depends on S1 completing so the
  protocol pipeline is validated.
- **Phase C (integration & boundaries):** S3 #101 → S4 #102 — install scripts
  then OSC 133 full adoption. S3 must land first so shells emit OSC 133.
- **Phase D (UX):** S5 #103 — gutter UX. Depends on S4's command-block state
  model existing.
- **Parallel:** S6 #104 (perf), S7 #105 (compat), S8 #107 (corpus) can proceed
  independently of the main chain.

### Decomposition rationale

The dependency chain follows the protocol stack bottom-up: paste safety validates
the PTY write path, OSC 7 validates the PTY read/parse path, shell-integration
scripts provide the data source, OSC 133 parsing builds the state model, and the
gutter UX consumes it. Perf, compat, and corpus tests are orthogonal and
parallelizable. This decomposition ensures each ticket has a working system to
build on and test against.

---

## Guardian Consultation Results

### Security Guardian

- **OSC injection mitigation**: Allowlist-only OSC parsing (FR-080). Prevents
  arbitrary OSC from being interpreted as Putz commands.
- **Trust gating via handshake**: OSC 133 features require a Putz-specific
  handshake OSC from the shell-integration script (FR-081). Prevents `cat
  malicious.txt` from creating fake prompt boundaries. Pattern inspired by
  iTerm2's shell-integration handshake and VS Code's OSC 633 gating.
- **Payload size cap**: 8 KB per OSC payload (FR-083). Prevents buffer-overflow
  or DoS via crafted oversized sequences. Pattern from WezTerm's
  `mux_output_parser_buffer_size`.
- **UTF-8 validation**: All OSC payloads validated before string interpolation
  (FR-082). Prevents encoding-based injection.
- **Dotfile write safety**: Install scripts must back up and use marker blocks
  (FR-024, FR-023). Prevents data loss if install corrupts a dotfile.

### Privacy Guardian

- N/A — this epic handles terminal I/O protocol parsing. No PII, PHI, or
  user-identifying data is collected, stored, or transmitted. Shell-integration
  scripts run locally and do not phone home.

### Platform Guardian

- N/A — Putz is a desktop application (Tauri 2.0). No Kubernetes, cloud
  infrastructure, or network service deployment. Platform concerns are limited
  to cross-OS compatibility, which is addressed in the per-OS install UX design
  and tier-1 shell matrix.

### Delivery Guardian

- **Feature flagging**: The OSC 133 gutter UX (S5) should ship behind a Settings
  toggle, defaulting to ON for handshaked sessions. This enables a two-stage
  rollout: parser ships first, gutter behind flag, then default-on after
  stabilization (see Risks).
- **CI gates**: VT corpus tests (S8) and perf measurements (S6 Phase 1) must be
  CI-blocking before S4/S5 land — they provide the safety net for the renderer
  refactor.

### Code Review Guardian (architectural impact)

- **Mental model shift**: The PTY output stream changes from "opaque byte
  stream → xterm.js" to "opaque byte stream → OSC event stream → xterm.js +
  Putz state." This is the single largest architectural delta. All downstream
  consumers of terminal state (RegionView, path bar, tab titles) must adapt to
  the new event-driven model.
- **`useTerminal.ts` complexity**: This file is already ~900 lines. The OSC 133
  state model should be extracted into a separate module
  (`commandBlockTracker.ts`) to maintain Single Responsibility. The hook should
  wire modules together, not implement protocol logic.
- **Store vs. ref for CommandBlock list**: Recommend a lightweight store (Zustand
  or a module-level Map) rather than React state — the gutter, context menu, and
  keyboard nav all need access without prop drilling. The store key should be
  `sessionId`.
- **Backward compatibility**: No breaking changes to existing interfaces.
  `cwdRegistry.ts` retains its API. `useTerminal.ts` retains its hook contract.
  New components are additive.

---

## System Impact

### Affected components

| Component | Change type | Description |
|-----------|-------------|-------------|
| `useTerminal.ts` | Modified | Wire `oscParser` into xterm.js parser hook chain. Register OSC 7 (existing), OSC 133 (new) handlers. Consolidate paste logic (S1). |
| `cwdRegistry.ts` | Modified | Becomes secondary fallback; OSC 7 handler promoted to primary CWD source. No API changes. |
| `pty/manager.rs` | Modified | Delete PEB hack (~200 lines of unsafe FFI, lines 620–820), delete lsof fallback (lines 600–618), delete prompt-scan regex (useTerminal.ts:113–196). Retain OSC 7 PowerShell injection (lines 161–181). |
| `TerminalView.tsx` | Modified | Add gutter column alongside terminal viewport (S5). |
| `RegionView.tsx` | Modified | Pass `commandBlockTracker` state to new `CommandGutter` component. |
| `SettingsTab.tsx` | Modified | Add Shell Integration section with per-shell cards (S3). |
| `oscParser.ts` | **New** | Parses OSC sequences from PTY output stream, emits typed `OscEvent` union. Consumed by `useTerminal.ts`. |
| `commandBlockTracker.ts` | **New** | Consumes `OscEvent` stream, builds per-tab ordered list of `CommandBlock` records. Exposes store. |
| `CommandGutter.tsx` | **New** | Renders exit-code dots, handles click-to-fold, integrates with keyboard nav. |
| `ShellIntegrationInstaller.ts` | **New** | Detects installed shells, manages dotfile writes, renders Settings cards. |
| `assets/shell-integration/*.sh` | **New** | Per-shell scripts: `bash.sh`, `zsh.sh`, `fish.fish`, `pwsh.ps1`. Emit OSC 7, OSC 133, and handshake sequences. |

### Affected contracts

| Contract | Change | Backward compatible? |
|----------|--------|---------------------|
| `parseCwdFromOsc7()` | No change — existing API retained | Yes |
| `parseCwdFromTitle()` | Demoted to fallback, no API change | Yes |
| `recordSessionCwd()` | No change — still called by OSC 7 handler | Yes |
| `pty_cwd` Tauri command | May be deprecated once PEB hack is deleted. Frontend callers must use `cwdRegistry` instead. | Yes — command can return `None` gracefully |
| `pasteToTerminal()` | Signature unchanged; internal logic adds bracket wrapping | Yes |
| New: `OscEvent` type union | New contract — no existing consumers to break | N/A |
| New: `CommandBlock` store API | New contract — no existing consumers to break | N/A |

### Architectural deltas

- **Assumption that changes**: PTY output is no longer treated as an opaque byte
  stream at the Putz application layer. It is now a stream of **semantic events**
  (CWD changes, prompt boundaries, command completions) interleaved with
  passthrough terminal data. xterm.js still receives the full byte stream for
  rendering; Putz intercepts specific OSC sequences for higher-level features.
- **Assumption that changes**: CWD is no longer derived from OS-level process
  introspection (PEB/lsof). It is derived from the shell's own reporting via
  OSC 7. This inverts the trust model: the shell (not the OS) is the authority
  on CWD.
- **Assumption that changes**: Not all terminal sessions are equal. Sessions
  with shell-integration handshake unlock richer features (command-block
  tracking, gutter). Sessions without it degrade gracefully to today's behavior.

### Backward compatibility and migration

- **Breaking changes:** None. All new features are additive. Existing terminal
  behavior is preserved for sessions without shell integration.
- **Migration path:** Users install shell integration via Settings → one click.
  No forced migration; the old CWD fallback (`parseCwdFromTitle`) remains for
  legacy shells.
- **Deprecation timeline:** PEB hack and lsof fallback are deleted in S2. The
  `pty_cwd` Tauri command may be deprecated in a follow-up once all callers
  migrate to `cwdRegistry`.

### Risk surface

- **Risks introduced:**
  - OSC 133 state model adds complexity to the terminal rendering pipeline. A
    bug in `commandBlockTracker` could corrupt the command-block list, causing
    incorrect gutter rendering. **Mitigation:** feature flag + extensive
    automated tests (S7, S8).
  - Shell-integration install modifies user dotfiles. A bug could corrupt shell
    config. **Mitigation:** backup before write, marker-delimited blocks,
    uninstall action (FR-023, FR-024, FR-025).
  - OSC injection from untrusted sources. **Mitigation:** handshake gating,
    allowlist, size cap, UTF-8 validation (FR-080–084).
- **Risks reduced:**
  - Eliminates ~200 lines of `unsafe` Rust FFI (PEB hack) — removes a class of
    memory-safety and crash risks on Windows.
  - Eliminates `lsof` process spawning on macOS — removes a latency source and
    child-process leak risk.
  - Eliminates prompt-scan regex heuristics — removes a fragile, untestable
    code path.

---

## Product Impact

### Positioning shift

This epic moves Putz from "terminal emulator with a canvas and git graph" to
"best-in-class local developer terminal with semantic shell integration." The
shell-integration feature set (command-block tracking, exit-code gutter,
prompt navigation, per-command copy) matches and in some areas exceeds iTerm2,
Windows Terminal, and Warp.

### Scope boundary changes

- **Opens:** Per-command UX features (output folding, AI-powered error
  explanation per command block, command history search with exit-code filter).
- **Opens:** Shell-integration script as an extensibility point for future
  features (e.g., inline error annotations, build-system integration).
- **Explicitly closes:** Remote/SSH shell integration (per #86 decommissioning).
  This epic is local-only.

### Roadmap dependencies

- **Unlocks:** AI terminal assistant (future epic) — can consume `CommandBlock`
  records to understand what the user is doing.
- **Unlocks:** Output folding + collapsed command-block view.
- **Unlocks:** Command palette search with exit-code filtering.
- **Depends on:** #86 SecureCRT decommissioning (must be complete).
- **Blocks or delays:** None — this epic is additive.

### User-facing communication

- **Internal stakeholders to inform:** None (solo project).
- **External communication needed:** CHANGELOG entry for v0.5.0 (or next
  minor). README update to document shell-integration install. Consider a
  short demo GIF showing the exit-code gutter + prompt navigation.

---

## Threat Model: OSC Injection

> This section documents the security architecture for handling untrusted OSC
> sequences. It captures the rationale behind FR-080 through FR-084.

### Attack vector

A user runs `cat malicious.txt` (or `curl ... | less`) and the file contains
crafted OSC escape sequences. Without protection, these sequences could:

1. **Spoof prompt boundaries** — inject `\e]133;A\a` to create fake command
   blocks, corrupting the gutter and navigation.
2. **Set false CWD** — inject `\e]7;file:///etc/shadow\a` to mislead file-link
   resolution.
3. **Buffer overflow** — send an unbounded OSC payload to exhaust memory.

### Industry precedent

| Terminal | Approach | CVEs / incidents |
|----------|----------|------------------|
| **kitty** | Sandboxed OSC handlers; specific ones enabled by default | Multiple OSC-injection CVEs; retroactively added sandboxing |
| **iTerm2** | Opt-in shell-integration handshake; features only activate after user installs iTerm2 shell-integration script that negotiates a magic value | Effective — handshake prevents passive injection |
| **Windows Terminal** | Parses OSC permissively, renders defensively; most handlers are no-ops or strictly bounded | No major CVEs; permissive-but-defensive stance |
| **WezTerm** | `mux_output_parser_buffer_size` cap; rejects oversized payloads | Size-based mitigation; no handshake |
| **VS Code Terminal** | Uses OSC 633 (a 133 variant) gated on shell-integration injection from VS Code itself; never trusts arbitrary OSC 133 from PTY output | Effective — VS Code controls the injection point |

### Putz approach (recommended)

Combine the strongest patterns from iTerm2 (handshake gating) and WezTerm
(size caps) with an explicit allowlist:

1. **Allowlist**: Only OSC 7 (CWD), OSC 133 (prompt/command boundaries), and
   bracketed paste mode toggles are parsed by Putz-level code. All other OSC
   sequences pass through to xterm.js unchanged.
2. **Handshake gating**: OSC 133 prompt-marker tracking only activates after
   the shell sends the Putz-specific integration handshake OSC
   (`\e]133;P;putz=1\a`) at session startup. This piggybacks on the OSC 133
   subparameter namespace — no new OSC code registration needed. The
   shell-integration install scripts (S3) emit this automatically. Sessions
   without the handshake treat OSC 133 as opaque data — xterm.js may render
   them, but Putz does not build `CommandBlock` records from them.
3. **Size cap**: Individual OSC payloads exceeding 8 KB are rejected (logged
   and discarded).
4. **UTF-8 validation**: All OSC payloads are validated as well-formed UTF-8
   before being interpolated into TypeScript strings or data structures.

This approach is **locked in** — approved by the user as the security model for
this epic.

---

## Shell-Integration Install UX: Per-OS Design

> This section expands on FR-Install (S3 #101) with platform-specific details.
> It captures the multiplatform considerations the user flagged.

### Per-OS dotfile targets

| OS | Shell | Dotfile path | Notes |
|----|-------|-------------|-------|
| macOS | zsh | `~/.zshrc` | Default shell. Homebrew may set `ZDOTDIR`. |
| macOS | bash | `~/.bashrc` (sourced by `~/.bash_profile`) | macOS bash is v3.2 (GPLv2); Homebrew bash is v5+. Script must work on both. |
| macOS | fish | `~/.config/fish/config.fish` | XDG-compliant. |
| Linux | zsh | `~/.zshrc` | Same as macOS. |
| Linux | bash | `~/.bashrc` | Ubuntu sources `~/.profile` → `~/.bashrc` on login. Script in `.bashrc` works. |
| Linux | fish | `~/.config/fish/config.fish` | Same as macOS. |
| Windows | pwsh (PS 7) | `$PROFILE.CurrentUserCurrentHost` | Path: `~\Documents\PowerShell\Microsoft.PowerShell_profile.ps1` (varies). |
| Windows | Windows PowerShell (5.1) | `$PROFILE.CurrentUserCurrentHost` | Path: `~\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`. |
| Windows | cmd.exe | Registry `HKCU\Software\Microsoft\Command Processor\AutoRun` | No dotfile concept. Uses AutoRun registry key. Limited integration (OSC 7 only). See safeguards below. |
| All | nushell (tier-2) | `~/.config/nushell/env.nu` | Best-effort. Not CI-gating. |

### Proposed UX: Hybrid — Per-shell cards + bulk install

The Settings → Shell Integration panel shows one card per detected shell, with
an **"Install for all detected"** button at the top of the panel for users who
want one-click setup:

```
┌─────────────────────────────────────────────┐
│ 🐚 zsh (detected: /bin/zsh, v5.9)         │
│ Status: ✅ Installed (v1.0)                │
│ [Update]  [Uninstall]  [Show snippet]      │
├─────────────────────────────────────────────┤
│ 🐚 bash (detected: /usr/bin/bash, v3.2)   │
│ Status: ❌ Not installed                   │
│ [Install]  [Show snippet]                  │
├─────────────────────────────────────────────┤
│ 🐚 fish (not detected)                    │
│ Status: ⚪ Shell not found                 │
│ [Show snippet]                             │
└─────────────────────────────────────────────┘
```

**Panel layout:**
- Top: **"Install for all detected"** button — invokes Install for every shell
  with status "Detected" or "Outdated". One click, all shells patched.
- Below: Per-shell cards for granular control and visibility.

Each card:
- Detects the shell binary path and version
- Shows current install status (installed, not installed, outdated)
- "Install" writes the snippet to the dotfile with marker blocks
- "Show snippet" reveals the raw script for manual copy
- "Uninstall" removes the marker block

#### cmd.exe install safeguards

Because cmd.exe uses the `HKCU\Software\Microsoft\Command Processor\AutoRun`
registry key (not a dotfile), the cmd.exe install card MUST implement these
additional safeguards:

1. **Show before write**: Before applying, display the exact registry value
   being written in a readable code block. The user must confirm.
2. **Plain-language explanation**: The card must explain that AutoRun runs every
   time `cmd.exe` opens, and that Putz is adding a small script to emit OSC 7
   CWD reporting.
3. **Surgical uninstall**: If other applications have chained AutoRun values
   (e.g., `doskey /macrofile=... & putz-integration.cmd`), the uninstall action
   MUST parse the existing value, remove only Putz's contribution, and preserve
   the rest. Must NOT delete the entire AutoRun key if other entries exist.

---

## Resolved Questions

All open questions have been resolved. Decisions are locked into the relevant
spec sections.

| # | Question | Resolution | Resolved |
|---|----------|------------|----------|
| OQ-1 | Install UX: per-shell card vs bulk install | **Hybrid** — per-shell cards PLUS "Install for all detected" button at top. See "Shell-Integration Install UX" section. | 2026-05-03 |
| OQ-2 | Security model: confirm allowlist + handshake gating | **Approved as proposed.** Allowlist + `\e]133;P;putz=1\a` handshake + 8 KB cap + UTF-8 validation. See "Threat Model" section. | 2026-05-03 |
| OS-1 | Handshake OSC format | **Approved.** `\e]133;P;putz=1\a` — piggyback on OSC 133 subparameter namespace. | 2026-05-03 |
| OS-2 | CommandBlock state pattern | **Approved.** Zustand store keyed by sessionId. Consistent with existing store patterns. | 2026-05-03 |
| OS-3 | cmd.exe via AutoRun registry | **Approved with safeguards.** Show-before-write, plain-language explanation, surgical uninstall. See "cmd.exe install safeguards" subsection. | 2026-05-03 |
| OS-4 | Gutter feature-flag default | **Default ON for handshaked sessions.** Non-handshaked sessions show no gutter. | 2026-05-03 |

---

## Out of Scope

These are explicitly NOT part of this epic:

- **OSC 4 / OSC 10–19 color queries** — not needed for terminal UX. Putz
  manages themes independently.
- **Sixel / iTerm2 inline image protocol** — separate future epic. Requires
  significant renderer changes orthogonal to command-boundary tracking.
- **OSC 633 (VS Code variant of 133)** — only adopt if VS Code-Terminal interop
  becomes a goal. OSC 133 is the standard.
- **Tab tear-out / drag-between-windows** — Windows Terminal pattern, separate
  ticket. Unrelated to shell integration protocols.
- **Accessibility / UIA tree** — separate epic. Shell integration does not
  change the accessibility surface (though command blocks may inform future
  screen-reader improvements).
- **Remote/SSH shell integration** — explicitly excluded per #86
  decommissioning. This epic is local-only.
- **Shell-integration for non-tier-1 shells** (e.g., elvish, xonsh, oil) —
  may be contributed by community; not in scope for this epic.

---

## Risks & Mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R-1 | OSC 133 renderer refactor (S4) is the largest piece — high complexity, high blast radius | High | Feature-flag behind a Settings toggle. Ship parser first (captures data), gutter behind flag, then default-on after 1 release of stabilization. Extensive test coverage via S7 + S8. |
| R-2 | Shell-integration install writes to user dotfiles — could corrupt shell config | Medium | Marker-delimited blocks (`# === putz shell integration ===`). Backup before first write. Idempotent updates (replace between markers). Uninstall removes the block. |
| R-3 | OSC injection via `cat malicious.txt` spoofing prompt boundaries | Medium | Handshake gating (FR-081): OSC 133 only tracked for handshaked sessions. Allowlist (FR-080): only specific OSCs parsed. Size cap (FR-083): 8 KB. UTF-8 validation (FR-082). |
| R-4 | `useTerminal.ts` is already ~900 lines; adding OSC 133 wiring risks making it unmaintainable | Medium | Extract protocol logic into `oscParser.ts` and `commandBlockTracker.ts`. The hook wires modules; it doesn't implement protocol parsing. Code Review Guardian to enforce during S4 PR. |
| R-5 | macOS bash is v3.2 (2007); shell-integration script must avoid bash 4+ features | Low | Test on macOS default bash. Use POSIX-compatible constructs in the bash integration script. CI matrix includes bash 3.2. |
| R-6 | Windows `cmd.exe` has no profile/dotfile concept — install UX is awkward | Low | cmd.exe gets registry AutoRun approach for OSC 7 only. No OSC 133 for cmd (no prompt-marking concept). Document limitation clearly. |
| R-7 | Perf measurements vary by CI runner hardware — baselines may not be reproducible | Low | Phase 1 establishes baselines on Putz's actual CI runners. Phase 2 sets budgets with tolerance margins. Accept that CI perf tests are indicative, not deterministic. |

---

## Tier-1 Shell Matrix

| Shell | macOS | Linux | Windows | OSC 7 | OSC 133 | Notes |
|-------|-------|-------|---------|-------|---------|-------|
| zsh | ✅ Tier-1 | ✅ Tier-1 | N/A | Native (5.1+) | Via script | Default macOS shell |
| bash | ✅ Tier-1 | ✅ Tier-1 | N/A | Via script | Via script + bash-preexec | macOS ships v3.2; script must be compatible |
| fish | ✅ Tier-1 | ✅ Tier-1 | N/A | Native (3.4+) | Native (3.5+) | fish has built-in OSC 133 support in recent versions |
| pwsh (PS 7) | N/A | N/A | ✅ Tier-1 | Via `$prompt` (already injected by Putz) | Via PSReadLine hooks | PSReadLine 2.3+ has built-in OSC 133 support |
| cmd.exe | N/A | N/A | ✅ Tier-1 | Via AutoRun/doskey | ❌ Not feasible | No prompt-marking concept in cmd |
| nushell | ⚡ Tier-2 | ⚡ Tier-2 | ⚡ Tier-2 | Via script | Via script | Best-effort, not CI-gating |

---

## Appendix — References

- [OSC 133 Specification (FinalTerm)](https://iterm2.com/documentation-escape-codes.html) — de facto standard adopted by iTerm2, Windows Terminal, VS Code, WezTerm
- [OSC 7 — CWD Reporting](https://gitlab.freedesktop.org/terminal-wg/specifications/-/issues/20) — freedesktop terminal-wg specification
- [Bracketed Paste Mode](https://cirw.in/blog/bracketed-paste) — CSI `?2004h/l` specification
- [iTerm2 Shell Integration](https://iterm2.com/documentation-shell-integration.html) — reference implementation for install scripts and handshake
- [VS Code Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration) — OSC 633 variant; gated on VS Code-controlled injection
- [Windows Terminal Shell Integration](https://learn.microsoft.com/en-us/windows/terminal/tutorials/shell-integration) — PowerShell and bash integration guides
- [WezTerm OSC handling](https://wezfurlong.org/wezterm/config/lua/config/mux_output_parser_buffer_size.html) — size-cap mitigation
- [kitty OSC security issues](https://github.com/kovidgoyal/kitty/issues?q=is%3Aissue+osc+security) — CVE history
- [xterm.js Parser API](https://xtermjs.org/docs/api/terminal/classes/Terminal/#registeroschandler) — `registerOscHandler` used for OSC 7 and will be used for OSC 133
- [bash-preexec](https://github.com/rcaloras/bash-preexec) — required for OSC 133 in bash (no native preexec/precmd hooks)
- Putz Epic: [#98](https://github.com/vbomfim/putz/issues/98)
- Putz SecureCRT Decommissioning: [#86](https://github.com/vbomfim/putz/issues/86)
