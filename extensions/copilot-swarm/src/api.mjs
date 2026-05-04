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
 *   Send a `notify` frame.
 *   @privacy Tier-2 PII; do not log `message`.
 * @property {(to: string, payload: unknown) => void} sendTo
 *   Direct-message another colleague.
 *   @privacy Tier-2 PII; do not log `payload`.
 * @property {() => Array<object>} listPeers
 * @property {(handler: (msg: {from: string, payload: unknown}) => void) => () => void} onMessage
 *   Subscribe to incoming `recv_from` frames.
 *   @privacy Tier-2 PII; do not log `msg.payload`.
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
    /**
     * @param {string} message - @privacy Tier-2 PII; do not log.
     * @param {"urgent"|"normal"|"ambient"} [severity]
     */
    notify(message, severity) {
      registry.notify(message, severity);
    },
    /**
     * @param {string} targetId
     * @param {unknown} payload - @privacy Tier-2 PII; do not log.
     */
    sendTo(targetId, payload) {
      registry.sendTo(targetId, payload);
    },
    listPeers() {
      return registry.roster;
    },
    /**
     * Subscribe to inbound messages.
     * @privacy The `payload` delivered to `handler` is Tier-2 PII; do not log it.
     */
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
