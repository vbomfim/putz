// Wire codec tests — must match the Rust side byte-exactly.
// Reference: src-tauri/src/swarm/wire.rs
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  encodeFrame,
  FrameDecoder,
  MAX_FRAME_BYTES,
  WireError,
} from "../src/wire.mjs";

function feed(decoder, ...buffers) {
  const out = [];
  for (const buf of buffers) {
    out.push(...decoder.push(buf));
  }
  return out;
}

test("roundtrip: register frame", () => {
  const frame = {
    type: "register",
    tab_id: "tab-1",
    colleague_id: "alice-abcd",
    name: "alice",
    parent: "self",
    pid: 4242,
  };
  const dec = new FrameDecoder();
  const out = feed(dec, encodeFrame(frame));
  assert.deepEqual(out, [frame]);
});

test("roundtrip: register with optional fields omitted", () => {
  const frame = {
    type: "register",
    tab_id: "t",
    colleague_id: "c",
    name: "n",
  };
  const dec = new FrameDecoder();
  assert.deepEqual(feed(dec, encodeFrame(frame)), [frame]);
});

test("roundtrip: heartbeat", () => {
  const frame = { type: "heartbeat", colleague_id: "c", status: "idle" };
  const dec = new FrameDecoder();
  assert.deepEqual(feed(dec, encodeFrame(frame)), [frame]);
});

test("roundtrip: notify with severity", () => {
  const frame = {
    type: "notify",
    colleague_id: "c",
    severity: "urgent",
    message: "build failed",
  };
  const dec = new FrameDecoder();
  assert.deepEqual(feed(dec, encodeFrame(frame)), [frame]);
});

test("roundtrip: send_to with arbitrary payload", () => {
  const frame = {
    type: "send_to",
    from: "a",
    to: "b",
    payload: { kind: "ping", n: 42, deep: { nested: [1, 2] } },
  };
  const dec = new FrameDecoder();
  assert.deepEqual(feed(dec, encodeFrame(frame)), [frame]);
});

test("roundtrip: recv_from", () => {
  const frame = { type: "recv_from", from: "x", payload: { hello: "world" } };
  const dec = new FrameDecoder();
  assert.deepEqual(feed(dec, encodeFrame(frame)), [frame]);
});

test("roundtrip: disconnect with reason", () => {
  const frame = { type: "disconnect", colleague_id: "c", reason: "shutdown" };
  const dec = new FrameDecoder();
  assert.deepEqual(feed(dec, encodeFrame(frame)), [frame]);
});

test("decoder handles split buffers (length across boundary)", () => {
  const frame = { type: "heartbeat", colleague_id: "c" };
  const buf = encodeFrame(frame);
  const dec = new FrameDecoder();
  // Split mid-prefix
  assert.deepEqual(feed(dec, buf.subarray(0, 2)), []);
  assert.deepEqual(feed(dec, buf.subarray(2, 5)), []);
  assert.deepEqual(feed(dec, buf.subarray(5)), [frame]);
});

test("decoder handles concatenated frames in one buffer", () => {
  const f1 = { type: "heartbeat", colleague_id: "a" };
  const f2 = { type: "heartbeat", colleague_id: "b" };
  const dec = new FrameDecoder();
  const combined = Buffer.concat([encodeFrame(f1), encodeFrame(f2)]);
  assert.deepEqual(feed(dec, combined), [f1, f2]);
});

test("oversized prefix rejected before allocation", () => {
  const dec = new FrameDecoder();
  const oversized = Buffer.alloc(4);
  oversized.writeUInt32BE(MAX_FRAME_BYTES + 1, 0);
  assert.throws(() => dec.push(oversized), WireError);
});

test("zero-length prefix rejected", () => {
  const dec = new FrameDecoder();
  const zeroLen = Buffer.from([0, 0, 0, 0]);
  assert.throws(() => dec.push(zeroLen), WireError);
});

test("invalid JSON in body rejected", () => {
  const dec = new FrameDecoder();
  const body = Buffer.from("not json");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(body.length, 0);
  assert.throws(() => dec.push(Buffer.concat([prefix, body])), WireError);
});

test("encode rejects unknown frame type", () => {
  assert.throws(
    () => encodeFrame({ type: "bogus" }),
    /unknown frame type/i,
  );
});

test("encode rejects extra fields (deny_unknown_fields parity)", () => {
  assert.throws(
    () =>
      encodeFrame({
        type: "heartbeat",
        colleague_id: "c",
        extra: 1,
      }),
    /unknown field/i,
  );
});

test("encode rejects oversized payload", () => {
  // Build a frame whose serialized form exceeds MAX_FRAME_BYTES.
  const huge = "x".repeat(MAX_FRAME_BYTES + 100);
  assert.throws(
    () =>
      encodeFrame({
        type: "notify",
        colleague_id: "c",
        message: huge,
      }),
    /too large/i,
  );
});

test("encode rejects missing required field", () => {
  assert.throws(
    () => encodeFrame({ type: "register", tab_id: "t" }),
    /required/i,
  );
});

test("encode rejects wrong type for field", () => {
  assert.throws(
    () => encodeFrame({ type: "heartbeat", colleague_id: 42 }),
    /string/i,
  );
});
