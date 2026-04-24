/**
 * Colleagues — Copilot CLI extension for putz swarm.
 *
 * Enables Copilot CLI agents running in putz terminal tabs to be
 * mutually aware of each other via the putz swarm HTTP broker.
 *
 * Capabilities:
 * - Self-registers on session start, deregisters on end
 * - Heartbeat loop (30s interval) to keep alive in the broker
 * - Tools: swarm_roster, swarm_spawn, swarm_send_message, swarm_focus
 * - Auto-fires initial prompt if COPILOT_COLLEAGUE_INITIAL_PROMPT is set
 *
 * No-op when PUTZ_SWARM_URL is not set (non-swarm terminals).
 *
 * Security: Bearer token is never logged. All requests go to localhost only.
 *
 * @see https://github.com/vbomfim/putz — Phase 2 swarm spec
 */
import { joinSession } from "@github/copilot-sdk/extension";

// ─── Environment ────────────────────────────────────────────────────
const SWARM_URL = process.env.PUTZ_SWARM_URL || "";
const SWARM_TOKEN = process.env.PUTZ_SWARM_TOKEN || "";
const TAB_ID = process.env.PUTZ_TAB_ID || "";
const COLLEAGUE_ID = process.env.COPILOT_COLLEAGUE_ID || "";
const COLLEAGUE_NAME = process.env.COPILOT_COLLEAGUE_NAME || "";
const COLLEAGUE_PARENT = process.env.COPILOT_COLLEAGUE_PARENT || null;
const INITIAL_PROMPT = process.env.COPILOT_COLLEAGUE_INITIAL_PROMPT || null;

const HEARTBEAT_INTERVAL_MS = 30_000;
const ENABLED = !!(SWARM_URL && SWARM_TOKEN);

