/**
 * Putz swarm boot — pure of any Copilot SDK dependency. The Copilot
 * SDK extension entry (../extension.mjs) calls boot() inside its
 * onSessionStart hook; tests and standalone callers can import this
 * module directly without bootstrapping a live Copilot session.
 *
 * @privacy The only thing we ever log is non-sensitive metadata
 * (colleague_id, byte counts). Frame payloads / notify messages are
 * Tier-2 PII per spec PRI-002 — they MUST NOT appear in stderr.
 *
 * @module src/boot
 */
import process from "node:process";
import { randomUUID } from "node:crypto";
import { ClientRegistry } from "./registry.mjs";
import { createColleagueApi } from "./api.mjs";

/** Read PUTZ_* env. Returns null if not running under Putz. */
export function readPutzEnv(env = process.env) {
  const path = env.PUTZ_SWARM_PATH;
  const tabId = env.PUTZ_TAB_ID;
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof tabId !== "string" || tabId.length === 0) return null;
  return { path, tabId };
}

/** Generate a stable colleague_id for this process. */
export function colleagueId(name = "copilot") {
  return `${name}-${process.pid}-${randomUUID().slice(0, 12)}`;
}

/**
 * Boot the swarm-side registry. Returns the ColleagueApi (or null if
 * not under Putz — missing PUTZ_SWARM_PATH or PUTZ_TAB_ID).
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
    registry.shutdown(signal).finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  return createColleagueApi(registry, { colleagueId: cid, tabId: ctx.tabId });
}

export { ClientRegistry };
export { createColleagueApi };
