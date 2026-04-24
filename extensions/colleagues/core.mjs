/**
 * Core logic for the colleagues Copilot CLI extension.
 *
 * Pure functions with dependency-injected fetch — testable without
 * importing `@github/copilot-sdk/extension`.
 *
 * @module core
 */

// ─── Constants ──────────────────────────────────────────────────────
export const HEARTBEAT_INTERVAL_MS = 15_000;

const MAX_INITIAL_PROMPT_LENGTH = 4096;

/** Truncate broker error bodies to avoid leaking internal details. */
const MAX_ERROR_BODY_LENGTH = 200;

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Validate that the swarm URL is localhost-only (127.0.0.1 or [::1]).
 * Returns true if safe, false otherwise.
 */
function isLocalhostUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "localhost"
    );
  } catch {
    return false;
  }
}

/**
 * Sanitize an error body from the broker so we don't leak internal
 * details into the LLM context.
 */
function sanitizeErrorBody(text) {
  if (!text) return "";
  if (text.length > MAX_ERROR_BODY_LENGTH) {
    return text.slice(0, MAX_ERROR_BODY_LENGTH) + "…";
  }
  return text;
}

/**
 * Derive a colleague ID when `COPILOT_COLLEAGUE_ID` is missing.
 * - If COPILOT_COLLEAGUE_ID is set → use it.
 * - If only TAB_ID is available → `orphan-<first 8 chars of TAB_ID>`.
 * - Otherwise → empty string (non-swarm mode).
 */
export function deriveColleagueId(env) {
  const explicit = env.COPILOT_COLLEAGUE_ID;
  if (explicit) return explicit;
  const tabId = env.PUTZ_TAB_ID;
  if (tabId) return `orphan-${tabId.slice(0, 8)}`;
  return "";
}

// ─── Core factory ───────────────────────────────────────────────────

/**
 * Create the core swarm operations from a plain env object.
 *
 * Every async helper takes `fetchFn` as its first argument so tests
 * can inject a mock without touching `globalThis.fetch`.
 *
 * @param {Record<string, string>} env — environment variables
 * @returns Core API surface
 */
export function createCore(env) {
  const url = env.PUTZ_SWARM_URL || "";
  const token = env.PUTZ_SWARM_TOKEN || "";
  const tabId = env.PUTZ_TAB_ID || "";
  const colleagueId = deriveColleagueId(env);
  const colleagueName = env.COPILOT_COLLEAGUE_NAME || "";
  const parent = env.COPILOT_COLLEAGUE_PARENT || null;
  // M2: Read initial prompt and delete from env so it's used only once.
  const initialPrompt = env.COPILOT_COLLEAGUE_INITIAL_PROMPT || null;

  // M1: Validate swarm URL is localhost-only
  const enabled = !!(url && token && isLocalhostUrl(url));

  const authHeaders = () => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  });

  // ── HTTP helpers (H2: sanitized error bodies, resp.ok check) ────

  async function swarmPost(fetchFn, path, body) {
    const resp = await fetchFn(`${url}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = sanitizeErrorBody(await resp.text().catch(() => ""));
      throw new Error(`Swarm ${path} failed (${resp.status}): ${text}`);
    }
    return resp.json();
  }

  async function swarmGet(fetchFn, path) {
    const resp = await fetchFn(`${url}${path}`, {
      method: "GET",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const text = sanitizeErrorBody(await resp.text().catch(() => ""));
      throw new Error(`Swarm ${path} failed (${resp.status}): ${text}`);
    }
    return resp.json();
  }

  // ── Public API ────────────────────────────────────────────────────

  const isEnabled = () => enabled;

  // M13: No `pid` in registration payload
  async function register(fetchFn) {
    return swarmPost(fetchFn, "/swarm/register", {
      colleague_id: colleagueId,
      name: colleagueName,
      tab_id: tabId,
      parent: parent || undefined,
    });
  }

  async function deregister(fetchFn) {
    return swarmPost(fetchFn, "/swarm/deregister", {
      colleague_id: colleagueId,
    });
  }

  async function sendHeartbeat(fetchFn, status = "idle") {
    return swarmPost(fetchFn, "/swarm/heartbeat", {
      colleague_id: colleagueId,
      status,
    });
  }

  async function getRoster(fetchFn) {
    const data = await swarmGet(fetchFn, "/swarm/roster");
    const peers = data.peers || [];
    if (peers.length === 0) return "No peers currently registered in the swarm.";
    const lines = peers.map(
      (p) => `• ${p.name} (${p.id}) — ${p.status} [tab: ${p.tab_id}]`,
    );
    return `Swarm roster (${peers.length} peer${peers.length !== 1 ? "s" : ""}):\n${lines.join("\n")}`;
  }

  async function spawnColleague(fetchFn, name, prompt) {
    const result = await swarmPost(fetchFn, "/swarm/spawn", {
      name,
      parent_id: colleagueId,
      initial_prompt: prompt || undefined,
    });
    return `Spawned colleague "${name}" (${result.colleague_id}) in tab ${result.tab_id}.`;
  }

  async function sendMessage(fetchFn, to, body, severity = "normal") {
    const result = await swarmPost(fetchFn, "/swarm/message", {
      from: colleagueId,
      to,
      body,
      severity,
    });
    return `Message sent (id: ${result.id}).`;
  }

  async function focusColleague(fetchFn, targetId) {
    const data = await swarmGet(fetchFn, "/swarm/roster");
    const peer = (data.peers || []).find((p) => p.id === targetId);
    if (!peer) return `Colleague ${targetId} not found in roster.`;
    await swarmPost(fetchFn, "/swarm/focus", { tab_id: peer.tab_id });
    return `Focused tab for ${peer.name} (${targetId}).`;
  }

  /** H4: Fetch the roster and return it as context for the LLM. */
  async function getRosterContext(fetchFn) {
    const data = await swarmGet(fetchFn, "/swarm/roster");
    const peers = (data.peers || []).filter((p) => p.id !== colleagueId);
    if (peers.length === 0) return null;
    const lines = peers.map(
      (p) => `- ${p.name} (${p.id}): ${p.status}`,
    );
    return `You are ${colleagueName} (${colleagueId}). Active swarm peers:\n${lines.join("\n")}`;
  }

  function getInitialPrompt() {
    return initialPrompt || null;
  }

  function getConfig() {
    return {
      url,
      tokenSet: !!token,
      tabId,
      colleagueId,
      colleagueName,
      parent,
    };
  }

  return {
    isEnabled,
    register,
    deregister,
    sendHeartbeat,
    getRoster,
    spawnColleague,
    sendMessage,
    focusColleague,
    getRosterContext,
    getInitialPrompt,
    getConfig,
  };
}
