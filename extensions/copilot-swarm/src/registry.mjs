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
import { SwarmSocket } from "./socket.mjs";

/** Heartbeat interval in milliseconds — spec FR-013. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Reconnect backoff (exponential, capped). */
export const RECONNECT_INITIAL_MS = 250;
export const RECONNECT_MAX_MS = 30_000;
export const RECONNECT_MULTIPLIER = 2;

/**
 * @typedef {object} RegistryOpts
 * @property {string} path - Socket / pipe path.
 * @property {string} tabId
 * @property {string} colleagueId
 * @property {string} name
 * @property {string} [parent]
 * @property {number} [pid]
 * @property {() => SwarmSocket} [socketFactory] - Test seam.
 * @property {(ms: number) => Promise<void>} [sleep] - Test seam.
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
    /** @private */ this._sleep = opts.sleep ?? defaultSleep;
    /** @private */ this._heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    /** @private */ this._autoReconnect = opts.autoReconnect !== false;
    /** @private @type {SwarmSocket | null} */ this._sock = null;
    /** @private @type {NodeJS.Timeout | null} */ this._heartbeat = null;
    /** @private */ this._registered = false;
    /** @private @type {Array<object>} */ this._roster = [];
    /** @private */ this._stopped = false;
    /** @private */ this._reconnectMs = RECONNECT_INITIAL_MS;
    /** @private @type {NodeJS.Timeout | null} */ this._reconnectTimer = null;
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
        this._startHeartbeat();
        this.emit("registered", {
          colleagueId: frame.colleague_id,
          roster: this.roster,
        });
        this.emit("peer-update", { roster: this.roster });
        return;
      }
      case "recv_from": {
        // Only forward after registration to avoid emitting on a half-open
        // connection (defensive — coordinator should not send these earlier).
        if (this._registered) {
          this.emit("recv", { from: frame.from, payload: frame.payload });
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
        // Unknown server frames are ignored — forward-compat policy.
        return;
    }
  }

  /** @private */
  _onClose() {
    this._stopHeartbeat();
    this._sock = null;
    this._registered = false;
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
   * @param {string} message - @privacy Tier-2 PII; never logged here.
   * @param {"urgent"|"normal"|"ambient"} [severity]
   */
  notify(message, severity) {
    if (typeof message !== "string") {
      throw new TypeError("notify: message must be a string");
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

function defaultSleep(ms) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    if (t && typeof t.unref === "function") t.unref();
  });
}
