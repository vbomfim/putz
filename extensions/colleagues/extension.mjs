/**
 * Colleagues — Copilot CLI extension for putz swarm.
 *
 * Enables Copilot CLI agents running in putz terminal tabs to be
 * mutually aware of each other via the putz swarm HTTP broker.
 *
 * Capabilities:
 * - Self-registers on session start, deregisters on end
 * - Heartbeat loop (15s interval) to keep alive in the broker
 * - Tools: swarm_roster, swarm_spawn, swarm_send_message, swarm_focus
 * - Auto-fires initial prompt if COPILOT_COLLEAGUE_INITIAL_PROMPT is set
 * - Injects roster context on each user prompt (H4)
 *
 * No-op when PUTZ_SWARM_URL is not set (non-swarm terminals).
 *
 * Security: Bearer token is never logged. All requests go to localhost only.
 *
 * @see https://github.com/vbomfim/putz — Phase 2 swarm spec
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { createCore, HEARTBEAT_INTERVAL_MS } from "./core.mjs";

// ─── Build core from process.env ────────────────────────────────────
const core = createCore(process.env);

// M2: Delete INITIAL_PROMPT from env after reading so it fires only once
if (process.env.COPILOT_COLLEAGUE_INITIAL_PROMPT) {
  delete process.env.COPILOT_COLLEAGUE_INITIAL_PROMPT;
}

// ─── Heartbeat timer ────────────────────────────────────────────────
let heartbeatTimer = null;

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    core.sendHeartbeat(fetch, "idle").catch(() => {
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
if (!core.isEnabled()) {
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
            return await core.getRoster(fetch);
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
            return await core.spawnColleague(fetch, args.name, args.initial_prompt);
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
            return await core.sendMessage(fetch, args.to, args.body, args.severity);
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
            return await core.focusColleague(fetch, args.colleague_id);
          } catch (err) {
            return { textResultForLlm: `Error: ${err.message}`, resultType: "failure" };
          }
        },
      },
    ],

    hooks: {
      onSessionStart: async () => {
        try {
          await core.register(fetch);
          startHeartbeat();
          session.log(`[swarm] Registered as ${core.getConfig().colleagueName} (${core.getConfig().colleagueId})`, { level: "info", ephemeral: true });

          // Fire initial prompt if set (from env var injected by parent spawn)
          const prompt = core.getInitialPrompt();
          if (prompt) {
            setTimeout(() => {
              session.send({ prompt });
            }, 0);
          }
        } catch (err) {
          // L2: Sanitize registration error — don't leak broker internals
          const safeMsg = err.message.length > 200 ? err.message.slice(0, 200) + "…" : err.message;
          session.log(`[swarm] Registration failed: ${safeMsg}`, { level: "warning", ephemeral: true });
        }
      },

      onSessionEnd: async () => {
        stopHeartbeat();
        try {
          await core.deregister(fetch);
        } catch {
          // Best-effort deregister; swarm will sweep stale entries
        }
      },

      onUserPromptSubmitted: async () => {
        // Update heartbeat to "working" when user sends a prompt
        try {
          await core.sendHeartbeat(fetch, "working");
        } catch {
          // Non-critical
        }

        // H4: Inject roster context so the LLM knows about active peers
        try {
          const context = await core.getRosterContext(fetch);
          if (context) {
            return { additionalContext: context };
          }
        } catch {
          // Non-critical — swarm awareness is best-effort
        }
      },
    },
  });
}

