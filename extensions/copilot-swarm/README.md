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

## Swarm coordination tools (T5)

When two `gh copilot` sessions run in sibling Putz tabs sharing the same
working directory, deploy target, or DB, they need to coordinate explicitly
or they will stomp on each other. The extension registers **seven** tools on
the Copilot SDK that any agent can call:

| Tool | What it does |
|------|---|
| `swarm_claim` | Claim a named resource for a TTL with a human message. Returns `granted: false` if a peer holds it. |
| `swarm_release` | Release a claim you currently hold. |
| `swarm_check` | Look up who (if anyone) holds a given resource right now. |
| `swarm_list_claims` | List every active claim across the swarm. |
| `swarm_send` | 1:1 message to another colleague by `colleague_id`. Surfaced in their next prompt's context block. |
| `swarm_broadcast` | Message all peers. Optional `severity: urgent\|normal\|ambient`. |
| `swarm_status` | Human-readable summary of peers + claims + inbox. Convenience wrapper; does NOT mark inbox read. |

In addition, the `onUserPromptSubmitted` hook prepends a `<swarm-context>`
block to **every** user prompt listing active peers, current claims (with
holder, message, TTL), and any unread inbox messages from peers. After
surfacing, the inbox is cleared so the same notify is not replayed on the
next turn.

### Recommended resource-naming convention

Use these conventional names so all your Copilot agents speak the same
vocabulary:

| Resource | Use for |
|---|---|
| `git-worktree` | `git pull`, `git fetch`, `git rebase`, `git checkout`, `git stash` — anything mutating the shared working tree |
| `deploy-<env>` | Deploys; e.g. `deploy-prod`, `deploy-staging` |
| `db-<env>` | DB migrations against shared databases |
| `npm-publish` | Package publishes (npm, PyPI, crates, etc.) |
| free-form | Anything else; pick a stable, lowercase, hyphenated name |

Resource names are restricted to `[a-zA-Z0-9._/:-]` and capped at 200 chars.

See [`copilot-instructions.snippet.md`](./copilot-instructions.snippet.md)
for a drop-in markdown block you can paste into your repo's
`.github/copilot-instructions.md` so agents know when and how to use these
tools.

### Scenario A — deploy-freeze

Two tabs (`A`, `B`) attached to the same Putz instance, both running
`gh copilot`.

1. User in tab `A` says *"deploy main to prod"*. Agent calls
   `swarm_claim({ resource: "deploy-prod", ttl_secs: 600, message: "deploying abc123 to prod" })`.
   `granted: true`.
2. User in tab `B` says *"deploy the hotfix to prod"*. Agent's prompt
   already has a `<swarm-context>` block showing `deploy-prod` held by
   tab `A` with message *"deploying abc123 to prod"*. Agent stops and
   asks user *"Tab A is mid-deploy — wait or override?"*.
3. Tab `A` finishes deploy and calls `swarm_release({ resource: "deploy-prod" })`.
4. User in tab `B` says *"go ahead"*. Agent's next prompt's context
   block shows the resource is free → claims it and proceeds.

### Scenario B — shared-worktree git pull

Two tabs in the **same** working directory (e.g. you opened two Putz
tabs in the same project).

1. User in tab `A` says *"pull latest from main"*. Agent calls
   `swarm_claim({ resource: "git-worktree", ttl_secs: 90, message: "git pull --rebase main" })`,
   runs the pull, then `swarm_release`.
2. While `A`'s pull is in flight, user in tab `B` says *"check out the
   feature branch"*. Agent's prompt context block shows
   `git-worktree` held by `A`. Agent reports to user, who decides to
   wait. (If user said *"override anyway"*, agent would not — it asks
   first; user can release explicitly via `swarm_release` themselves.)
3. After `A` releases, user in tab `B` retries. Context block is
   clean → agent claims `git-worktree`, runs `git checkout`, releases.

If a colleague's tab disconnects mid-claim, the coordinator
automatically releases everything they held and broadcasts the release
to remaining peers — no manual cleanup needed.

## Engine

Node ≥ 18.
