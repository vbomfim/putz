// T5 coordination tests — exercise the claim/release/RPC API end to end
// against an in-process mock coordinator that speaks the wire protocol.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import { encodeFrame, FrameDecoder } from "../src/wire.mjs";
import { ClientRegistry, INBOX_CAP } from "../src/registry.mjs";
import { createColleagueApi } from "../src/api.mjs";

function mkSocketPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "putz-t5-"));
  return path.join(dir, "swarm.sock");
}

/**
 * Start a mock coordinator that you can drive frame-by-frame. `respond`
 * is called for every received frame and may return a frame (or array)
 * to send back, or null to stay silent. `register` is auto-acked unless
 * `respond` short-circuits it.
 */
async function startMock(sockPath, respond) {
  const sockets = [];
  const received = [];
  const server = net.createServer((sock) => {
    sockets.push(sock);
    const dec = new FrameDecoder();
    sock.on("data", (chunk) => {
      for (const f of dec.push(chunk)) {
        received.push(f);
        let out = respond ? respond(f, sock) : null;
        if (!out && f.type === "register") {
          out = {
            type: "register_ack",
            colleague_id: f.colleague_id,
            roster: [],
            claims: [],
          };
        }
        if (!out) continue;
        const arr = Array.isArray(out) ? out : [out];
        for (const o of arr) sock.write(encodeFrame(o));
      }
    });
    sock.on("error", () => {});
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(sockPath, resolve);
  });
  return { server, sockets, received };
}

async function stopMock(mock) {
  for (const s of mock.sockets) s.destroy();
  await new Promise((resolve) => mock.server.close(resolve));
}

function makeReg(sockPath) {
  return new ClientRegistry({
    path: sockPath,
    tabId: "tab-A",
    colleagueId: "alice",
    name: "alice",
    heartbeatMs: 1_000_000,
    autoReconnect: false,
  });
}

