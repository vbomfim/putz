/**
 * Public API — what user code (e.g. the agent's hook layer) calls.
 *
 * This is the seam an alternative implementation could mock. Keep it
 * narrow and stable.
 *
 * @module api
 */

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
     * Read the cached claim info for `resource` — no round-trip. Returns
     * null when nobody holds it (according to local cache, which is kept
     * current by `claim`/`release` broadcasts).
     * @param {string} resource
     */
    check(resource) {
      const c = registry.cachedClaim(resource);
      return c ? normalizeClaimView({
        resource: c.resource,
        holder: c.holder,
        message: c.message,
        expires_at_ms: c.expiresAtMs,
      }) : null;
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
     * delivered as a `recv_notify` event.
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
      // Reuse existing send_to wire frame; coordinator forwards as recv_from
      // for raw payload OR recv_notify if we use the broadcast/notify API.
      // Per spec: 1:1 messages flow as send_to → recv_from. The peer's
      // ext bridges recv_from into the inbox. (See registry recv handler
      // bridging in extension.mjs onPostToolUse.)
      registry.sendTo(targetId, { kind: "swarm_send", message });
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
     * claims, no inbox) so the SDK can drop it cleanly.
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
        const msg = c.message ? ` — ${c.message}` : "";
        lines.push(`🔒 ${c.resource} held by ${tag} (~${remainMin} min remaining)${msg}`);
      }
      for (const n of inbox) {
        lines.push(`📨 ${n.from}: ${n.message}`);
      }
      return lines.join("\n");
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
