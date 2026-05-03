# Shell Compatibility Test Fixtures

Documentation for the S7 shell compatibility test suite — Layer 1 (synthetic PTY byte streams).

## Overview

The shell compatibility test suite validates that common shell features render
correctly through xterm.js's escape sequence parser and buffer model. Tests feed
pre-recorded byte streams into a headless Terminal instance and assert on the
resulting buffer state (text content, cursor position, cell colors, attributes).

**What it tests:**

- Prompt rendering (colors, formatting)
- Autosuggestion/prediction display (dim/grey ghost text)
- Erase-in-line (`\e[K`) for prompt redraws
- 256-color SGR sequences
- CJK/wide character cell widths
- Bracketed paste marker invisibility
- History search overlay rendering
- OSC 7 CWD reporting (stub — depends on S2)

**What it does NOT test:**

- Pixel-perfect rendering (xterm.js's job, not Putz's)
- Real shell process spawning (Layer 2 — future)
- IME / accessibility (separate epic)
- Nushell (tier-2, best-effort, not gating CI)

## Architecture

```
src/
├── lib/terminal/
│   └── shellCompatHarness.ts          # Harness: bytes → headless Terminal
├── test/shellCompat/
│   ├── fixtures/                       # Binary .bytes fixture files
│   │   ├── zsh-cold-prompt.bytes
│   │   ├── zsh-autosuggest.bytes
│   │   ├── zsh-multiline-redraw.bytes
│   │   ├── zsh-256color.bytes
│   │   ├── zsh-cursor-movement.bytes
│   │   ├── zsh-cjk.bytes
│   │   ├── zsh-osc7.bytes
│   │   ├── bash-cold-prompt.bytes
│   │   ├── bash-history-search.bytes
│   │   ├── bash-multiline-redraw.bytes
│   │   ├── bash-256color.bytes
│   │   ├── bash-bracketed-paste.bytes
│   │   ├── fish-cold-prompt.bytes
│   │   ├── fish-suggestions.bytes
│   │   ├── fish-syntax-highlight.bytes
│   │   ├── fish-256color.bytes
│   │   ├── fish-cjk.bytes
│   │   ├── pwsh-cold-prompt.bytes
│   │   ├── pwsh-psreadline.bytes
│   │   ├── pwsh-history-search.bytes
│   │   ├── pwsh-256color.bytes
│   │   ├── cmd-cold-prompt.bytes
│   │   └── cmd-256color.bytes
│   ├── generateFixtures.ts             # Fixture generator script
│   ├── zsh.test.ts                     # zsh test scenarios
│   ├── bash.test.ts                    # bash test scenarios
│   ├── fish.test.ts                    # fish test scenarios
│   ├── pwsh.test.ts                    # PowerShell / PSReadLine tests
│   └── cmd.test.ts                     # cmd.exe tests
docs/
└── shell-compat-fixtures.md            # This file
```

## Fixture Inventory

### zsh (7 fixtures, 16 tests)

| Fixture                      | Size | Scenarios                                      |
| ---------------------------- | ---- | ---------------------------------------------- |
| `zsh-cold-prompt.bytes`      | 48B  | Colored prompt rendering, SGR bold+green       |
| `zsh-autosuggest.bytes`      | 45B  | Ghost text with dim attribute, cursor position |
| `zsh-multiline-redraw.bytes` | 74B  | `\e[K` erase-in-line, no trailing artifacts    |
| `zsh-256color.bytes`         | 87B  | 256-color fg (palette 82), color reset         |
| `zsh-cursor-movement.bytes`  | 28B  | Cursor backward, buffer integrity              |
| `zsh-cjk.bytes`              | 63B  | Wide characters, 2-cell width                  |
| `zsh-osc7.bytes`             | 104B | OSC 7 invisibility, prompt after OSC           |

### bash (5 fixtures, 10 tests)

| Fixture                       | Size | Scenarios                                     |
| ----------------------------- | ---- | --------------------------------------------- |
| `bash-cold-prompt.bytes`      | 48B  | Colored PS1 prompt                            |
| `bash-history-search.bytes`   | 92B  | Ctrl+R reverse-i-search banner, matched entry |
| `bash-multiline-redraw.bytes` | 141B | Multi-line output + clean prompt redraw       |
| `bash-256color.bytes`         | 165B | Dual 256-color (red 196 + green 82)           |
| `bash-bracketed-paste.bytes`  | 96B  | Paste marker invisibility, content visibility |