test("register_ack with claims field seeds the claim cache", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath, (f) => {
    if (f.type === "register") {
      return {
        type: "register_ack",
        colleague_id: f.colleague_id,
        roster: [],
        claims: [
          {
            resource: "deploy-prod",
            holder: "bob",
            message: "freeze",
            expires_at_ms: Date.now() + 60_000,
          },
        ],
      };
    }
    return null;
  });
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const cached = reg.cachedClaim("deploy-prod");
    assert.ok(cached);
    assert.equal(cached.holder, "bob");
    assert.equal(cached.message, "freeze");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("api.claim() sends claim_req and resolves on tool_response ok", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath, (f) => {
    if (f.type === "claim_req") {
      return {
        type: "tool_response",
        request_id: f.request_id,
        ok: true,
        payload: {
          resource: f.resource,
          holder: "alice",
          message: f.message ?? "",
          expires_at_ms: Date.now() + f.ttl_ms,
        },
      };
    }
    return null;
  });
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    const view = await api.claim("deploy-prod", 5, "freeze");
    assert.equal(view.resource, "deploy-prod");
    assert.equal(view.holder, "alice");
    assert.equal(view.message, "freeze");
    assert.ok(view.expiresAtMs > Date.now());
    // claim_req on the wire: ttl_ms = 5 * 60_000.
    const req = mock.received.find((f) => f.type === "claim_req");
    assert.equal(req.ttl_ms, 300_000);
    assert.equal(typeof req.request_id, "string");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("api.claim() rejects on tool_response ok=false with code on err", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath, (f) => {
    if (f.type === "claim_req") {
      return {
        type: "tool_response",
        request_id: f.request_id,
        ok: false,
        payload: { holder: "bob" },
        error: "held_by_other",
      };
    }
    return null;
  });
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    await assert.rejects(
      () => api.claim("prod", 1),
      (err) => err.code === "held_by_other",
    );
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("api.check() reads from local cache without sending a frame", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    // Wait deterministically for the Claim broadcast to land in the cache —
    // CR-Pass-2 N1: replaced the previous `setTimeout(30)` race with an
    // event-based wait so the assertion never fires before the registry
    // has actually processed the frame.
    const claimsChanged = once(reg, "claims-changed");
    mock.sockets[0].write(
      encodeFrame({
        type: "claim",
        resource: "x",
        holder: "bob",
        message: "",
        expires_at_ms: Date.now() + 10_000,
      }),
    );
    await claimsChanged;
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    const r = api.check("x");
    // CR-Pass-2 J1: api.check now mirrors the wire `tool_response` shape.
    assert.equal(r.free, false);
    assert.equal(r.claim.holder, "bob");
    assert.equal(r.claim.resource, "x");
    // No new frame should have been sent — listClaims/check are local-cache only.
    const before = mock.received.length;
    const free = api.check("y");
    assert.deepEqual(free, { free: true });
    api.listClaims();
    assert.equal(mock.received.length, before);
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("inbox ring buffer caps at INBOX_CAP", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    // Push INBOX_CAP + 10 recv_notify frames.
    for (let i = 0; i < INBOX_CAP + 10; i++) {
      mock.sockets[0].write(
        encodeFrame({
          type: "recv_notify",
          from: "bob",
          message: `msg ${i}`,
          severity: "normal",
        }),
      );
    }
    // Drain.
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(reg.inbox.length, INBOX_CAP);
    // Oldest dropped — newest preserved.
    assert.equal(reg.inbox[INBOX_CAP - 1].message, `msg ${INBOX_CAP + 9}`);
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("getContextBlock formats peers + claims + inbox with self-tag", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath, (f) => {
    if (f.type === "register") {
      return {
        type: "register_ack",
        colleague_id: f.colleague_id,
        roster: [{ id: "bob", name: "bob", tab_id: "t2", status: "idle" }],
        claims: [
          {
            resource: "deploy-prod",
            holder: "alice",
            message: "freeze",
            expires_at_ms: Date.now() + 5 * 60_000,
          },
          {
            resource: "port-3000",
            holder: "bob",
            message: "",
            expires_at_ms: Date.now() + 60_000,
          },
        ],
      };
    }
    return null;
  });
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    mock.sockets[0].write(
      encodeFrame({
        type: "recv_notify",
        from: "bob",
        message: "ready",
        severity: "normal",
      }),
    );
    await new Promise((r) => setTimeout(r, 30));
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    const block = api.getContextBlock();
    assert.match(block, /1 peer/);
    assert.match(block, /2 active claims/);
    assert.match(block, /\(you\)/); // alice tagged as (you)
    assert.match(block, /held by bob/);
    assert.match(block, /freeze/);
    assert.match(block, /📨 bob: ready/);
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("getContextBlock returns empty string when nothing to say", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    assert.equal(api.getContextBlock(), "");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("markInboxRead clears the inbox", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    mock.sockets[0].write(
      encodeFrame({ type: "recv_notify", from: "bob", message: "x" }),
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(reg.inbox.length, 1);
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    api.markInboxRead();
    assert.equal(reg.inbox.length, 0);
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("request times out cleanly when no tool_response arrives", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath); // no respond → silence on claim_req
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    await assert.rejects(
      () => reg.request("claim_req", { resource: "x", ttl_ms: 1000 }, 30),
      (err) => err.code === "TIMEOUT",
    );
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("Claim broadcast updates cache and emits claims-changed", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const evt = once(reg, "claims-changed");
    mock.sockets[0].write(
      encodeFrame({
        type: "claim",
        resource: "z",
        holder: "bob",
        message: "",
        expires_at_ms: Date.now() + 1000,
      }),
    );
    await evt;
    assert.equal(reg.cachedClaim("z").holder, "bob");
    // Then a Release wipes it.
    const evt2 = once(reg, "claims-changed");
    mock.sockets[0].write(
      encodeFrame({ type: "release", resource: "z", holder: "bob" }),
    );
    await evt2;
    assert.equal(reg.cachedClaim("z"), null);
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("api.send is an acknowledged RPC (D1) — resolves on tool_response success", async () => {
  // CR-Pass-2 D1: api.send was rewritten as send_req / tool_response
  // (was previously a fire-and-forget send_to). The mock answers the
  // send_req with a successful tool_response; the call must resolve
  // with `{ delivered: true }`.
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath, (f) => {
    if (f.type === "send_req") {
      return {
        type: "tool_response",
        request_id: f.request_id,
        ok: true,
        payload: { delivered: true },
      };
    }
    return null;
  });
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    const result = await api.send("bob", "ping you");
    assert.deepEqual(result, { delivered: true });
    // Verify the wire frame was send_req (not legacy send_to).
    const sendReq = mock.received.find((f) => f.type === "send_req");
    assert.ok(sendReq, "expected a send_req frame on the wire");
    assert.equal(sendReq.target_colleague_id, "bob");
    assert.equal(sendReq.message, "ping you");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("recv_notify bridges to the inbox (peer received via real send)", async () => {
  // After D1, the recipient sees a server-pushed `recv_notify`, not the
  // old `recv_from { kind: 'swarm_send' }` envelope. This test pins
  // the recipient-side bridge.
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const notifyEvent = once(reg, "notify");
    mock.sockets[0].write(
      encodeFrame({
        type: "recv_notify",
        from: "bob",
        message: "ping you",
        severity: "normal",
      }),
    );
    await notifyEvent;
    assert.equal(reg.inbox.length, 1);
    assert.equal(reg.inbox[0].from, "bob");
    assert.equal(reg.inbox[0].message, "ping you");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("K1 #3 — pending requests reject with DISCONNECTED on socket close", async () => {
  // CR-Pass-2 K1: when the registry's transport closes mid-request,
  // every in-flight RPC must reject with `code: "DISCONNECTED"` so
  // callers don't hang until TIMEOUT.
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath); // never responds to claim_req
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const pending = reg.request("claim_req", { resource: "x", ttl_ms: 60_000 });
    // Yank the underlying socket out from under the pending request.
    setImmediate(() => {
      for (const s of mock.sockets) s.destroy();
    });
    await assert.rejects(pending, (err) => err.code === "DISCONNECTED");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("K1 #4 — tool_response with unknown request_id is silently dropped", async () => {
  // CR-Pass-2 K1: a tool_response that does not match any pending
  // request must not crash the registry, must not emit, and must not
  // disrupt subsequent legitimate RPCs.
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath, (f) => {
    if (f.type === "claim_req") {
      return {
        type: "tool_response",
        request_id: f.request_id,
        ok: true,
        payload: {
          resource: f.resource,
          holder: "alice",
          message: "",
          expires_at_ms: Date.now() + 60_000,
        },
      };
    }
    return null;
  });
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    // Inject a stray response with a request_id that no pending RPC owns.
    mock.sockets[0].write(
      encodeFrame({
        type: "tool_response",
        request_id: "ghost-id-not-in-pending",
        ok: true,
        payload: { whatever: true },
      }),
    );
    // Give the stray a chance to be processed and (silently) dropped.
    await new Promise((r) => setImmediate(r));
    // A real RPC after the stray must still succeed.
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    const view = await api.claim("after-ghost", 1);
    assert.equal(view.resource, "after-ghost");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});

test("C1 — request rejects with PENDING_CAP when the in-flight map is full", async () => {
  // CR-Pass-2 C1: registry caps simultaneously in-flight RPCs at 100.
  // The mock never responds, so the first 100 stay pending; the 101st
  // must fail synchronously with `code: "PENDING_CAP"`.
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath);
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const inflight = [];
    for (let i = 0; i < 100; i++) {
      // Catch + swallow so the runner isn't drowned in unhandled rejections
      // when reg.shutdown() tears them down at end-of-test.
      const p = reg
        .request("claim_req", { resource: `r${i}`, ttl_ms: 60_000 })
        .catch(() => undefined);
      inflight.push(p);
    }
    assert.throws(
      () => reg.request("claim_req", { resource: "overflow", ttl_ms: 60_000 }),
      (err) => err.code === "PENDING_CAP",
    );
    await reg.shutdown();
    await Promise.all(inflight);
  } finally {
    await stopMock(mock);
  }
});

test("api.broadcast resolves with recipients count", async () => {
  const sockPath = mkSocketPath();
  const mock = await startMock(sockPath, (f) => {
    if (f.type === "broadcast_req") {
      return {
        type: "tool_response",
        request_id: f.request_id,
        ok: true,
        payload: { recipients: 3 },
      };
    }
    return null;
  });
  try {
    const reg = makeReg(sockPath);
    reg.start();
    await once(reg, "registered");
    const api = createColleagueApi(reg, { colleagueId: "alice", tabId: "tab-A" });
    const n = await api.broadcast("hello all", "urgent");
    assert.equal(n, 3);
    const req = mock.received.find((f) => f.type === "broadcast_req");
    assert.equal(req.severity, "urgent");
    await reg.shutdown();
  } finally {
    await stopMock(mock);
  }
});
