# PTY Spawn Performance Baselines

## What is measured

The `measure_spawn` binary measures **core PTY spawn overhead**: time from
`openpty()` through `spawn_command()` to the shell's first byte of output.

Each sample captures four aligned subspans:

| Subspan | Description |
|---------|-------------|
| `validationMs` | Shell allowlist + arg validation (near-zero in standalone binary) |
| `openptyMs` | Time to `openpty()` returns |
| `spawnToReadyMs` | Time to `spawn_command()` returns |
| `spawnToFirstByteMs` | Time to first byte read from PTY — the primary metric |

These subspans are **aligned** between the standalone binary
(`src-tauri/src/bin/measure_spawn.rs`) and the in-app path
(`src-tauri/src/pty/manager.rs`), so matching subspans can be compared
apples-to-apples.

## Login-shell limitation

Baseline numbers use **non-login** mode (`--login` flag omitted):

- **Login-shell measurement may hang** in the standalone binary because
  some shell profiles (e.g., `~/.zshrc`, oh-my-posh, nvm) wait for TTY
  input or run interactive prompts that block without a real terminal.
- Login-shell startup time is **dominated by user profile sourcing**
  (`~/.zprofile`, `~/.zshrc`, `~/.bash_profile`, etc.) and is highly
  user-specific — not a meaningful cross-machine benchmark.
- The main app spawns with `-l` (login shell) so it gets the user's full
  PATH, but this is intentionally excluded from baseline measurements.

For comparable benchmarks across machines, always use non-login mode
(the default).

To measure login-shell startup for your own environment:

```bash
cargo run --bin measure_spawn --release -- --samples 5 --login
```

**Warning:** This may hang if your shell profile requires interactive input.

## Capturing baselines

```bash
# Capture and save to docs/perf/baseline-{platform}-{arch}.json
node scripts/measure-spawn.mjs --samples 20 --save

# Or run the binary directly
cargo run --bin measure_spawn --release -- --samples 20
```

## Baseline files

- `baseline-macos-arm64.json` — Apple Silicon (M-series)
- `baseline-linux-x86_64.json` — Linux x86_64
- `baseline-windows-x86_64.json` — Windows x86_64

## Privacy

Shell paths are stored as **basenames only** (e.g., `zsh` not
`/Users/john/.nix/bin/zsh`) to avoid leaking filesystem paths.
