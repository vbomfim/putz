# @putz/copilot-swarm

Putz colleague extension for the GitHub Copilot CLI. Bridges a Copilot session to Putz's local swarm coordinator so peers can see and talk to each other across tabs.

## What it does

The extension runs in **two modes** automatically:

### Mode 1 — Copilot SDK extension (preferred)

When `gh copilot` starts a session and finds this directory at `~/.copilot/extensions/putz-colleague/`, it auto-loads the extension via `@github/copilot-sdk`'s `joinSession`. The extension then:

1. On `onSessionStart` — boots the swarm registry (connects to the per-Putz-instance Unix socket / Windows named pipe), registers the tab, announces *"copilot session started"* as an ambient notify to peers.
2. On `onPostToolUse` — forwards just the **tool name** as an ambient notify (never the args/output — Tier-2 PII per spec PRI-002).
3. On `session.idle` — announces *"copilot session idle"* as an ambient notify.

### Mode 2 — Standalone Node script (fallback / manual)

When run directly as `node extension.mjs` (without the Copilot SDK present, or outside a `gh copilot` session), the script falls back to standalone boot: same socket connection + registration, just without SDK lifecycle hooks. This is what tests use, and what manual diagnosis can use.

In both modes:
- Connects via `net.connect({path})` to the local socket.
- Sends a `register` frame with a stable `tab_id` and a generated `colleague_id`.
- Receives `register_ack` and starts a 10-second heartbeat loop.
- Forwards `recv_from` deliveries to a user-supplied handler.
- Exposes a small API for `notify(message, severity)` and `sendTo(colleagueId, payload)`.
- Sends a `disconnect` frame on `SIGTERM` / `SIGINT` and exits cleanly.

If `PUTZ_SWARM_PATH` and `PUTZ_TAB_ID` are not in the environment (running outside a Putz tab), the extension exits silently with code 0. Running outside Putz is **not** an error — the script is safe to leave installed.

## Install path

The Putz app installs this directory into the user's Copilot CLI extensions location via the **Settings → Copilot Integration** card:

| Platform | Path |
|---|---|
| macOS / Linux | `~/.copilot/extensions/putz-colleague/` |
| Windows | `%USERPROFILE%\.copilot\extensions\putz-colleague\` |

The exact path can be overridden by `PUTZ_COLLEAGUE_DIR`. Putz never overwrites an existing install without explicit user confirmation (SEC-006).

## Usage

Once installed, just run `gh copilot` from inside a Putz tab — the extension auto-loads.

For manual / standalone testing:

```bash
# Standalone (no-op outside Putz):
node /path/to/putz-colleague/extension.mjs
```

Programmatic use (from your own scripts that don't go through `gh copilot`):

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
