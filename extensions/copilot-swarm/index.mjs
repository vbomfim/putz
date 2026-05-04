#!/usr/bin/env node
/**
 * Putz colleague entry point.
 *
 * Auto-detects whether we're running inside a Putz tab by reading the
 * `PUTZ_SWARM_PATH` and `PUTZ_TAB_ID` env vars (FR-020). If absent, exits
 * silently with code 0 — running outside Putz is NOT an error (AC2 from
 * ticket #141; spec FR-002).
 *
 * If present, opens the swarm socket, registers, and keeps the process
 * alive until the parent closes the pipe (SIGTERM/SIGINT triggers a
 * graceful `disconnect`).
 *
 * @privacy The only thing we ever log is non-sensitive metadata
 * (colleague_id, byte counts). Frame payloads / notify messages are
 * Tier-2 PII per spec PRI-002 — they MUST NOT appear in stderr.
 *
 * @module index
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
  // Match the Rust convention: `<name>-<short-uuid>`.
  return `${name}-${randomUUID().slice(0, 8)}`;
}

/**
 * Boot the colleague. Exported for tests; called from CLI when run
 * directly. Returns the ColleagueApi (or null if not under Putz).
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

  // Privacy: only log metadata, never frame contents.
  registry.on("registered", ({ colleagueId: id, roster }) => {
    process.stderr.write(
      `[putz-colleague] registered id=${id} peers=${roster.length}\n`,
    );
  });
  registry.on("error", (err) => {
    // Log error code/name only; not the message (could include path).
    process.stderr.write(
      `[putz-colleague] error name=${err && err.name} code=${err && err.code || "n/a"}\n`,
    );
  });
  registry.on("disconnect", () => {
    process.stderr.write(`[putz-colleague] coordinator disconnected\n`);
  });
  registry.on("closed", () => {
    process.stderr.write(`[putz-colleague] socket closed\n`);
  });

  registry.start();

  // Cancellation: SIGTERM / SIGINT → graceful shutdown.
  const shutdown = (signal) => {
    process.stderr.write(`[putz-colleague] ${signal} received, shutting down\n`);
    registry.shutdown(signal).finally(() => process.exit(EXIT_OK));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return createColleagueApi(registry, { colleagueId: cid, tabId: ctx.tabId });
}

// Run only when invoked as a script (not when imported by tests).
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}` ||
      import.meta.url.endsWith(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  boot().then((api) => {
    if (!api) {
      // Not under Putz — silent exit per AC2.
      process.exit(EXIT_OK);
    }
    // Keep process alive; the registry holds the socket.
    // (Heartbeat interval is unref'd, so we explicitly resume stdin.)
    process.stdin.resume();
  }).catch((err) => {
    process.stderr.write(
      `[putz-colleague] boot failed name=${err && err.name}\n`,
    );
    process.exit(EXIT_OK); // never crash the user's shell
  });
}

// Surface helpers for tests / advanced consumers.
export { readPutzEnv, colleagueId };
export { ClientRegistry } from "./src/registry.mjs";
export { createColleagueApi } from "./src/api.mjs";
// Suppress unused-import warnings on `os` for environments that lint imports.
void os;
