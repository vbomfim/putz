/**
 * Public API — what user code (e.g. the agent's hook layer) calls.
 *
 * This is the seam an alternative implementation could mock. Keep it
 * narrow and stable.
 *
 * @module api
 */

/**
 * @typedef {object} ColleagueApi
 * @property {(message: string, severity?: 'urgent'|'normal'|'ambient') => void} notify
 * @property {(to: string, payload: unknown) => void} sendTo
 * @property {() => Array<object>} listPeers
 * @property {(handler: (msg: {from: string, payload: unknown}) => void) => () => void} onMessage
 * @property {(reason?: string) => Promise<void>} shutdown
 * @property {string} colleagueId
 * @property {string} tabId
 */

/**
 * Build a {@link ColleagueApi} backed by a {@link import('./registry.mjs').ClientRegistry}.
 *
 * @param {import('./registry.mjs').ClientRegistry} registry
 * @param {{ colleagueId: string, tabId: string }} ids
 * @returns {ColleagueApi}
 */
export function createColleagueApi(registry, ids) {
  return Object.freeze({
    colleagueId: ids.colleagueId,
    tabId: ids.tabId,
    notify(message, severity) {
      registry.notify(message, severity);
    },
    sendTo(to, payload) {
      registry.sendTo(to, payload);
    },
    listPeers() {
      return registry.roster;
    },
    onMessage(handler) {
      if (typeof handler !== "function") {
        throw new TypeError("onMessage: handler must be a function");
      }
      registry.on("recv", handler);
      return () => registry.off("recv", handler);
    },
    async shutdown(reason) {
      await registry.shutdown(reason);
    },
  });
}
