/**
 * Public API — what user code (e.g. the agent's hook layer) calls.
 *
 * This is the seam an alternative implementation could mock. Keep it
 * narrow and stable.
 *
 * @module api
 */

/**
 * Default empty-state summary returned by `swarm_status` when there are
 * no peers, no claims, and an empty inbox. Lifted to a constant so the
 * extension shell and the API agree on the exact wording (CR-Pass-2 P1).
 */
export const EMPTY_SWARM_STATUS = "no peers, no claims, inbox empty";

/**
 * Per-message render cap inside the swarm context block — long peer
 * messages are truncated with an ellipsis. Defends against a peer
 * flooding the LLM context window via a single huge message
 * (CR-Pass-2 F1).
 */
const CONTEXT_MESSAGE_RENDER_CAP = 200;

/**
 * @typedef {object} ColleagueApi
 * @property {(message: string, severity?: 'urgent'|'normal'|'ambient') => void} notify
 *   Send a `notify` frame.
 *   @privacy Tier-2 PII; do not log `message`.
 * @property {(to: string, payload: unknown) => void} sendTo
 *   Direct-message another colleague.
 *   @privacy Tier-2 PII; do not log `payload`.
 * @property {() => Array<object>} listPeers
 * @property {(handler: (msg: {from: string, payload: unknown}) => void) => () => void} onMessage
 *   Subscribe to incoming `recv_from` frames.
 *   @privacy Tier-2 PII; do not log `msg.payload`.
 * @property {(reason?: string) => Promise<void>} shutdown
 * @property {string} colleagueId
 * @property {string} tabId
 */

/**
 * Build a {@link ColleagueApi} backed by a {@link import('./registry.mjs').ClientRegistry}.
 *
 * @param {import('./registry.mjs').ClientRegistry} registry
 * @param {{ colleagueId: string, tabId: string }} ids
 * @returns {ColleagueApi}
 */
