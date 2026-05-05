/**
 * Putz Colleague — Copilot CLI SDK extension entry.
 *
 * Copilot CLI's extension host loads this file as a forked subprocess
 * when starting a session. We do two things at module load:
 *
 *   1. boot() the Putz swarm registry (if PUTZ_SWARM_PATH is set).
 *      This connects to Putz's local socket and registers the
 *      colleague IMMEDIATELY — the colleague appears in the Putz
 *      sidebar as soon as `gh copilot` starts, not only after the
 *      user begins a chat session.
 *   2. joinSession() — hand control to the Copilot SDK so it owns
 *      the process lifetime. The hooks then forward session events
 *      to peers as they occur (start, idle, tool use).
 *
 * If PUTZ_SWARM_PATH is absent (extension loaded outside a Putz tab),
 * boot() returns null and the extension stays attached as a no-op
 * observer. Copilot CLI works normally; the user sees no error.
 *
 * @privacy `onPostToolUse` forwards only the tool NAME as an ambient
 * notify to peers. Tool args, results, and any user content stay in
 * the Copilot session — never sent over the swarm wire.
 *
 * @module extension
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { boot } from "./src/boot.mjs";

// Register the colleague immediately on extension load. This is the
// canonical "I am alive" signal — Putz sees the new colleague in its
// sidebar right away, without waiting for the user to start a chat.
const api = await boot().catch((err) => {
  process.stderr.write(
    `[putz-colleague] boot failed name=${err && err.name}\n`,
  );
  return null;
});

if (api) {
  process.stderr.write(`[putz-colleague] swarm boot ok\n`);
} else if (process.env.PUTZ_SWARM_PATH) {
  // Env was set but boot returned null — likely a connection error
  // already logged by the registry. Surface a hint here too.
  process.stderr.write(
    `[putz-colleague] PUTZ_SWARM_PATH set but boot returned null — check that Putz swarm is enabled and the socket is reachable\n`,
  );
}

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      if (api) api.notify("copilot session started", "ambient");
      return {};
    },

    // Forward only the tool NAME — never args/output (Tier-2 PII per PRI-002).
    onPostToolUse: async (input) => {
      if (api && input && typeof input.tool === "string") {
        api.notify(`tool: ${input.tool}`, "ambient");
      }
      return {};
    },
  },
  tools: [],
});

session.on("session.idle", async () => {
  if (api) api.notify("copilot session idle", "ambient");
});

// Surface inbound peer/Putz notifies into the live Copilot session log
// so the user can SEE messages from other colleagues / the Putz UI.
// @privacy `message` is Tier-2 PII; do not stderr-log it.
if (api) {
  api.onNotify((msg) => {
    const sev = (msg.severity || "normal").toUpperCase();
    const prefix =
      sev === "URGENT" ? "🚨" : sev === "AMBIENT" ? "💬" : "📨";
    // session.log surfaces ephemeral text in the Copilot CLI conversation.
    // Best-effort fire-and-forget — don't block the registry on a slow log.
    session
      .log(`${prefix} ${msg.from} → ${msg.message}`, { ephemeral: true })
      .catch(() => undefined);
  });

  // Also surface peer-to-peer payloads (sendTo) — render the payload as
  // JSON so structured data is at least human-readable in the session.
  // @privacy payload is Tier-2 PII; do not stderr-log.
  api.onMessage((msg) => {
    let body;
    try {
      body =
        typeof msg.payload === "string"
          ? msg.payload
          : JSON.stringify(msg.payload);
    } catch {
      body = "<unserializable payload>";
    }
    session
      .log(`📦 ${msg.from} → ${body}`, { ephemeral: true })
      .catch(() => undefined);
  });
}
