# @putz/copilot-swarm

Putz colleague shim for the GitHub Copilot CLI. Auto-registers a Copilot session with Putz's local swarm coordinator over the per-instance Unix socket / Windows named pipe.

## What it does

When this script runs **inside a Putz tab** (detected via the `PUTZ_SWARM_PATH` and `PUTZ_TAB_ID` env vars Putz injects into every PTY), it:

1. Connects to the per-Putz-instance local socket (`net.connect({path})`).
2. Sends a `register` frame with a stable `tab_id` and a generated `colleague_id`.
3. Receives `register_ack` and starts a 10-second heartbeat loop.
4. Forwards `recv_from` deliveries to a user-supplied handler.
5. Exposes a small API for `notify(message, severity)` and `sendTo(colleagueId, payload)`.
6. Sends a `disconnect` frame on `SIGTERM` / `SIGINT` and exits cleanly.

When run **outside a Putz tab** (env vars not set), it exits silently with code 0. Running outside Putz is **not** an error — the script is meant to be safe to leave installed.

## Install path

The Putz app installs this directory into the user's Copilot CLI extensions location via the **Settings → Copilot Integration** card:

| Platform | Path |
|---|---|
| macOS / Linux | `~/.copilot/extensions/putz-colleague/` |
| Windows | `%USERPROFILE%\.copilot\extensions\putz-colleague\` |

The exact path can be overridden by `PUTZ_COLLEAGUE_DIR`. Putz never overwrites an existing install without explicit user confirmation (SEC-006).

## Usage

```bash
# Auto-detect (no-op outside Putz):
node /path/to/putz-colleague/extension.mjs
```

Programmatic use (e.g., from a Copilot CLI hook):

```js
import { boot } from "@putz/copilot-swarm";

const colleague = await boot();           // null when not under Putz
if (colleague) {
  colleague.notify("starting long-running task", "ambient");
  colleague.sendTo("peer-id", { kind: "request", task: "review" });
  colleague.onMessage(({ from, payload }) => {
    // Handle inbound message from another colleague.
  });
}
```

## Wire format

Length-prefixed JSON, identical to T1 (`src-tauri/src/swarm/wire.rs`):

- 4-byte big-endian unsigned length prefix
- UTF-8 JSON body of that length
- Single frame ≤ 1 MiB
- Zero-length and oversized frames rejected before allocation

Frame types: `register`, `register_ack`, `heartbeat`, `notify`, `send_to`, `recv_from`, `disconnect`. The codec validates outgoing frames against the same `deny_unknown_fields` discipline the Rust side uses.

## Privacy

The extension logs only **metadata** to stderr: colleague_id, peer count, signal name, error class. It never logs:

- `notify.message` contents
- `send_to.payload` / `recv_from.payload` contents
- The socket path

These are Tier-2 PII per spec PRI-002. If you instrument this code, follow the same rule.

## Testing

```bash
npm test
```

Uses the built-in `node:test` runner — zero non-stdlib runtime dependencies.

## Engine

Node ≥ 18.
