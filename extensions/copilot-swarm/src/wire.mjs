/**
 * Wire codec — length-prefixed JSON frames matching the Rust coordinator.
 *
 * Wire format (must match `src-tauri/src/swarm/wire.rs` byte-exactly):
 *   - 4-byte big-endian unsigned length prefix
 *   - UTF-8 JSON body of that length
 *   - Single frame ≤ 1 MiB (MAX_FRAME_BYTES)
 *   - Zero-length frames rejected
 *   - Rust uses `deny_unknown_fields` — outgoing frames must contain
 *     ONLY the fields documented in the FRAME_SPECS table below.
 *
 * @privacy Tier-2 PII guard — neither encoder nor decoder ever logs
 * frame bodies. The caller is responsible for keeping `notify.message`
 * and `send_to.payload` / `recv_from.payload` out of any log line.
 *
 * @module wire
 */

/** Max bytes in one frame body (excluding the 4-byte length). */
export const MAX_FRAME_BYTES = 1 << 20; // 1 MiB

/** Errors thrown by the codec. Always fatal for the connection. */
export class WireError extends Error {
  /** @param {string} message @param {string} [code] */
  constructor(message, code = "WIRE") {
    super(message);
    this.name = "WireError";
    this.code = code;
  }
}

/**
 * Per-frame schema. `required` MUST be present; `optional` MAY be present;
 * any other field on the input object causes encode to throw (parity with
 * Rust's `serde(deny_unknown_fields)`).
 *
 * Field types: "string" | "number" | "any" (JSON value).
 */
const FRAME_SPECS = Object.freeze({
  register: {
    required: { tab_id: "string", colleague_id: "string", name: "string" },
    optional: { parent: "string", pid: "number" },
  },
  register_ack: {
    required: { colleague_id: "string", roster: "any" },
    optional: {},
  },
  heartbeat: {
    required: { colleague_id: "string" },
    optional: { status: "string" },
  },
  notify: {
    required: { colleague_id: "string", message: "string" },
    optional: { severity: "string" },
  },
  send_to: {
    required: { from: "string", to: "string", payload: "any" },
    optional: {},
  },
  recv_from: {
    required: { from: "string", payload: "any" },
    optional: {},
  },
  disconnect: {
    required: { colleague_id: "string" },
    optional: { reason: "string" },
  },
});

/**
 * @typedef {object} Frame
 * @property {string} type
 */

/**
 * Validate `frame` against {@link FRAME_SPECS}. Throws WireError on any
 * structural problem. Returns the validated object (still the same ref).
 *
 * Rejecting unknown fields and bad types client-side is part of the
 * trust-boundary contract — the Rust side will close the connection on
 * a malformed frame, so we'd rather fail loud here than ship one.
 *
 * @param {Frame} frame
 * @returns {Frame}
 */
function validateOutgoing(frame) {
  if (frame === null || typeof frame !== "object" || Array.isArray(frame)) {
    throw new WireError("frame must be an object", "BAD_FRAME");
  }
  const spec = FRAME_SPECS[frame.type];
  if (!spec) {
    throw new WireError(`unknown frame type: ${String(frame.type)}`, "BAD_TYPE");
  }
  // Required fields present + correct type.
  for (const [field, kind] of Object.entries(spec.required)) {
    if (!Object.prototype.hasOwnProperty.call(frame, field)) {
      throw new WireError(
        `frame ${frame.type} missing required field: ${field}`,
        "MISSING_FIELD",
      );
    }
    checkType(frame.type, field, frame[field], kind);
  }
  // Optional fields, when present, must have the right type.
  for (const [field, kind] of Object.entries(spec.optional)) {
    if (Object.prototype.hasOwnProperty.call(frame, field)) {
      checkType(frame.type, field, frame[field], kind);
    }
  }
  // No unknown fields (deny_unknown_fields parity).
  const allowed = new Set([
    "type",
    ...Object.keys(spec.required),
    ...Object.keys(spec.optional),
  ]);
  for (const k of Object.keys(frame)) {
    if (!allowed.has(k)) {
      throw new WireError(
        `unknown field on ${frame.type}: ${k}`,
        "UNKNOWN_FIELD",
      );
    }
  }
  return frame;
}

