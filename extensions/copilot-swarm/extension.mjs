#!/usr/bin/env node
/**
 * Putz Colleague Extension — Copilot CLI ↔ Putz swarm bridge.
 *
 * Runs in two modes:
 *
 *   1. **Copilot SDK extension** (auto-loaded by `gh copilot` when this
 *      directory lives at `~/.copilot/extensions/putz-colleague/`).
 *      `joinSession` from `@github/copilot-sdk/extension` provides
 *      lifecycle hooks. On `onSessionStart` we boot the swarm registry
 *      and announce ourselves to peers; on tool use we emit ambient
 *      notifies; on session.idle we announce idle.
 *
 *   2. **Standalone Node script** (legacy / manual run). `node
 *      extension.mjs` from inside a Putz tab — same behavior, no SDK.
 *      Used by tests and as a fallback when the SDK isn't available.
 *
 * Detection: we try the SDK path first; if the SDK module isn't
 * resolvable OR `joinSession` rejects (no live Copilot session), we
 * fall through to standalone boot. In both cases, missing `PUTZ_*` env
 * vars → silent exit 0 (running outside Putz is not an error).
 *
 * @privacy The only thing we ever log is non-sensitive metadata
 * (colleague_id, byte counts, tool NAMES — never tool args/outputs).
 * Frame payloads / notify messages are Tier-2 PII per spec PRI-002.
 *
 * @module extension
 */
import process from "node:process";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { ClientRegistry } from "./src/registry.mjs";
import { createColleagueApi } from "./src/api.mjs";

const EXIT_OK = 0;

/** Read PUTZ_* env. Returns null if not running under Putz. */
function readPutzEnv(env = process.env) {
  const path = env.PUTZ_SWARM_PATH;
  const tabId = env.PUTZ_TAB_ID;
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof tabId !== "string" || tabId.length === 0) return null;
  return { path, tabId };
}

/** Generate a stable colleague_id for this process. */
function colleagueId(name = "copilot") {
  return `${name}-${process.pid}-${randomUUID().slice(0, 12)}`;
}

/**
 * Boot the swarm-side registry. Returns the ColleagueApi (or null if
 * not under Putz). Pure of any Copilot-SDK dependency so the test
 * suite and standalone fallback can call it directly.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<ReturnType<typeof createColleagueApi> | null>}
 */
export async function boot(env = process.env) {
  const ctx = readPutzEnv(env);
  if (!ctx) return null;

  const name = env.PUTZ_COLLEAGUE_NAME || "copilot";
  const cid = colleagueId(name);
  const parent = env.PUTZ_PARENT_COLLEAGUE_ID || "self";

  const registry = new ClientRegistry({
    path: ctx.path,
    tabId: ctx.tabId,
    colleagueId: cid,
    name,
    parent,
    pid: process.pid,
  });

  let lastErrorCode = null;
  registry.on("registered", ({ colleagueId: id, roster }) => {
    process.stderr.write(
      `[putz-colleague] registered id=${id} peers=${roster.length}\n`,
    );
    lastErrorCode = null;
  });
  registry.on("error", (err) => {
    const code = (err && err.code) || (err && err.name) || "n/a";
    if (code === lastErrorCode) return;
    lastErrorCode = code;
    process.stderr.write(
      `[putz-colleague] error name=${err && err.name} code=${code}\n`,
    );
  });
  registry.on("disconnect", () => {
    process.stderr.write(`[putz-colleague] coordinator disconnected\n`);
  });
  registry.on("closed", () => {
    process.stderr.write(`[putz-colleague] socket closed\n`);
  });

  registry.start();

  const shutdown = (signal) => {
    process.stderr.write(`[putz-colleague] ${signal} received, shutting down\n`);
    registry.shutdown(signal).finally(() => process.exit(EXIT_OK));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return createColleagueApi(registry, { colleagueId: cid, tabId: ctx.tabId });
}

/**
 * Try to load the Copilot SDK and join the active session. Returns
 * the SDK session handle on success, or null if the SDK isn't
 * available / there's no live session — caller should fall back to
 * standalone boot.
 *
 * Privacy: the `onPostToolUse` hook forwards only the tool NAME as an
 * ambient notify. Tool args, results, and any user content stay local
 * to the Copilot session — never sent to peers.
 */
async function tryJoinCopilotSession() {
  let sdk;
  try {
    // Dynamic import — keeps standalone mode working when the SDK is
    // not on the module path (tests, manual `node extension.mjs`).
    sdk = await import("@github/copilot-sdk/extension");
  } catch {
    return null;
  }
  if (!sdk || typeof sdk.joinSession !== "function") return null;

  let approveAll;
  try {
    const core = await import("@github/copilot-sdk");
    approveAll = core && core.approveAll;
  } catch {
    // approveAll is optional — joinSession works without it.
  }

  let api = null;
  try {
    const session = await sdk.joinSession({
      ...(approveAll ? { onPermissionRequest: approveAll } : {}),
      hooks: {
        onSessionStart: async () => {
          api = await boot();
          if (api) {
            api.notify("copilot session started", "ambient");
            await session
              .log("🐇 Putz colleague active", { ephemeral: true })
              .catch(() => undefined);
          }
          return {};
        },
        // Forward only the tool NAME — never args/output (Tier-2 PII).
        onPostToolUse: async (input) => {
          if (api && input && typeof input.tool === "string") {
            api.notify(`tool: ${input.tool}`, "ambient");
          }
          return {};
        },
      },
      tools: [],
    });

    session.on("session.idle", async () => {
      if (api) api.notify("copilot session idle", "ambient");
    });

    return session;
  } catch (err) {
    // No live Copilot session, or SDK declined to attach — fall back.
    process.stderr.write(
      `[putz-colleague] copilot SDK joinSession unavailable name=${err && err.name}\n`,
    );
    return null;
  }
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}` ||
      import.meta.url.endsWith(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  (async () => {
    // Mode 1: try Copilot SDK first. If joinSession succeeds, the SDK
    // owns the lifecycle — its hooks will boot the swarm.
    const session = await tryJoinCopilotSession();
    if (session) {
      // Keep the process alive for the SDK session.
      process.stdin.resume();
      return;
    }

    // Mode 2: standalone fallback — boot directly.
    const api = await boot().catch((err) => {
      process.stderr.write(
        `[putz-colleague] boot failed name=${err && err.name}\n`,
      );
      return null;
    });
    if (!api) {
      // Not under Putz — silent exit per AC2.
      process.exit(EXIT_OK);
    }
    process.stdin.resume();
  })();
}

export { readPutzEnv, colleagueId, tryJoinCopilotSession };
export { ClientRegistry } from "./src/registry.mjs";
export { createColleagueApi } from "./src/api.mjs";
void os;
