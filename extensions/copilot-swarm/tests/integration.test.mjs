// Integration tests — exercise ClientRegistry against an in-process socket
// server that speaks the same wire format. Verifies registration handshake,
// heartbeats, recv routing, notify/sendTo, and graceful shutdown.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import { encodeFrame, FrameDecoder } from "../src/wire.mjs";
import { ClientRegistry } from "../src/registry.mjs";

/** Build a per-test socket path that won't collide with anything else. */
function mkSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "putz-colleague-test-"));
  return path.join(dir, "swarm.sock");
}

/**
 * Start a minimal mock coordinator. Captures every received frame and
 * sends `register_ack` automatically when a `register` arrives.
 *
 * @param {string} sockPath
 * @returns {Promise<{server: net.Server, sockets: net.Socket[], received: object[]}>}
 */
async function startMock(sockPath) {
  const sockets = [];
  const received = [];
  const server = net.createServer((sock) => {
    sockets.push(sock);
    const dec = new FrameDecoder();
    sock.on("data", (chunk) => {
      const frames = dec.push(chunk);
      for (const f of frames) {
        received.push(f);
        if (f.type === "register") {
          sock.write(
            encodeFrame({
              type: "register_ack",
              colleague_id: f.colleague_id,
              roster: [{ id: "peer-1", name: "peer", tab_id: "t2", status: "idle" }],
            }),
          );
        }
      }
    });
    sock.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, () => resolve());
  });
  return { server, sockets, received };
}

async function stopMock(mock) {
  for (const s of mock.sockets) s.destroy();
  await new Promise((resolve) => mock.server.close(() => resolve()));
}

test("missing PUTZ_SWARM_PATH → boot returns null (silent no-op)", async () => {
  const { boot } = await import("../index.mjs");
  const api = await boot({ PUTZ_TAB_ID: "t1" }); // no PUTZ_SWARM_PATH
  assert.equal(api, null);
});

test("missing PUTZ_TAB_ID → boot returns null", async () => {
  const { boot } = await import("../index.mjs");
  const api = await boot({ PUTZ_SWARM_PATH: "/some/path" });
  assert.equal(api, null);
});

test("connect → register → register_ack → registered event", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "tab-A",
      colleagueId: "alice-1234",
      name: "alice",
      pid: 1234,
      heartbeatMs: 1_000_000, // disabled for this test
      autoReconnect: false,
    });
    reg.start();
    const [evt] = await once(reg, "registered");
    assert.equal(evt.colleagueId, "alice-1234");
    assert.equal(evt.roster.length, 1);
    assert.equal(evt.roster[0].id, "peer-1");
    // Verify register frame contents on the wire.
    assert.equal(mock.received.length, 1);
    assert.deepEqual(mock.received[0], {
      type: "register",
      tab_id: "tab-A",
      colleague_id: "alice-1234",
      name: "alice",
      pid: 1234,
    });
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("heartbeat fires every interval after registration", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "c",
      name: "c",
      heartbeatMs: 30,
      autoReconnect: false,
    });
    reg.start();
    await once(reg, "registered");
    await new Promise((r) => setTimeout(r, 110));
    const heartbeats = mock.received.filter((f) => f.type === "heartbeat");
    assert.ok(heartbeats.length >= 2, `expected >=2 heartbeats, got ${heartbeats.length}`);
    for (const h of heartbeats) assert.equal(h.colleague_id, "c");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("recv_from routed to `recv` event", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "c",
      name: "c",
      heartbeatMs: 1_000_000,
      autoReconnect: false,
    });
    reg.start();
    await once(reg, "registered");
    // Push a recv_from from the mock side.
    mock.sockets[0].write(
      encodeFrame({
        type: "recv_from",
        from: "peer-1",
        payload: { kind: "ping", n: 7 },
      }),
    );
    const [evt] = await once(reg, "recv");
    assert.equal(evt.from, "peer-1");
    assert.deepEqual(evt.payload, { kind: "ping", n: 7 });
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("notify and sendTo serialize as expected on the wire", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "c",
      name: "c",
      heartbeatMs: 1_000_000,
      autoReconnect: false,
    });
    reg.start();
    await once(reg, "registered");
    reg.notify("build done", "urgent");
    reg.sendTo("peer-1", { kind: "result", ok: true });
    // give writes a tick
    await new Promise((r) => setTimeout(r, 20));
    const notify = mock.received.find((f) => f.type === "notify");
    const sendTo = mock.received.find((f) => f.type === "send_to");
    assert.deepEqual(notify, {
      type: "notify",
      colleague_id: "c",
      message: "build done",
      severity: "urgent",
    });
    assert.deepEqual(sendTo, {
      type: "send_to",
      from: "c",
      to: "peer-1",
      payload: { kind: "result", ok: true },
    });
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("notify before registration throws", async () => {
  const reg = new ClientRegistry({
    path: "/nonexistent/path/never-bound",
    tabId: "t",
    colleagueId: "c",
    name: "c",
    autoReconnect: false,
  });
  assert.throws(() => reg.notify("oops"), /not registered/i);
});

