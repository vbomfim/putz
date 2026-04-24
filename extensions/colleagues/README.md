# Colleagues — Putz Swarm Extension

Copilot CLI extension that connects agents running in putz terminal tabs
to the swarm broker, enabling mutual awareness and collaboration.

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
cd ~/.copilot/extensions/colleagues
node --test
```