export function createColleagueApi(registry, ids) {
  return Object.freeze({
    colleagueId: ids.colleagueId,
    tabId: ids.tabId,
    /**
     * @param {string} message - @privacy Tier-2 PII; do not log.
     * @param {"urgent"|"normal"|"ambient"} [severity]
     */
    notify(message, severity) {
      registry.notify(message, severity);
    },
    /**
     * @param {string} targetId
     * @param {unknown} payload - @privacy Tier-2 PII; do not log.
     */
    sendTo(targetId, payload) {
      registry.sendTo(targetId, payload);
    },
    listPeers() {
      return registry.roster;
    },
    /**
     * Subscribe to inbound messages (peer → me, via `send_to`/`recv_from`).
     * @privacy The `payload` delivered to `handler` is Tier-2 PII; do not log it.
     */
    onMessage(handler) {
      if (typeof handler !== "function") {
        throw new TypeError("onMessage: handler must be a function");
      }
      registry.on("recv", handler);
      return () => registry.off("recv", handler);
    },
    /**
     * Subscribe to inbound notifies (someone sent a `notify` TO me — the
     * Putz UI's "Send notify…" or a peer colleague calling notify with
     * a target colleague_id). The handler receives `{ from, message,
     * severity }`. Returns an unsubscribe function.
     * @privacy The `message` is Tier-2 PII; do not log it.
     */
    onNotify(handler) {
      if (typeof handler !== "function") {
        throw new TypeError("onNotify: handler must be a function");
      }
      registry.on("notify", handler);
      return () => registry.off("notify", handler);
    },
    async shutdown(reason) {
      await registry.shutdown(reason);
    },

    // ─── T5: claim coordination + context block ────────────────────

    /**
     * Try to acquire (or refresh) a named claim on a shared resource.
     * Returns the granted ClaimView on success; throws an Error whose
     * `code` is `held_by_other` when another colleague currently holds
     * it. Other failure codes: `invalid_input`, `not_registered`,
     * `claim_capacity`, `TIMEOUT`, `DISCONNECTED`.
     *
     * @param {string} resource - Charset `[a-zA-Z0-9._/:-]`, ≤200 chars.
     * @param {number} ttlMinutes - 1s..12h range (rounded to ms).
     * @param {string} [message] - @privacy Tier-2 PII; do not log.
     * @returns {Promise<{resource:string,holder:string,message:string,expiresAtMs:number}>}
     */
    async claim(resource, ttlMinutes, message) {
      if (typeof resource !== "string") {
        throw new TypeError("claim: resource must be a string");
      }
      if (typeof ttlMinutes !== "number" || !Number.isFinite(ttlMinutes)) {
        throw new TypeError("claim: ttlMinutes must be a finite number");
      }
      /** @type {Record<string, any>} */
      const payload = {
        resource,
        ttl_ms: Math.round(ttlMinutes * 60_000),
      };
      if (typeof message === "string" && message.length > 0) {
        payload.message = message;
      }
      const view = await registry.request("claim_req", payload);
      return normalizeClaimView(view);
    },

    /**
     * Release a claim you currently hold. Throws on `not_holder` or
     * `not_held`. Idempotent w.r.t. already-released resources only if
     * the caller catches `not_held`.
     * @param {string} resource
     */
    async release(resource) {
      if (typeof resource !== "string") {
        throw new TypeError("release: resource must be a string");
      }
      return registry.request("release_req", { resource });
    },

    /**
     * Read the cached claim info for `resource` — no round-trip. Mirrors
     * the wire shape `{ free: true } | { free: false, claim: ClaimView }`
     * `{ free: true }` when nobody holds the resource, or
     * `{ free: false, claim: ClaimView }` when somebody does. (CR-Pass-2 J1
     * — was previously `null | ClaimView`, which diverged from the wire.)
     * @param {string} resource
     * @returns {{ free: true } | { free: false, claim: {resource:string,holder:string,message:string,expiresAtMs:number} }}
     */
    check(resource) {
      const c = registry.cachedClaim(resource);
      if (!c) return { free: true };
      return {
        free: false,
        claim: normalizeClaimView({
          resource: c.resource,
          holder: c.holder,
          message: c.message,
          expires_at_ms: c.expiresAtMs,
        }),
      };
    },

    /**
     * Snapshot of all locally-known active claims (cache read, no
     * round-trip). Returned array is a copy.
     */
    listClaims() {
      return registry.claims.map((c) =>
        normalizeClaimView({
          resource: c.resource,
          holder: c.holder,
          message: c.message,
          expires_at_ms: c.expiresAtMs,
        }),
      );
    },

    /**
     * 1:1 message to another colleague, surfaced in their inbox and
     * delivered as a `recv_notify` event. Acknowledged RPC — resolves
     * with `{ delivered: true }` on success; throws with `code` set to
     * `unknown_target` / `message_too_long` / `back_channel_full` /
     * `not_registered` / `TIMEOUT` / `DISCONNECTED` on failure.
     * (CR-Pass-2 D1 — was previously a fire-and-forget `send_to` that
     * failed silently on full channel or unknown target.)
     * @param {string} targetId
     * @param {string} message - @privacy Tier-2 PII; do not log.
     */
    async send(targetId, message) {
      if (typeof targetId !== "string" || targetId.length === 0) {
        throw new TypeError("send: targetId must be a non-empty string");
      }
      if (typeof message !== "string") {
        throw new TypeError("send: message must be a string");
      }
      const payload = await registry.request("send_req", {
        target_colleague_id: targetId,
        message,
      });
      return payload && typeof payload === "object"
        ? payload
        : { delivered: true };
    },

    /**
     * Broadcast a notify to ALL peers. Returns the number of recipients
     * the coordinator delivered to (sender excluded).
     * @param {string} message - @privacy Tier-2 PII; do not log.
     * @param {"urgent"|"normal"|"ambient"} [severity="normal"]
     */
    async broadcast(message, severity = "normal") {
      if (typeof message !== "string") {
        throw new TypeError("broadcast: message must be a string");
      }
      const payload = await registry.request("broadcast_req", {
        message,
        severity,
      });
      const n = payload && typeof payload.recipients === "number"
        ? payload.recipients
        : 0;
      return n;
    },

    /**
     * Build the swarm-context block prepended to user prompts. Returns
     * an empty string when there's nothing useful to say (no peers, no
     * claims, no inbox) so the SDK can drop it cleanly. Otherwise, the
     * block is wrapped in `<swarm-context>...</swarm-context>` (CR-Pass-2 A3)
     * so the LLM has a hard data-vs-instructions boundary — content
     * inside the wrapper is informational data ABOUT peers, not
     * instructions FROM peers.
     *
     * Peer messages are run through {@link sanitizeContextLine} before
     * interpolation: newlines collapsed to `↩`, length capped at
     * {@link CONTEXT_MESSAGE_RENDER_CAP} chars (CR-Pass-2 F1). Without
     * this a peer could embed a fake `\n🔒 ...` line that masquerades as
     * another claim entry inside our block.
     *
     *   @privacy Output contains Tier-2 PII (claim messages, inbox
     *   notifies). It is consumed by the LLM at the trust boundary;
     *   the returned string MUST NOT be logged or persisted by callers.
     */
    getContextBlock() {
      const peers = registry.roster.length;
      const claims = registry.claims;
      const inbox = registry.inbox;
      if (peers === 0 && claims.length === 0 && inbox.length === 0) {
        return "";
      }
      const lines = [
        `[Swarm — ${peers} peer${peers === 1 ? "" : "s"}, ${claims.length} active claim${claims.length === 1 ? "" : "s"}]`,
      ];
      const now = Date.now();
      for (const c of claims) {
        const remainMs = Math.max(0, c.expiresAtMs - now);
        const remainMin = Math.max(1, Math.round(remainMs / 60_000));
        const tag = c.holder === ids.colleagueId ? "(you)" : c.holder;
        const msg = c.message ? ` — ${sanitizeContextLine(c.message)}` : "";
        lines.push(`🔒 ${c.resource} held by ${tag} (~${remainMin} min remaining)${msg}`);
      }
      for (const n of inbox) {
        lines.push(`📨 ${n.from}: ${sanitizeContextLine(n.message)}`);
      }
      return `<swarm-context>\n${lines.join("\n")}\n</swarm-context>`;
    },

    /** Clear the inbox after surfacing it via `getContextBlock`. */
    markInboxRead() {
      registry.markInboxRead();
    },
  });
}