// ─── HTTP helpers ───────────────────────────────────────────────────

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${SWARM_TOKEN}`,
  };
}

async function swarmPost(path, body) {
  const resp = await fetch(`${SWARM_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Swarm ${path} failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

async function swarmGet(path) {
  const resp = await fetch(`${SWARM_URL}${path}`, {
    method: "GET",
    headers: headers(),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Swarm ${path} failed (${resp.status}): ${text}`);
  }
  return resp.json();
}

// ─── Core operations ────────────────────────────────────────────────

async function register() {
  return swarmPost("/swarm/register", {
    colleague_id: COLLEAGUE_ID,
    name: COLLEAGUE_NAME,
    tab_id: TAB_ID,
    parent: COLLEAGUE_PARENT || undefined,
    pid: process.pid,
  });
}

async function deregister() {
  return swarmPost("/swarm/deregister", {
    colleague_id: COLLEAGUE_ID,
  });
}

async function sendHeartbeat(status = "idle") {
  return swarmPost("/swarm/heartbeat", {
    colleague_id: COLLEAGUE_ID,
    status,
  });
}

async function getRoster() {
  const data = await swarmGet("/swarm/roster");
  const peers = data.peers || [];
  if (peers.length === 0) return "No peers currently registered in the swarm.";
  const lines = peers.map(
    (p) => `• ${p.name} (${p.id}) — ${p.status} [tab: ${p.tab_id}]`
  );
  return `Swarm roster (${peers.length} peer${peers.length !== 1 ? "s" : ""}):\n${lines.join("\n")}`;
}

async function spawnColleague(name, initialPrompt) {
  const result = await swarmPost("/swarm/spawn", {
    name,
    parent_id: COLLEAGUE_ID,
    initial_prompt: initialPrompt || undefined,
  });
  return `Spawned colleague "${name}" (${result.colleague_id}) in tab ${result.tab_id}.`;
}

async function sendMessageTo(to, body, severity = "normal") {
  const result = await swarmPost("/swarm/message", {
    from: COLLEAGUE_ID,
    to,
    body,
    severity,
  });
  return `Message sent (id: ${result.id}).`;
}

async function focusColleague(targetId) {
  const data = await swarmGet("/swarm/roster");
  const peer = (data.peers || []).find((p) => p.id === targetId);
  if (!peer) return `Colleague ${targetId} not found in roster.`;
  await swarmPost("/swarm/focus", { tab_id: peer.tab_id });
  return `Focused tab for ${peer.name} (${targetId}).`;
}

// ─── Heartbeat timer ────────────────────────────────────────────────
let heartbeatTimer = null;

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    sendHeartbeat("idle").catch(() => {
      // Swarm may have stopped; silently ignore
    });
  }, HEARTBEAT_INTERVAL_MS);
  // Don't block Node from exiting
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ─── No-op guard ────────────────────────────────────────────────────
if (!ENABLED) {
  // Not in a swarm session — register with empty tools/hooks
  // so the extension loads cleanly but does nothing.
  joinSession({ tools: [], hooks: {} });
} else {
  // ── Active swarm mode ───────────────────────────────────────────

  const session = joinSession({
    tools: [
      {
        name: "swarm_roster",
        description:
          "List all colleague agents currently registered in the putz swarm. Shows name, ID, status (idle/working/stale), and tab ID for each peer.",
        parameters: { type: "object", properties: {} },
        handler: async () => {
          try {
            const result = await getRoster();
            return result;
          } catch (err) {
            return { textResultForLlm: `Error: ${err.message}`, resultType: "failure" };
          }
        },
      },
      {
        name: "swarm_spawn",
        description:
          "Spawn a new colleague agent in a separate putz tab. The new agent will self-register with the swarm broker and can optionally receive an initial prompt.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Short name for the new colleague (e.g. 'security-scanner', 'test-writer').",
            },
            initial_prompt: {
              type: "string",
              description: "Optional initial task/prompt to send to the new colleague on startup.",
            },
          },
          required: ["name"],
        },
        handler: async (args) => {
          try {
            const result = await spawnColleague(args.name, args.initial_prompt);
            return result;
          } catch (err) {
            return { textResultForLlm: `Error: ${err.message}`, resultType: "failure" };
          }
        },
      },
      {
        name: "swarm_send_message",
        description:
          "Send a message to another colleague agent in the swarm. Messages are delivered via SSE or buffered if the recipient is not currently connected.",
        parameters: {
          type: "object",
          properties: {
            to: {
              type: "string",
              description: "The colleague_id of the recipient (e.g. 'bob-cd34').",
            },
            body: {
              type: "string",
              description: "The message content to send.",
            },
            severity: {
              type: "string",
              enum: ["urgent", "normal", "ambient"],
              description: "Message priority. Defaults to 'normal'.",
            },
          },
          required: ["to", "body"],
        },
        handler: async (args) => {
          try {
            const result = await sendMessageTo(args.to, args.body, args.severity);
            return result;
          } catch (err) {
            return { textResultForLlm: `Error: ${err.message}`, resultType: "failure" };
          }
        },
      },
      {
        name: "swarm_focus",
        description:
          "Focus the putz tab of a specific colleague agent (bring their terminal to the foreground).",
        parameters: {
          type: "object",
          properties: {
            colleague_id: {
              type: "string",
              description: "The colleague_id whose tab to focus.",
            },
          },
          required: ["colleague_id"],
        },
        handler: async (args) => {
          try {
            const result = await focusColleague(args.colleague_id);
            return result;
          } catch (err) {
            return { textResultForLlm: `Error: ${err.message}`, resultType: "failure" };
          }
        },
      },
    ],

    hooks: {
      onSessionStart: async () => {
        try {
          await register();
          startHeartbeat();
          session.log(`[swarm] Registered as ${COLLEAGUE_NAME} (${COLLEAGUE_ID})`, { level: "info", ephemeral: true });

          // Fire initial prompt if set (from env var injected by parent spawn)
          if (INITIAL_PROMPT) {
            setTimeout(() => {
              session.send({ prompt: INITIAL_PROMPT });
            }, 0);
          }
        } catch (err) {
          session.log(`[swarm] Registration failed: ${err.message}`, { level: "warning", ephemeral: true });
        }
      },

      onSessionEnd: async () => {
        stopHeartbeat();
        try {
          await deregister();
        } catch {
          // Best-effort deregister; swarm will sweep stale entries
        }
      },

      onUserPromptSubmitted: async () => {
        // Update heartbeat to "working" when user sends a prompt
        try {
          await sendHeartbeat("working");
        } catch {
          // Non-critical
        }
      },
    },
  });
}
