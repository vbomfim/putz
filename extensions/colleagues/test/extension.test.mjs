/**
 * Unit tests for the colleagues Copilot CLI extension core logic.
 *
 * Uses node:test + node:assert with a mock fetch.
 * Imports the REAL `createCore` from `../core.mjs` (C3 fix) — no
 * parallel reimplementation.
 *
 * Covers:
 * - No-op mode when env vars are missing
 * - Self-registration (with and without parent)
 * - Heartbeat loop
 * - Tool handlers: swarm_roster, swarm_spawn, swarm_send_message, swarm_focus
 * - Initial prompt injection
 * - Token masking
 * - Error sanitization (H2)
 * - Orphan colleague ID derivation (H3)
 * - Roster context injection (H4)
 * - M1 localhost-only SWARM_URL validation
 * - M9 HTTP error path coverage
 * - M10 Initial prompt delivered once
 * - M12 Heartbeat interval constant
 * - M13 No PID in registration payload
 *
 * Tags: [TDD], [AC-extension]
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createCore, deriveColleagueId, HEARTBEAT_INTERVAL_MS } from "../core.mjs";

// ─── Mock fetch ─────────────────────────────────────────────────────
let fetchCalls = [];
let fetchResponses = {};

function mockFetch(url, opts) {
  fetchCalls.push({ url, opts });
  const key = `${opts?.method || "GET"} ${url}`;
  const response = fetchResponses[key] || fetchResponses["*"] || { ok: true, status: 200, json: async () => ({}) };
  return Promise.resolve({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    json: async () => (typeof response.body === "function" ? response.body() : response.body ?? {}),
    text: async () => JSON.stringify(typeof response.body === "function" ? response.body() : response.body ?? {}),
  });
}

// ─── Test helpers ───────────────────────────────────────────────────
function setFetchResponse(method, path, body, ok = true, status = 200) {
  const url = `http://127.0.0.1:9111${path}`;
  fetchResponses[`${method} ${url}`] = { ok, status, body };
}

function resetFetch() {
  fetchCalls = [];
  fetchResponses = {};
}

function findFetchCall(method, pathSubstring) {
  return fetchCalls.find(
    (c) => (c.opts?.method || "GET") === method && c.url.includes(pathSubstring)
  );
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("colleagues extension — core logic", () => {
  const BASE_ENV = {
    PUTZ_SWARM_URL: "http://127.0.0.1:9111",
    PUTZ_SWARM_TOKEN: "test-token-abc",
    PUTZ_TAB_ID: "tab-001",
    COPILOT_COLLEAGUE_ID: "alice-ab12",
    COPILOT_COLLEAGUE_NAME: "alice",
  };

  beforeEach(() => {
    resetFetch();
  });

  // ── No-op mode ──────────────────────────────────────────────────

  describe("no-op mode", () => {
    it("isEnabled returns false when PUTZ_SWARM_URL is unset", () => {
      const { isEnabled } = createCore({});
      assert.equal(isEnabled(), false);
    });

    it("isEnabled returns false when PUTZ_SWARM_TOKEN is missing", () => {
      const { isEnabled } = createCore({ PUTZ_SWARM_URL: "http://127.0.0.1:9111" });
      assert.equal(isEnabled(), false);
    });

    it("isEnabled returns true when all required env vars are set", () => {
      const { isEnabled } = createCore(BASE_ENV);
      assert.equal(isEnabled(), true);
    });

    // M1: Localhost-only validation
    it("isEnabled returns false for non-localhost URL", () => {
      const env = { ...BASE_ENV, PUTZ_SWARM_URL: "http://evil.com:9111" };
      const { isEnabled } = createCore(env);
      assert.equal(isEnabled(), false);
    });

    it("isEnabled returns false for malformed URL", () => {
      const env = { ...BASE_ENV, PUTZ_SWARM_URL: "not-a-url" };
      const { isEnabled } = createCore(env);
      assert.equal(isEnabled(), false);
    });

    it("isEnabled returns true for localhost hostname", () => {
      const env = { ...BASE_ENV, PUTZ_SWARM_URL: "http://localhost:9111" };
      const { isEnabled } = createCore(env);
      assert.equal(isEnabled(), true);
    });

    it("isEnabled returns true for ::1 IPv6", () => {
      const env = { ...BASE_ENV, PUTZ_SWARM_URL: "http://[::1]:9111" };
      const { isEnabled } = createCore(env);
      assert.equal(isEnabled(), true);
    });
  });

  // ── Registration ────────────────────────────────────────────────

  describe("register", () => {
    it("sends POST /swarm/register with correct payload", async () => {
      const { register } = createCore(BASE_ENV);
      setFetchResponse("POST", "/swarm/register", { registered_at: "2025-01-01T00:00:00Z" });

      await register(mockFetch);

      const call = findFetchCall("POST", "/swarm/register");
      assert.ok(call, "register call should have been made");
      const body = JSON.parse(call.opts.body);
      assert.equal(body.colleague_id, "alice-ab12");
      assert.equal(body.name, "alice");
      assert.equal(body.tab_id, "tab-001");
    });

    it("includes parent when COPILOT_COLLEAGUE_PARENT is set", async () => {
      const env = { ...BASE_ENV, COPILOT_COLLEAGUE_PARENT: "bob-cd34" };
      const { register } = createCore(env);
      setFetchResponse("POST", "/swarm/register", { registered_at: "2025-01-01T00:00:00Z" });

      await register(mockFetch);

      const call = findFetchCall("POST", "/swarm/register");
      const body = JSON.parse(call.opts.body);
      assert.equal(body.parent, "bob-cd34");
    });

    it("includes Authorization header with bearer token", async () => {
      const { register } = createCore(BASE_ENV);
      setFetchResponse("POST", "/swarm/register", { registered_at: "2025-01-01T00:00:00Z" });

      await register(mockFetch);

      const call = findFetchCall("POST", "/swarm/register");
      assert.equal(call.opts.headers["Authorization"], "Bearer test-token-abc");
    });

    // M13: No PID in registration payload
    it("does NOT include pid in registration payload", async () => {
      const { register } = createCore(BASE_ENV);
      setFetchResponse("POST", "/swarm/register", { registered_at: "2025-01-01T00:00:00Z" });

      await register(mockFetch);

      const call = findFetchCall("POST", "/swarm/register");
      const body = JSON.parse(call.opts.body);
      assert.equal(body.pid, undefined, "pid should not be in registration payload");
    });
  });

  // ── Deregister ──────────────────────────────────────────────────

  describe("deregister", () => {
    it("sends POST /swarm/deregister with colleague_id", async () => {
      const { deregister } = createCore(BASE_ENV);
      setFetchResponse("POST", "/swarm/deregister", {});

      await deregister(mockFetch);

      const call = findFetchCall("POST", "/swarm/deregister");
      assert.ok(call, "deregister call should have been made");
      const body = JSON.parse(call.opts.body);
      assert.equal(body.colleague_id, "alice-ab12");
    });
  });

  // ── Heartbeat ───────────────────────────────────────────────────

  describe("heartbeat", () => {
    it("sends POST /swarm/heartbeat with status=idle", async () => {
      const { sendHeartbeat } = createCore(BASE_ENV);
      setFetchResponse("POST", "/swarm/heartbeat", { stale_peers: [] });

      await sendHeartbeat(mockFetch, "idle");

      const call = findFetchCall("POST", "/swarm/heartbeat");
      assert.ok(call, "heartbeat call should have been made");
      const body = JSON.parse(call.opts.body);
      assert.equal(body.colleague_id, "alice-ab12");
      assert.equal(body.status, "idle");
    });

    // M12: Heartbeat interval is 15s
    it("HEARTBEAT_INTERVAL_MS is 15000", () => {
      assert.equal(HEARTBEAT_INTERVAL_MS, 15_000);
    });
  });

  // ── Roster tool ─────────────────────────────────────────────────

  describe("getRoster", () => {
    it("fetches GET /swarm/roster and returns formatted output", async () => {
      const peers = [
        { id: "alice-ab12", name: "alice", status: "idle", tab_id: "t1", last_seen: "2025-01-01T00:00:00Z" },
        { id: "bob-cd34", name: "bob", status: "working", tab_id: "t2", last_seen: "2025-01-01T00:00:01Z" },
      ];
      setFetchResponse("GET", "/swarm/roster", { peers });

      const { getRoster } = createCore(BASE_ENV);
      const result = await getRoster(mockFetch);

      assert.ok(result.includes("alice"));
      assert.ok(result.includes("bob"));
      assert.ok(result.includes("idle"));
      assert.ok(result.includes("working"));
    });

    it("returns 'no peers' message when roster is empty", async () => {
      setFetchResponse("GET", "/swarm/roster", { peers: [] });

      const { getRoster } = createCore(BASE_ENV);
      const result = await getRoster(mockFetch);

      assert.ok(result.toLowerCase().includes("no"));
    });
  });

  // ── Spawn tool ──────────────────────────────────────────────────

  describe("spawnColleague", () => {
    it("sends POST /swarm/spawn with name and parent_id", async () => {
      setFetchResponse("POST", "/swarm/spawn", { colleague_id: "eve-ef56", tab_id: "t3" });

      const { spawnColleague } = createCore(BASE_ENV);
      const result = await spawnColleague(mockFetch, "eve", "Do something");

      const call = findFetchCall("POST", "/swarm/spawn");
      assert.ok(call, "spawn call should have been made");
      const body = JSON.parse(call.opts.body);
      assert.equal(body.name, "eve");
      assert.equal(body.parent_id, "alice-ab12");
      assert.equal(body.initial_prompt, "Do something");
      // M6: Assert return format includes colleague name and ID
      assert.ok(result.includes("eve"), "result should mention colleague name");
      assert.ok(result.includes("eve-ef56"), "result should mention colleague ID");
    });
  });

  // ── Send message tool ───────────────────────────────────────────

  describe("sendMessage", () => {
    it("sends POST /swarm/message with from, to, body", async () => {
      setFetchResponse("POST", "/swarm/message", { id: "msg-001" });

      const { sendMessage } = createCore(BASE_ENV);
      const result = await sendMessage(mockFetch, "bob-cd34", "Hello Bob");

      const call = findFetchCall("POST", "/swarm/message");
      assert.ok(call, "message call should have been made");
      const body = JSON.parse(call.opts.body);
      assert.equal(body.from, "alice-ab12");
      assert.equal(body.to, "bob-cd34");
      assert.equal(body.body, "Hello Bob");
      assert.equal(body.severity, "normal");
      // M6: Assert return format includes message ID
      assert.ok(result.includes("msg-001"), "result should mention message ID");
    });
  });

  // ── Focus tool ──────────────────────────────────────────────────

  describe("focusColleague", () => {
    it("sends POST /swarm/focus with tab_id from roster lookup", async () => {
      const peers = [
        { id: "bob-cd34", name: "bob", status: "idle", tab_id: "tab-bob", last_seen: "2025-01-01T00:00:00Z" },
      ];
      setFetchResponse("GET", "/swarm/roster", { peers });
      setFetchResponse("POST", "/swarm/focus", { ok: true });

      const { focusColleague } = createCore(BASE_ENV);
      const result = await focusColleague(mockFetch, "bob-cd34");

      const call = findFetchCall("POST", "/swarm/focus");
      assert.ok(call, "focus call should have been made");
      const body = JSON.parse(call.opts.body);
      assert.equal(body.tab_id, "tab-bob");
      assert.ok(result.includes("bob"), "result should mention colleague name");
    });

    it("returns not-found message for unknown colleague", async () => {
      setFetchResponse("GET", "/swarm/roster", { peers: [] });

      const { focusColleague } = createCore(BASE_ENV);
      const result = await focusColleague(mockFetch, "unknown-id");

      assert.ok(result.includes("not found"));
    });
  });

  // ── Initial prompt injection ────────────────────────────────────

  describe("getInitialPrompt", () => {
    it("returns the COPILOT_COLLEAGUE_INITIAL_PROMPT value", () => {
      const env = { ...BASE_ENV, COPILOT_COLLEAGUE_INITIAL_PROMPT: "Scan for bugs" };
      const { getInitialPrompt } = createCore(env);
      assert.equal(getInitialPrompt(), "Scan for bugs");
    });

    it("returns null when no initial prompt is set", () => {
      const { getInitialPrompt } = createCore(BASE_ENV);
      assert.equal(getInitialPrompt(), null);
    });

    // M10: Initial prompt delivered once — the core returns a static value;
    // M2 (env deletion) is handled in extension.mjs, tested in integration.
    it("returns same value on repeated calls (pure function)", () => {
      const env = { ...BASE_ENV, COPILOT_COLLEAGUE_INITIAL_PROMPT: "Do X" };
      const { getInitialPrompt } = createCore(env);
      assert.equal(getInitialPrompt(), "Do X");
      assert.equal(getInitialPrompt(), "Do X");
    });
  });

  // ── Token masking ───────────────────────────────────────────────

  describe("security", () => {
    it("getConfig does not expose the token value", () => {
      const { getConfig } = createCore(BASE_ENV);
      const config = getConfig();
      assert.equal(config.url, "http://127.0.0.1:9111");
      assert.ok(!JSON.stringify(config).includes("test-token-abc"), "Token should not appear in config output");
      assert.equal(config.tokenSet, true);
    });
  });

  // ── H2: Error sanitization ──────────────────────────────────────

  describe("error sanitization (H2)", () => {
    it("throws on HTTP error with sanitized body", async () => {
      setFetchResponse("POST", "/swarm/register", "Detailed internal error info", false, 500);

      const { register } = createCore(BASE_ENV);
      await assert.rejects(
        () => register(mockFetch),
        (err) => {
          assert.ok(err.message.includes("500"), "should include status code");
          return true;
        }
      );
    });

    it("truncates very long error bodies", async () => {
      const longBody = "x".repeat(500);
      setFetchResponse("POST", "/swarm/register", longBody, false, 500);

      const { register } = createCore(BASE_ENV);
      await assert.rejects(
        () => register(mockFetch),
        (err) => {
          // Error body should be truncated (200 chars max + "…")
          assert.ok(err.message.length < 500, "error message should be truncated");
          return true;
        }
      );
    });
  });

  // ── H3: Orphan colleague ID derivation ──────────────────────────

  describe("deriveColleagueId (H3)", () => {
    it("returns COPILOT_COLLEAGUE_ID when set", () => {
      assert.equal(deriveColleagueId({ COPILOT_COLLEAGUE_ID: "alice-ab12" }), "alice-ab12");
    });

    it("returns orphan-<tabId prefix> when only TAB_ID is set", () => {
      const result = deriveColleagueId({ PUTZ_TAB_ID: "abcdef12-3456-7890" });
      assert.equal(result, "orphan-abcdef12");
    });

    it("returns empty string when neither is set", () => {
      assert.equal(deriveColleagueId({}), "");
    });

    it("prefers COLLEAGUE_ID over TAB_ID", () => {
      const result = deriveColleagueId({
        COPILOT_COLLEAGUE_ID: "explicit-id",
        PUTZ_TAB_ID: "tab-12345678",
      });
      assert.equal(result, "explicit-id");
    });
  });

  // ── H4: Roster context injection ────────────────────────────────

  describe("getRosterContext (H4)", () => {
    it("returns null when no other peers exist", async () => {
      setFetchResponse("GET", "/swarm/roster", { peers: [] });

      const { getRosterContext } = createCore(BASE_ENV);
      const result = await getRosterContext(mockFetch);
      assert.equal(result, null);
    });

    it("excludes self from roster context", async () => {
      const peers = [
        { id: "alice-ab12", name: "alice", status: "idle", tab_id: "t1" },
      ];
      setFetchResponse("GET", "/swarm/roster", { peers });

      const { getRosterContext } = createCore(BASE_ENV);
      const result = await getRosterContext(mockFetch);
      assert.equal(result, null, "self-only roster should return null");
    });

    it("returns formatted context with peer info", async () => {
      const peers = [
        { id: "alice-ab12", name: "alice", status: "idle", tab_id: "t1" },
        { id: "bob-cd34", name: "bob", status: "working", tab_id: "t2" },
      ];
      setFetchResponse("GET", "/swarm/roster", { peers });

      const { getRosterContext } = createCore(BASE_ENV);
      const result = await getRosterContext(mockFetch);
      assert.ok(result.includes("bob"));
      assert.ok(result.includes("working"));
      assert.ok(result.includes("alice-ab12"), "should mention self identity");
    });
  });

  // ── M9: HTTP error path tests ───────────────────────────────────

  describe("HTTP error paths (M9)", () => {
    it("getRoster throws on 500 response", async () => {
      setFetchResponse("GET", "/swarm/roster", "Internal error", false, 500);

      const { getRoster } = createCore(BASE_ENV);
      await assert.rejects(() => getRoster(mockFetch), /500/);
    });

    it("spawnColleague throws on 400 response", async () => {
      setFetchResponse("POST", "/swarm/spawn", "Bad request", false, 400);

      const { spawnColleague } = createCore(BASE_ENV);
      await assert.rejects(() => spawnColleague(mockFetch, "test", null), /400/);
    });

    it("sendMessage throws on 404 response", async () => {
      setFetchResponse("POST", "/swarm/message", "Not found", false, 404);

      const { sendMessage } = createCore(BASE_ENV);
      await assert.rejects(() => sendMessage(mockFetch, "bob", "hi"), /404/);
    });

    it("deregister throws on 401 response", async () => {
      setFetchResponse("POST", "/swarm/deregister", "Unauthorized", false, 401);

      const { deregister } = createCore(BASE_ENV);
      await assert.rejects(() => deregister(mockFetch), /401/);
    });

    it("sendHeartbeat throws on 503 response", async () => {
      setFetchResponse("POST", "/swarm/heartbeat", "Service unavailable", false, 503);

      const { sendHeartbeat } = createCore(BASE_ENV);
      await assert.rejects(() => sendHeartbeat(mockFetch, "idle"), /503/);
    });
  });
});

