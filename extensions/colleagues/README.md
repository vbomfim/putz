# Colleagues — Putz Swarm Extension

Copilot CLI extension that connects agents running in putz terminal tabs
to the swarm broker, enabling mutual awareness and collaboration.

## Installation

The extension lives **in the repo** (`extensions/colleagues/`) so it stays
version-controlled alongside the rest of putz. Copilot CLI discovers
extensions at `~/.copilot/extensions/<name>/`, so we create a symlink.

### Quick setup (recommended)

```bash
node extensions/colleagues/setup.mjs
```

The script is idempotent — re-running it when the link already exists is a
no-op. On Windows it creates a **junction** (no admin rights needed). On
macOS/Linux it creates a regular symlink.

### Manual setup

**PowerShell (Windows):**

```powershell
New-Item -ItemType Junction `
  -Path "$HOME\.copilot\extensions\colleagues" `
  -Target (Resolve-Path "extensions\colleagues")
```

**Bash / Zsh (macOS / Linux):**

```bash
mkdir -p ~/.copilot/extensions
ln -s "$(pwd)/extensions/colleagues" ~/.copilot/extensions/colleagues
```

### Verify

```bash
copilot extensions list          # should show "colleagues"
copilot extensions inspect colleagues
```

## How it works

When a putz terminal tab has `PUTZ_SWARM_URL` and `PUTZ_SWARM_TOKEN` set,
this extension automatically:

1. **Registers** with the swarm broker on session start
2. **Heartbeats** every 30 seconds to stay alive
3. **Deregisters** on session end
4. **Fires initial prompt** if `COPILOT_COLLEAGUE_INITIAL_PROMPT` is set

When those env vars are absent, the extension loads as a no-op.

## Tools

| Tool | Description |
|------|-------------|
| `swarm_roster` | List all registered colleague agents |
| `swarm_spawn` | Spawn a new colleague in a separate tab |
| `swarm_send_message` | Send a message to another colleague |
| `swarm_focus` | Focus (bring to front) another colleague's tab |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PUTZ_SWARM_URL` | Yes | Broker URL (e.g. `http://127.0.0.1:9111`) |
| `PUTZ_SWARM_TOKEN` | Yes | Bearer token for authentication |
| `PUTZ_TAB_ID` | Yes | This tab's unique ID |
| `COPILOT_COLLEAGUE_ID` | Yes | This agent's unique ID |
| `COPILOT_COLLEAGUE_NAME` | Yes | This agent's display name |
| `COPILOT_COLLEAGUE_PARENT` | No | Parent agent's colleague_id |
| `COPILOT_COLLEAGUE_INITIAL_PROMPT` | No | Auto-fire this prompt on start |

All environment variables are injected by putz when spawning a swarm tab.
You do not need to set them manually.

## Security

- Bearer token is **never** logged
- All HTTP requests go to `localhost` only (broker is local)
- Host-check and constant-time token comparison are enforced server-side

## Testing

```bash
cd extensions/colleagues
node --test
```