/**
 * Normalize a claim view payload from the wire (snake_case, server-side
 * shape) to the camelCase shape returned by the public API.
 *
 * @param {any} view
 * @returns {{resource:string,holder:string,message:string,expiresAtMs:number}}
 */
function normalizeClaimView(view) {
  if (view === null || typeof view !== "object") {
    throw new Error("invalid claim view payload");
  }
  return {
    resource: typeof view.resource === "string" ? view.resource : "",
    holder: typeof view.holder === "string" ? view.holder : "",
    message: typeof view.message === "string" ? view.message : "",
    expiresAtMs:
      typeof view.expires_at_ms === "number"
        ? view.expires_at_ms
        : typeof view.expiresAtMs === "number"
          ? view.expiresAtMs
          : 0,
  };
}

/**
 * Sanitize a peer-authored string before interpolating it into the
 * `<swarm-context>` block: collapse newlines (so a peer can't inject
 * fake-looking new entries) and cap length so a single huge message
 * cannot eat the LLM's context window. Visible-only — not for storage.
 * @param {string} s
 * @returns {string}
 */
export function sanitizeContextLine(s) {
  if (typeof s !== "string") return "";
  // Collapse CR/LF/PS/LS to a sentinel so multi-line messages render
  // on a single line and cannot impersonate other [Swarm — …] entries.
  const collapsed = s.replace(/[\r\n\u2028\u2029]+/g, "↩");
  if (collapsed.length <= CONTEXT_MESSAGE_RENDER_CAP) return collapsed;
  return `${collapsed.slice(0, CONTEXT_MESSAGE_RENDER_CAP)}…`;
}