### fish (5 fixtures, 11 tests)

| Fixture                       | Size | Scenarios                                 |
| ----------------------------- | ---- | ----------------------------------------- |
| `fish-cold-prompt.bytes`      | 55B  | Multi-segment prompt (user@host path>)    |
| `fish-suggestions.bytes`      | 73B  | Grey autosuggestion (SGR 90), cursor      |
| `fish-syntax-highlight.bytes` | 126B | Valid=green, invalid=red, erase artifacts |
| `fish-256color.bytes`         | 143B | 256-color fg (palette 208 orange)         |
| `fish-cjk.bytes`              | 111B | Japanese CJK (日本語), 2-cell width       |

### PowerShell / PSReadLine (4 fixtures, 9 tests)

| Fixture                     | Size | Scenarios                               |
| --------------------------- | ---- | --------------------------------------- |
| `pwsh-cold-prompt.bytes`    | 30B  | PS prompt with yellow path              |
| `pwsh-psreadline.bytes`     | 60B  | Inline prediction (SGR 90 grey), cursor |
| `pwsh-history-search.bytes` | 95B  | Reverse search banner, reverse video    |
| `pwsh-256color.bytes`       | 120B | 256-color fg (palette 82 green)         |

### cmd.exe (2 fixtures, 3 tests)

| Fixture                 | Size | Scenarios                               |
| ----------------------- | ---- | --------------------------------------- |
| `cmd-cold-prompt.bytes` | 17B  | Standard `C:\Users\dev>` prompt         |
| `cmd-256color.bytes`    | 83B  | ANSI color support (Windows 10+), reset |

## Capturing Real Fixtures

The current fixtures are synthetic — hand-crafted escape sequences matching
documented shell behavior. For higher fidelity, replace them with real captures:

### macOS / Linux

```bash
# Record a zsh session with autosuggestions
script -q zsh-autosuggest.bytes -c 'PROMPT="❯ " zsh -i'
# In the session: type "git" (wait for suggestion), then Ctrl+D to exit

# Record fish session
script -q fish-suggestions.bytes -c 'fish -i'

# Record bash Ctrl+R
script -q bash-history-search.bytes -c 'bash -i'

# Alternative: use ttyrec for more control
ttyrec zsh-autosuggest.bytes -e 'zsh -i'

# Or asciinema raw format
asciinema rec --raw zsh-autosuggest.bytes
```

### Windows (PowerShell)

```powershell
# Record PSReadLine session via node-pty test script
# (requires node-pty installed separately)
node scripts/capture-pwsh-fixture.js > pwsh-psreadline.bytes

# Or use Start-Transcript (text-only, needs post-processing)
Start-Transcript -Path .\session.txt
# ... interact ...
Stop-Transcript
```

### Tips for deterministic fixtures

1. **Keep them short** — 2-3 keystrokes max, < 10 KB raw bytes
2. **No hostname/time** — use fixed `PROMPT` / `PS1` that doesn't include dynamic data
3. **Seed history** — pre-load shell history for Ctrl+R tests
4. **Fixed terminal size** — always 80×24 (matches test harness defaults)
5. **Regenerate synthetics** — run `npx tsx src/test/shellCompat/generateFixtures.ts`

## Refreshing Fixtures

When shell behavior changes or you add new scenarios:

1. Edit `src/test/shellCompat/generateFixtures.ts`
2. Run `npx tsx src/test/shellCompat/generateFixtures.ts`
3. Update tests if assertions need changing
4. Run `npx vitest run src/test/shellCompat/`

## Future Work

- **Layer 2 (integration):** Spawn real shell processes via `node-pty`, send
  keystrokes, assert on buffer. Gate behind `PUTZ_SHELL_COMPAT=1` env var.
- **Nushell (tier-2):** Optional coverage, not gating CI.
- **S2 OSC 7 integration:** After S2 merges, enable the `cwdChanged` event test.
- **S8 VT corpus:** Complementary test suite from Microsoft Terminal + xterm.js
  VT spec fixtures.
- **Windows captures:** Real pwsh/cmd fixtures from a Windows environment.
