/**
 * ClientRegistry — owns the colleague's identity, the live SwarmSocket,
 * the heartbeat interval, the reconnect policy, and the local peer roster
 * derived from `register_ack`.
 *
 * This is the only stateful piece. The socket and codec are stateless tools.
 *
 * @module registry
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { SwarmSocket } from "./socket.mjs";
import { WireError } from "./wire.mjs";

/** Heartbeat interval in milliseconds — spec FR-013. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Reconnect backoff (exponential, capped). */
export const RECONNECT_INITIAL_MS = 250;
export const RECONNECT_MAX_MS = 30_000;
export const RECONNECT_MULTIPLIER = 2;

/** T5 — request/response RPC default timeout. */
export const REQUEST_TIMEOUT_MS = 5_000;

/** T5 — inbox ring-buffer cap (incoming notify/recv_notify). */
export const INBOX_CAP = 50;

/**
 * Allowed values for `notify` frame `severity`. Mirrors the Rust
 * `Severity` enum (`src-tauri/src/swarm/types.rs`) which uses
 * `#[serde(rename_all = "lowercase")]`. Sending any other value
 * causes the Rust side to drop the frame and close the connection,
 * so we validate at the API boundary and throw a typed error.
 */
export const ALLOWED_SEVERITIES = Object.freeze(["urgent", "normal", "ambient"]);

/**
 * @typedef {object} RegistryOpts
 * @property {string} path - Socket / pipe path.
 * @property {string} tabId
 * @property {string} colleagueId
 * @property {string} name
 * @property {string} [parent]
 * @property {number} [pid]
 * @property {() => SwarmSocket} [socketFactory] - Test seam.
 * @property {number} [heartbeatMs] - Test seam.
 * @property {boolean} [autoReconnect] - Default true.
 */

/**
 * Public events emitted:
 *   - `registered` ({ colleagueId, roster })
 *   - `recv`       ({ from, payload })  — only when registered
 *   - `peer-update`({ roster })
 *   - `disconnect` ({ reason? })
 *   - `error`      (Error)              — non-fatal; reconnect will follow
 *   - `closed`     ()                   — terminal; no further events
 */
export class ClientRegistry extends EventEmitter {
  /** @param {RegistryOpts} opts */
  constructor(opts) {
    super();
    if (!opts || typeof opts !== "object") {
      throw new TypeError("ClientRegistry: opts required");
    }
    for (const k of ["path", "tabId", "colleagueId", "name"]) {
      if (typeof opts[k] !== "string" || opts[k].length === 0) {
        throw new TypeError(`ClientRegistry: opts.${k} must be a non-empty string`);
      }
    }
    /** @private */ this._opts = opts;
    /** @private */ this._socketFactory =
      opts.socketFactory ?? (() => new SwarmSocket({ path: opts.path }));
    /** @private */ this._heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    /** @private */ this._autoReconnect = opts.autoReconnect !== false;
    /** @private @type {SwarmSocket | null} */ this._sock = null;
    /** @private @type {NodeJS.Timeout | null} */ this._heartbeat = null;
    /** @private */ this._registered = false;
    /** @private @type {Array<object>} */ this._roster = [];
    /** @private */ this._stopped = false;
    /** @private */ this._reconnectMs = RECONNECT_INITIAL_MS;
    /** @private @type {NodeJS.Timeout | null} */ this._reconnectTimer = null;
    /** @private @type {string | null} Last error code we logged — used to suppress floods. */
    this._lastErrorCode = null;
    /**
     * T5 — local cache of active claims, keyed by resource. Seeded from
     * `register_ack.claims` and kept current by `claim`/`release`
     * broadcasts. Reads (`check`, `listClaims`) are served from here
     * without any round-trip.
     * @private @type {Map<string, {resource:string,holder:string,message:string,expiresAtMs:number}>}
     */
    this._claims = new Map();
    /**
     * T5 — in-flight RPC requests, keyed by request_id. Resolved when a
     * matching `tool_response` arrives, rejected on timeout or close.
     * @private @type {Map<string, {resolve:(p:any)=>void, reject:(e:Error)=>void, timer: NodeJS.Timeout}>}
     */
    this._pending = new Map();
    /**
     * T5 — inbox ring buffer of recent notifies (broadcasts + 1:1 sends).
     * Capped at {@link INBOX_CAP}; oldest entries dropped first.
     * @private @type {Array<{from:string,message:string,severity:string,at:number}>}
     */
    this._inbox = [];
  }

