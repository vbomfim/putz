/**
 * Putz Colleague — Copilot CLI SDK extension entry.
 *
 * Copilot CLI's extension host loads this file as a forked subprocess
 * when starting a session. We hand control to `joinSession`, which
 * owns the process lifetime via stdio IPC with the host. Inside the
 * `onSessionStart` hook we conditionally boot the Putz swarm registry
 * (only if `PUTZ_SWARM_PATH` + `PUTZ_TAB_ID` env vars are present —
 * meaning the session is running inside a Putz tab). Otherwise we
 * stay attached to the Copilot session as a no-op observer; the user
 * sees no error and `gh copilot` is unaffected.
 *
 * @privacy `onPostToolUse` forwards only the tool NAME as an ambient
 * notify to peers. Tool args, results, and any user content stay in
 * the Copilot session — never sent over the swarm wire.
 *
 * @module extension
 */
import { joinSession } from "@github/copilot-sdk/extension";
import { boot } from "./src/boot.mjs";

let api = null;

const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      api = await boot().catch((err) => {
        process.stderr.write(
          `[putz-colleague] boot failed name=${err && err.name}\n`,
        );
        return null;
      });
      if (api) {
        api.notify("copilot session started", "ambient");
      }
      return {};
    },

    // Forward only the tool NAME — never args/output (Tier-2 PII per PRI-002).
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
