/**
 * Socket client — connects to the Putz coordinator via Node's `net.connect({path})`,
 * which works for both Unix domain sockets and Windows named pipes (libuv handles
 * the namespace transparently).
 *
 * Responsibilities:
 *   - Open the connection.
 *   - Pipe inbound bytes through {@link FrameDecoder} and emit `frame`.
 *   - Surface lifecycle events: `connect`, `frame`, `close`, `error`.
 *
 * Reconnect logic lives ONE LEVEL UP in {@link ./registry.mjs ClientRegistry}
 * (Single Responsibility — the socket just moves bytes; reconnect is policy).
 *
 * @module socket
 */

import net from "node:net";
import { EventEmitter } from "node:events";
import { encodeFrame, FrameDecoder, WireError } from "./wire.mjs";

/**
 * Thin wrapper around `net.Socket`. One instance == one connection attempt.
 * After `close`, callers create a NEW instance to reconnect.
 */
export class SwarmSocket extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.path - Socket path (Unix) or pipe name (Windows, with `\\.\pipe\` prefix).
   */
  constructor({ path }) {
    super();
    if (typeof path !== "string" || path.length === 0) {
      throw new TypeError("SwarmSocket: `path` must be a non-empty string");
    }
    /** @private */
    this._path = path;
    /** @private */
    this._decoder = new FrameDecoder();
    /** @private @type {net.Socket | null} */
    this._sock = null;
    /** @private */
    this._closed = false;
  }

  /** Open the connection. Idempotent. */
  connect() {
    if (this._sock) return;
    const sock = net.connect({ path: this._path });
    this._sock = sock;
    sock.on("connect", () => this.emit("connect"));
    sock.on("data", (chunk) => this._onData(chunk));
    sock.on("error", (err) => {
      // Don't leak underlying error message to anything that may log;
      // surface a structured event with code only.
      this.emit("error", err);
    });
    sock.on("close", () => {
      if (this._closed) return;
      this._closed = true;
      this.emit("close");
    });
  }

  /** @private */
  _onData(chunk) {
    /** @type {Array<{type: string}>} */
    let frames;
    try {
      frames = this._decoder.push(chunk);
    } catch (err) {
      // Wire error => connection is corrupt. Close hard.
      this.emit("error", err instanceof WireError ? err : new WireError(String(err)));
      this.destroy();
      return;
    }
    for (const f of frames) this.emit("frame", f);
  }

  /**
   * Send a frame. Throws synchronously on encode failure (caller bug);
   * returns the boolean from `socket.write` for backpressure signaling.
   *
   * @param {object} frame
   * @returns {boolean}
   */
  send(frame) {
    if (!this._sock || this._closed) {
      throw new Error("SwarmSocket: not connected");
    }
    const buf = encodeFrame(frame);
    return this._sock.write(buf);
  }

  /** Half-close the socket cleanly (FIN). */
  end() {
    if (this._sock && !this._closed) this._sock.end();
  }

  /** Force-close (RST). Used after a wire error. */
  destroy() {
    if (this._sock && !this._closed) {
      this._closed = true;
      this._sock.destroy();
      // Defer the synthetic close so listeners attached after destroy()
      // (e.g. via `once("close")`) don't miss it. Mirrors the async
      // semantics that net.Socket itself uses for its own 'close' event.
      setImmediate(() => this.emit("close"));
    }
  }

  /** @returns {boolean} */
  get closed() {
    return this._closed;
  }
}