  /** Current peer roster (excluding self). Snapshot — caller may not mutate. */
  get roster() {
    return this._roster.slice();
  }

  /** Whether the most recent connection completed register handshake. */
  get registered() {
    return this._registered;
  }

  /** Open and register. Idempotent if already started. */
  start() {
    if (this._sock || this._stopped) return;
    this._connect();
  }

  /** @private */
  _connect() {
    const sock = this._socketFactory();
    this._sock = sock;
    this._registered = false;
    sock.on("connect", () => this._onConnect());
    sock.on("frame", (f) => this._onFrame(f));
    sock.on("error", (err) => this.emit("error", err));
    sock.on("close", () => this._onClose());
    sock.connect();
  }

  /** @private */
  _onConnect() {
    /** @type {{type:'register', tab_id:string, colleague_id:string, name:string, parent?:string, pid?:number}} */
    const reg = {
      type: "register",
      tab_id: this._opts.tabId,
      colleague_id: this._opts.colleagueId,
      name: this._opts.name,
    };
    if (typeof this._opts.parent === "string") reg.parent = this._opts.parent;
    if (typeof this._opts.pid === "number") reg.pid = this._opts.pid;
    try {
      this._sock.send(reg);
    } catch (err) {
      this.emit("error", err);
      this._sock.destroy();
    }
  }

  /** @private */
  _onFrame(frame) {
    switch (frame.type) {
      case "register_ack": {
        this._registered = true;
        this._roster = Array.isArray(frame.roster) ? frame.roster : [];
        this._reconnectMs = RECONNECT_INITIAL_MS; // reset on success
        // T5 — seed claim cache from snapshot.
        this._claims.clear();
        if (Array.isArray(frame.claims)) {
          for (const c of frame.claims) {
            if (
              c &&
              typeof c.resource === "string" &&
              typeof c.holder === "string" &&
              typeof c.expires_at_ms === "number"
            ) {
              this._claims.set(c.resource, {
                resource: c.resource,
                holder: c.holder,
                message: typeof c.message === "string" ? c.message : "",
                expiresAtMs: c.expires_at_ms,
              });
            }
          }
        }
        this._startHeartbeat();
        this.emit("registered", {
          colleagueId: frame.colleague_id,
          roster: this.roster,
        });
        this.emit("peer-update", { roster: this.roster });
        this.emit("claims-changed");
        return;
      }
      case "recv_from": {
        // Only forward after registration to avoid emitting on a half-open
        // connection (defensive — coordinator should not send these earlier).
        if (this._registered) {
          // T5 — if the payload is a `swarm_send` envelope ({kind, message}),
          // also surface it in the inbox so the LLM context block sees it.
          //   @privacy `payload.message` is Tier-2 PII; never logged.
          if (
            frame.payload &&
            typeof frame.payload === "object" &&
            frame.payload.kind === "swarm_send" &&
            typeof frame.payload.message === "string"
          ) {
            const entry = {
              from: typeof frame.from === "string" ? frame.from : "unknown",
              message: frame.payload.message,
              severity: "normal",
              at: Date.now(),
            };
            this._inbox.push(entry);
            if (this._inbox.length > INBOX_CAP) {
              this._inbox.splice(0, this._inbox.length - INBOX_CAP);
            }
          }
          this.emit("recv", { from: frame.from, payload: frame.payload });
        }
        return;
      }
      case "roster_update": {
        // T3 introduces this frame: the coordinator pushes a fresh
        // colleague roster whenever a peer joins / leaves / updates.
        // Update local cache and emit `roster` so consumers can refresh.
        this._roster = Array.isArray(frame.colleagues) ? frame.colleagues : [];
        this.emit("roster", this.roster);
        this.emit("peer-update", { roster: this.roster });
        return;
      }
      case "recv_notify": {
        // Coordinator-routed inbound notify (someone — Putz UI or a peer
        // colleague — sent a notify TO us). Emit so the extension shell
        // can surface it via `session.log` in the live Copilot session.
        // @privacy `frame.message` is Tier-2 PII; subscribers MUST NOT log it.
        if (this._registered) {
          const entry = {
            from: typeof frame.from === "string" ? frame.from : "unknown",
            message: typeof frame.message === "string" ? frame.message : "",
            severity:
              typeof frame.severity === "string" ? frame.severity : "normal",
            at: Date.now(),
          };
          // T5 — append to ring buffer (oldest dropped first).
          this._inbox.push(entry);
          if (this._inbox.length > INBOX_CAP) {
            this._inbox.splice(0, this._inbox.length - INBOX_CAP);
          }
          this.emit("notify", {
            from: entry.from,
            message: entry.message,
            severity: entry.severity,
          });
        }
        return;
      }
      case "claim": {
        // T5 — coordinator broadcast: a claim was acquired/refreshed.
        if (
          typeof frame.resource === "string" &&
          typeof frame.holder === "string" &&
          typeof frame.expires_at_ms === "number"
        ) {
          this._claims.set(frame.resource, {
            resource: frame.resource,
            holder: frame.holder,
            message: typeof frame.message === "string" ? frame.message : "",
            expiresAtMs: frame.expires_at_ms,
          });
          this.emit("claims-changed");
        }
        return;
      }
      case "release": {
        // T5 — coordinator broadcast: claim released or expired.
        if (typeof frame.resource === "string") {
          if (this._claims.delete(frame.resource)) {
            this.emit("claims-changed");
          }
        }
        return;
      }
      case "tool_response": {
        // T5 — RPC response correlation.
        const id = typeof frame.request_id === "string" ? frame.request_id : "";
        const pending = this._pending.get(id);
        if (!pending) return; // late or unknown — drop.
        this._pending.delete(id);
        clearTimeout(pending.timer);
        if (frame.ok === true) {
          pending.resolve(frame.payload);
        } else {
          const err = new Error(
            typeof frame.error === "string" && frame.error.length > 0
              ? frame.error
              : "tool_response: unspecified error",
          );
          err.code = typeof frame.error === "string" ? frame.error : "ERROR";
          err.payload = frame.payload;
          pending.reject(err);
        }
        return;
      }
      case "disconnect": {
        // Server-initiated; do not auto-reconnect on a clean kick.
        this.emit("disconnect", { reason: frame.reason });
        this._stopped = true;
        this._sock.destroy();
        return;
      }
      default:
        // Inbound frames with unknown `type` are accepted by the decoder
        // and ignored here — forward-compat for future Putz frame types.
        // The Rust side enforces `deny_unknown_fields` for OUTGOING
        // frames; we deliberately do NOT enforce it inbound, so a
        // newer coordinator can ship a new frame type without breaking
        // older colleagues.
        return;
    }
  }