function checkType(frameType, field, value, kind) {
  if (kind === "any") return;
  if (kind === "string" && typeof value !== "string") {
    throw new WireError(
      `${frameType}.${field} must be a string`,
      "BAD_TYPE",
    );
  }
  if (kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new WireError(
      `${frameType}.${field} must be a finite number`,
      "BAD_TYPE",
    );
  }
}

/**
 * Encode a frame to a Buffer ready for socket.write().
 *
 * @param {Frame} frame
 * @returns {Buffer}
 * @throws {WireError} on validation or size failure
 */
export function encodeFrame(frame) {
  validateOutgoing(frame);
  const body = Buffer.from(JSON.stringify(frame), "utf8");
  if (body.length === 0) {
    throw new WireError("frame body is empty", "EMPTY");
  }
  if (body.length > MAX_FRAME_BYTES) {
    throw new WireError(
      `frame too large: ${body.length} bytes (max ${MAX_FRAME_BYTES})`,
      "TOO_LARGE",
    );
  }
  const out = Buffer.allocUnsafe(4 + body.length);
  out.writeUInt32BE(body.length, 0);
  body.copy(out, 4);
  return out;
}

/**
 * Streaming frame decoder — feed it chunks from a socket, get back zero
 * or more complete frames per call. Maintains an internal byte buffer.
 *
 * Trust boundary: every byte arriving from the socket flows through here.
 * Length prefix is validated BEFORE any payload allocation (SEC-004).
 */
export class FrameDecoder {
  constructor() {
    /** @private */
    this._buf = Buffer.alloc(0);
  }

  /**
   * Append `chunk` to the internal buffer and return all complete frames
   * decoded from it.
   *
   * @param {Buffer} chunk
   * @returns {Frame[]}
   * @throws {WireError} on protocol violation
   */
  push(chunk) {
    if (!Buffer.isBuffer(chunk)) {
      throw new WireError("decoder.push expects a Buffer", "BAD_INPUT");
    }
    this._buf = this._buf.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this._buf, chunk]);
    const frames = [];
    while (this._buf.length >= 4) {
      const len = this._buf.readUInt32BE(0);
      if (len === 0) {
        throw new WireError("zero-length frame", "ZERO_LEN");
      }
      if (len > MAX_FRAME_BYTES) {
        // Reject without ever allocating the body. Trust-boundary defense.
        throw new WireError(
          `frame too large: ${len} bytes (max ${MAX_FRAME_BYTES})`,
          "TOO_LARGE",
        );
      }
      if (this._buf.length < 4 + len) {
        // Need more bytes — wait for next chunk.
        break;
      }
      const bodyBytes = this._buf.subarray(4, 4 + len);
      let frame;
      try {
        frame = JSON.parse(bodyBytes.toString("utf8"));
      } catch (err) {
        throw new WireError(`invalid json: ${err.message}`, "BAD_JSON");
      }
      if (frame === null || typeof frame !== "object" || Array.isArray(frame)) {
        throw new WireError("frame body must be a json object", "BAD_FRAME");
      }
      // Inbound frames with unknown `type` are ACCEPTED by the decoder
      // and ignored downstream by the registry — forward-compat policy
      // for future Putz frame types like `roster_update`. We only
      // reject when `type` itself is missing or non-string, since the
      // dispatch tables key off it.
      // The Rust side enforces `deny_unknown_fields` for OUTGOING
      // frames; we deliberately do NOT enforce it inbound.
      if (typeof frame.type !== "string") {
        throw new WireError("frame missing type field", "BAD_FRAME");
      }
      frames.push(frame);
      this._buf = this._buf.subarray(4 + len);
    }
    // Compact: if the buffer is empty, drop the slice ref.
    if (this._buf.length === 0) {
      this._buf = Buffer.alloc(0);
    }
    return frames;
  }
}