test("graceful shutdown sends disconnect frame", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "cc",
      name: "n",
      heartbeatMs: 1_000_000,
      autoReconnect: false,
    });
    reg.start();
    await once(reg, "registered");
    await reg.shutdown("user_quit");
    // wait for the write to flush + close to register on server
    await new Promise((r) => setTimeout(r, 30));
    const disc = mock.received.find((f) => f.type === "disconnect");
    assert.deepEqual(disc, {
      type: "disconnect",
      colleague_id: "cc",
      reason: "user_quit",
    });
  } finally {
    await stopMock(mock);
  }
});

test("auto-reconnect on socket close (with backoff)", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "c",
      name: "c",
      heartbeatMs: 1_000_000,
      autoReconnect: true,
    });
    reg.start();
    await once(reg, "registered");
    // Force-close the server side; client must reconnect & re-register.
    mock.sockets[0].destroy();
    const [evt2] = await once(reg, "registered"); // second registration
    assert.equal(evt2.colleagueId, "c");
    assert.ok(mock.received.filter((f) => f.type === "register").length >= 2);
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("server-initiated disconnect stops reconnect loop", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "c",
      name: "c",
      heartbeatMs: 1_000_000,
      autoReconnect: true,
    });
    reg.start();
    await once(reg, "registered");
    // Server kicks us
    mock.sockets[0].write(
      encodeFrame({
        type: "disconnect",
        colleague_id: "c",
        reason: "duplicate_tab",
      }),
    );
    const [discEvt] = await once(reg, "disconnect");
    assert.equal(discEvt.reason, "duplicate_tab");
    await once(reg, "closed");
    // No reconnect should follow.
    const before = mock.received.filter((f) => f.type === "register").length;
    await new Promise((r) => setTimeout(r, 100));
    const after = mock.received.filter((f) => f.type === "register").length;
    assert.equal(before, after);
  } finally {
    await stopMock(mock);
  }
});

test("forward-compat: unknown frame type is consumed, no crash, no disconnect", async () => {
  // A future Putz coordinator may ship new frame types. The decoder
  // accepts them (they have a string `type`), and the registry
  // ignores them via the default switch arm. Behavior must remain:
  // no error event, no disconnect, no closed event, registration intact.
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "c",
      name: "c",
      heartbeatMs: 1_000_000,
      autoReconnect: false,
    });
    let errored = false;
    let disconnected = false;
    reg.on("error", () => { errored = true; });
    reg.on("disconnect", () => { disconnected = true; });
    reg.on("closed", () => { disconnected = true; });
    reg.start();
    await once(reg, "registered");

    // Synthetic future frame the registry doesn't know about. Bypass
    // `encodeFrame` because outgoing validation would reject an
    // unknown type — the coordinator side has no such restriction.
    const body = Buffer.from(JSON.stringify({ type: "future_frame_xyz" }), "utf8");
    const wire = Buffer.allocUnsafe(4 + body.length);
    wire.writeUInt32BE(body.length, 0);
    body.copy(wire, 4);
    mock.sockets[0].write(wire);

    await new Promise((r) => setTimeout(r, 30));
    assert.equal(errored, false, "unknown frame must not emit error");
    assert.equal(disconnected, false, "unknown frame must not disconnect");
    assert.equal(reg.registered, true, "registration must remain");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("roster_update frame updates roster and emits 'roster' event", async () => {
  // T3 introduces this frame; T2 must consume it gracefully and surface
  // the new colleagues array via a `roster` event for downstream UI.
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "c",
      name: "c",
      heartbeatMs: 1_000_000,
      autoReconnect: false,
    });
    reg.start();
    await once(reg, "registered");

    const newColleagues = [
      { id: "alice-1", name: "alice", tab_id: "t1", status: "idle" },
      { id: "bob-1", name: "bob", tab_id: "t2", status: "active" },
    ];
    // Bypass outgoing validation — coordinator emits this; wire codec
    // FRAME_SPECS only constrains what *we* send, not what we accept.
    const body = Buffer.from(
      JSON.stringify({ type: "roster_update", colleagues: newColleagues }),
      "utf8",
    );
    const wire = Buffer.allocUnsafe(4 + body.length);
    wire.writeUInt32BE(body.length, 0);
    body.copy(wire, 4);
    mock.sockets[0].write(wire);

    const [received] = await once(reg, "roster");
    assert.deepEqual(received, newColleagues);
    assert.deepEqual(reg.roster, newColleagues);
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("notify rejects severity outside the allowed lowercase set", async () => {
  // Rust enum (`Severity` in src-tauri/src/swarm/types.rs) accepts only
  // urgent | normal | ambient — anything else closes the connection.
  // Validate at the API boundary so we throw a typed error instead.
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = new ClientRegistry({
      path: sockPath,
      tabId: "t",
      colleagueId: "c",
      name: "c",
      heartbeatMs: 1_000_000,
      autoReconnect: false,
    });
    reg.start();
    await once(reg, "registered");
    assert.throws(
      () => reg.notify("hello", "warn"),
      (e) => e.name === "WireError" && e.code === "BAD_SEVERITY",
    );
    assert.throws(
      () => reg.notify("hello", "Normal"),
      (e) => e.name === "WireError" && e.code === "BAD_SEVERITY",
    );
    // The valid values must still pass.
    reg.notify("hi", "urgent");
    reg.notify("hi", "normal");
    reg.notify("hi", "ambient");
    reg.notify("hi"); // omitted is OK
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});