  /** @private */
  _onClose() {
    this._stopHeartbeat();
    this._sock = null;
    this._registered = false;
    // T5 — fail all in-flight requests; the response will never come.
    if (this._pending.size > 0) {
      const err = new Error("connection closed before tool_response arrived");
      err.code = "DISCONNECTED";
      for (const [, p] of this._pending) {
        clearTimeout(p.timer);
        p.reject(err);
      }
      this._pending.clear();
    }
    if (this._stopped) {
      this.emit("closed");
      return;
    }
    if (!this._autoReconnect) {
      this._stopped = true;
      this.emit("closed");
      return;
    }
    this._scheduleReconnect();
  }

  /** @private */
  _scheduleReconnect() {
    const delay = this._reconnectMs;
    this._reconnectMs = Math.min(
      Math.floor(this._reconnectMs * RECONNECT_MULTIPLIER),
      RECONNECT_MAX_MS,
    );
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._stopped) return;
      this._connect();
    }, delay);
    if (this._reconnectTimer && typeof this._reconnectTimer.unref === "function") {
      this._reconnectTimer.unref();
    }
  }

  /** @private */
  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeat = setInterval(() => {
      if (!this._sock || !this._registered) return;
      try {
        this._sock.send({
          type: "heartbeat",
          colleague_id: this._opts.colleagueId,
        });
      } catch (err) {
        // Encode/write failure — surface and let close handler reconnect.
        this.emit("error", err);
      }
    }, this._heartbeatMs);
    if (this._heartbeat && typeof this._heartbeat.unref === "function") {
      this._heartbeat.unref();
    }
  }

  /** @private */
  _stopHeartbeat() {
    if (this._heartbeat) {
      clearInterval(this._heartbeat);
      this._heartbeat = null;
    }
  }

  /**
   * Send a `notify` frame.
   * @param {string} message
   *   @privacy Tier-2 PII — never logged here.
   * @param {"urgent"|"normal"|"ambient"} [severity]
   *   Validated against {@link ALLOWED_SEVERITIES}; throws WireError
   *   `BAD_SEVERITY` if outside the allowed set, since the Rust side
   *   would otherwise close the connection on receipt.
   */
  notify(message, severity) {
    if (typeof message !== "string") {
      throw new TypeError("notify: message must be a string");
    }
    if (severity !== undefined && !ALLOWED_SEVERITIES.includes(severity)) {
      throw new WireError(
        `notify: severity must be one of ${ALLOWED_SEVERITIES.join("|")}, got ${String(severity)}`,
        "BAD_SEVERITY",
      );
    }
    this._requireRegistered();
    /** @type {{type:'notify',colleague_id:string,message:string,severity?:string}} */
    const frame = {
      type: "notify",
      colleague_id: this._opts.colleagueId,
      message,
    };
    if (severity !== undefined) frame.severity = severity;
    this._sock.send(frame);
  }

  /**
   * Send a `send_to` frame routed to colleague `to`.
   * @param {string} to
   * @param {unknown} payload - @privacy Tier-2 PII; never logged here.
   */
  sendTo(to, payload) {
    if (typeof to !== "string" || to.length === 0) {
      throw new TypeError("sendTo: `to` must be a non-empty colleague_id");
    }
    this._requireRegistered();
    this._sock.send({
      type: "send_to",
      from: this._opts.colleagueId,
      to,
      payload,
    });
  }

  /** @private */
  _requireRegistered() {
    if (!this._registered || !this._sock) {
      throw new Error("ClientRegistry: not registered");
    }
  }

  // ─── T5: claim/RPC API ───────────────────────────────────────────

  /**
   * Snapshot of currently-known active claims (post-sweep, server-confirmed).
   * Returned array is a copy; safe to mutate.
   * @returns {Array<{resource:string,holder:string,message:string,expiresAtMs:number}>}
   */
  get claims() {
    return Array.from(this._claims.values());
  }

  /**
   * Snapshot of recent inbox entries (newest last). Caller may mutate.
   * @returns {Array<{from:string,message:string,severity:string,at:number}>}
   *   @privacy Tier-2 PII — never log entries here or by the caller.
   */
  get inbox() {
    return this._inbox.slice();
  }

  /** Clear the inbox ring buffer (call after surfacing entries to the LLM). */
  markInboxRead() {
    if (this._inbox.length > 0) {
      this._inbox.length = 0;
    }
  }

  /**
   * Get cached claim info for a resource, or null if not held.
   * @param {string} resource
   */
  cachedClaim(resource) {
    if (typeof resource !== "string") return null;
    const c = this._claims.get(resource);
    return c ? { ...c } : null;
  }

  /**
   * Send an RPC frame and await its `tool_response`. Generates a fresh
   * request_id and wires up timeout / pending-map cleanup.
   *
   * @param {string} frameType  - One of `claim_req|release_req|check_req|list_claims_req|broadcast_req`.
   * @param {object} payload    - Frame payload (no `type` or `request_id`).
   * @param {number} [timeoutMs] - Default {@link REQUEST_TIMEOUT_MS}.
   * @returns {Promise<any>}     Resolves with `tool_response.payload` on ok=true.
   *
   *   @privacy any `message` field inside payload is Tier-2 PII; never logged.
   */
  request(frameType, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
    this._requireRegistered();
    if (typeof frameType !== "string" || !frameType.endsWith("_req")) {
      throw new TypeError(
        `request: frameType must be a *_req frame, got ${String(frameType)}`,
      );
    }
    if (payload === null || typeof payload !== "object") {
      throw new TypeError("request: payload must be an object");
    }
    // request_id charset is [a-zA-Z0-9_-], max 100 chars (Rust validator).
    // randomUUID() is hex+hyphen — fits the charset, well under length cap.
    const requestId = randomUUID();
    /** @type {Record<string, any>} */
    const frame = { type: frameType, request_id: requestId, ...payload };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this._pending.delete(requestId)) {
          const err = new Error(
            `${frameType}: timed out after ${timeoutMs}ms`,
          );
          err.code = "TIMEOUT";
          reject(err);
        }
      }, timeoutMs);
      if (timer && typeof timer.unref === "function") timer.unref();
      this._pending.set(requestId, { resolve, reject, timer });
      try {
        this._sock.send(frame);
      } catch (err) {
        // Encode failure — clean up immediately.
        this._pending.delete(requestId);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Graceful shutdown — send `disconnect`, end the socket, stop reconnect.
   * @param {string} [reason]
   */
  async shutdown(reason) {
    this._stopped = true;
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._sock && this._registered) {
      try {
        this._sock.send({
          type: "disconnect",
          colleague_id: this._opts.colleagueId,
          ...(reason ? { reason } : {}),
        });
      } catch {
        // Best-effort; we're shutting down anyway.
      }
    }
    if (this._sock) this._sock.end();
  }
}
