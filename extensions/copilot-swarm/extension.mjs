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

// ─── T5: tool definitions exposed to the Copilot agent ──────────────
// Build the tools array conditionally — when there's no swarm boot, we
// expose nothing rather than tools that would all error with "no swarm".
//
// @privacy Tool inputs (esp. `message` fields) are Tier-2 PII. Handlers
// must never stderr-log message contents. Errors are returned as JSON
// strings, scrubbed of any embedded PII.
function buildTools(swarmApi) {
  if (!swarmApi) return [];
  /** @type {(payload: unknown) => string} */
  const ok = (payload) => JSON.stringify({ ok: true, payload });
  /** @type {(err: unknown) => string} */
  const fail = (err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    return JSON.stringify({
      ok: false,
      error: typeof e.code === "string" ? e.code : "ERROR",
      message: e.message,
    });
  };
  return [
    {
      name: "swarm_claim",
      description:
        "Acquire a named claim on a shared resource (deploy slot, port, " +
        "credential, etc.) so other Copilot tabs in the same Putz swarm " +
        "see it as locked. Returns the granted claim view, or { ok:false, " +
        "error:'held_by_other' } when another colleague holds it.",
      parameters: {
        type: "object",
        properties: {
          resource: { type: "string", description: "Resource name; charset [a-zA-Z0-9._/:-], ≤200 chars." },
          ttl_minutes: { type: "number", description: "TTL in minutes (auto-released after)." },
          message: { type: "string", description: "Short status note shown to peers (Tier-2 PII)." },
        },
        required: ["resource", "ttl_minutes"],
      },
      handler: async (args) => {
        try {
          const view = await swarmApi.claim(
            String(args?.resource ?? ""),
            Number(args?.ttl_minutes ?? 0),
            typeof args?.message === "string" ? args.message : undefined,
          );
          return ok(view);
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "swarm_release",
      description: "Release a claim you currently hold.",
      parameters: {
        type: "object",
        properties: {
          resource: { type: "string" },
        },
        required: ["resource"],
      },
      handler: async (args) => {
        try {
          const r = await swarmApi.release(String(args?.resource ?? ""));
          return ok(r);
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "swarm_check",
      description:
        "Read who currently holds a claim on `resource` (cache-only, no " +
        "round-trip). Returns null when nobody holds it.",
      parameters: {
        type: "object",
        properties: {
          resource: { type: "string" },
        },
        required: ["resource"],
      },
      handler: async (args) => {
        try {
          return ok(swarmApi.check(String(args?.resource ?? "")));
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "swarm_list_claims",
      description:
        "List all currently active claims across the swarm (cache-only).",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          return ok(swarmApi.listClaims());
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "swarm_send",
      description:
        "Send a 1:1 message to another Copilot colleague by colleague_id. " +
        "The recipient sees it in their next prompt's swarm context block.",
      parameters: {
        type: "object",
        properties: {
          target_id: { type: "string" },
          message: { type: "string" },
        },
        required: ["target_id", "message"],
      },
      handler: async (args) => {
        try {
          await swarmApi.send(String(args?.target_id ?? ""), String(args?.message ?? ""));
          return ok({ sent: true });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "swarm_status",
      description:
        "Get a human-readable summary of the swarm: active peer colleagues, " +
        "currently held claims (with holders, messages, and TTLs), and any " +
        "unread inbox messages from peers. Convenience wrapper — does NOT " +
        "mark the inbox as read; only the next user prompt does that.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        try {
          const summary =
            swarmApi.getContextBlock() || "no peers, no claims, inbox empty";
          return ok({ summary });
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "swarm_broadcast",
      description:
        "Broadcast a message to ALL peer colleagues in the swarm. " +
        "Returns the number of recipients the coordinator delivered to.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string" },
          severity: {
            type: "string",
            enum: ["urgent", "normal", "ambient"],
          },
        },
        required: ["message"],
      },
      handler: async (args) => {
        try {
          const n = await swarmApi.broadcast(
            String(args?.message ?? ""),
            typeof args?.severity === "string" ? args.severity : "normal",
          );
          return ok({ recipients: n });
        } catch (e) {
          return fail(e);
        }
      },
    },
  ];
}

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      if (api) api.notify("copilot session started", "ambient");
      return {};
    },

    /**
     * T5 — prepend a swarm context block to every user turn so the agent
     * knows about active claims and inbox messages without a tool call.
     * Returns `{}` (no-op) when there's nothing to say.
     *
     * @privacy `additionalContext` carries Tier-2 PII (claim messages,
     * inbox notifies) into the LLM. We never stderr-log it. The inbox
     * is cleared after surfacing so the same notify doesn't replay.
     */
    onUserPromptSubmitted: async () => {
      if (!api) return {};
      const block = api.getContextBlock();
      if (!block) return {};
      // Mark inbox read AFTER capturing the block so a single notify is
      // surfaced exactly once across user turns.
      api.markInboxRead();
      return { additionalContext: block };
    },

    // Forward only the tool NAME — never args/output (Tier-2 PII per PRI-002).
    onPostToolUse: async (input) => {
      if (api && input && typeof input.tool === "string") {
        api.notify(`tool: ${input.tool}`, "ambient");
      }
      return {};
    },
  },
  tools: buildTools(api),
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
