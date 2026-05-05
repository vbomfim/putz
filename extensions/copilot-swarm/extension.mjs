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
import { EMPTY_SWARM_STATUS } from "./src/api.mjs";

/**
 * Charset and length matching the Rust validators
 * (`validate_resource`, `validate_colleague_id`). Schemas mirror the
 * server-side rules so the LLM-emitted args are rejected early with a
 * structured error instead of a wire-level coordinator error
 * (CR-Pass-2 G1).
 */
const RESOURCE_PATTERN = "^[a-zA-Z0-9._/:-]{1,200}$";
const COLLEAGUE_ID_PATTERN = "^[a-zA-Z0-9_:-]{1,100}$";
const MESSAGE_MAX = 512;
const TTL_MIN_MINUTES = 1; // server enforces 5s minimum; expose minutes only.
const TTL_MAX_MINUTES = 60 * 24; // 24h sanity cap; coordinator caps at MAX_TTL.
const SEVERITIES = ["urgent", "normal", "ambient"];

/**
 * Per-tool throttle for the `tool:` ambient notify in `onPostToolUse`.
 * One LLM turn can fire dozens of tool calls (read_file, grep, view…)
 * — without a dedupe window the swarm fan-out spams every peer's
 * inbox / sidebar with a notify per micro-step. 5 s is short enough
 * to still convey "this colleague is doing X" without flooding
 * (CR-Pass-2 M1).
 */
const TOOL_NOTIFY_THROTTLE_MS = 5_000;
/** @type {Map<string, number>} */
const lastToolNotifyAt = new Map();

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
        "see it as locked. Envelope: `{ ok:true, payload:<ClaimView> }` " +
        "on success, `{ ok:false, error:'held_by_other'|..., message }` " +
        "on failure.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          resource: {
            type: "string",
            pattern: RESOURCE_PATTERN,
            description: "Resource name; charset [a-zA-Z0-9._/:-], 1–200 chars.",
          },
          ttl_minutes: {
            type: "number",
            minimum: TTL_MIN_MINUTES,
            maximum: TTL_MAX_MINUTES,
            description: "TTL in minutes (auto-released after); 1–1440.",
          },
          message: {
            type: "string",
            maxLength: MESSAGE_MAX,
            description: "Short status note shown to peers (Tier-2 PII).",
          },
        },
        required: ["resource", "ttl_minutes"],
      },
      handler: async (args) => {
        try {
          const view = await swarmApi.claim(
            args?.resource,
            args?.ttl_minutes,
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
      description:
        "Release a claim you currently hold. Envelope: " +
        "`{ ok:true, payload:{ released:true } }` on success.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          resource: { type: "string", pattern: RESOURCE_PATTERN },
        },
        required: ["resource"],
      },
      handler: async (args) => {
        try {
          const r = await swarmApi.release(args?.resource);
          return ok(r);
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "swarm_check",
      description:
        "Read whether `resource` is held (cache-only, no round-trip). " +
        "Returns `{ ok:true, payload:{ free:true } }` when nobody holds " +
        "it, or `{ ok:true, payload:{ free:false, claim:<ClaimView> } }` " +
        "when someone does.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          resource: { type: "string", pattern: RESOURCE_PATTERN },
        },
        required: ["resource"],
      },
      handler: async (args) => {
        try {
          return ok(swarmApi.check(args?.resource));
        } catch (e) {
          return fail(e);
        }
      },
    },
    {
      name: "swarm_list_claims",
      description:
        "List all currently active claims across the swarm (cache-only). " +
        "Envelope: `{ ok:true, payload:<ClaimView[]> }`.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
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
        "Acknowledged RPC — envelope: `{ ok:true, payload:{ delivered:true } }` " +
        "on success, `{ ok:false, error:'unknown_target'|'message_too_long'|" +
        "'back_channel_full'|... }` on failure. The recipient sees it in " +
        "their next prompt's swarm context block.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          target_id: { type: "string", pattern: COLLEAGUE_ID_PATTERN },
          message: { type: "string", maxLength: MESSAGE_MAX, minLength: 1 },
        },
        required: ["target_id", "message"],
      },
      handler: async (args) => {
        try {
          const r = await swarmApi.send(args?.target_id, args?.message);
          return ok(r);
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
        "mark the inbox as read; only the next user prompt does that. " +
        "Envelope: `{ ok:true, payload:{ summary:string } }`.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      handler: async () => {
        try {
          const summary = swarmApi.getContextBlock() || EMPTY_SWARM_STATUS;
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
        "Envelope: `{ ok:true, payload:{ recipients:number } }` — count " +
        "is what the coordinator delivered to.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          message: { type: "string", maxLength: MESSAGE_MAX, minLength: 1 },
          severity: { type: "string", enum: SEVERITIES },
        },
        required: ["message"],
      },
      handler: async (args) => {
        try {
          const n = await swarmApi.broadcast(
            args?.message,
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
    // Throttled per-tool-name (TOOL_NOTIFY_THROTTLE_MS) so a turn that
    // fires `read_file` 30 times doesn't spam every peer's inbox 30 times
    // (CR-Pass-2 M1).
    onPostToolUse: async (input) => {
      if (!api || !input || typeof input.tool !== "string") return {};
      const tool = input.tool;
      const now = Date.now();
      const last = lastToolNotifyAt.get(tool) ?? 0;
      if (now - last < TOOL_NOTIFY_THROTTLE_MS) return {};
      lastToolNotifyAt.set(tool, now);
      // Bound the throttle map — purge entries older than 10× window
      // so long-running sessions don't accumulate dead tool names.
      if (lastToolNotifyAt.size > 256) {
        const cutoff = now - 10 * TOOL_NOTIFY_THROTTLE_MS;
        for (const [k, t] of lastToolNotifyAt) {
          if (t < cutoff) lastToolNotifyAt.delete(k);
        }
      }
      api.notify(`tool: ${tool}`, "ambient");
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
