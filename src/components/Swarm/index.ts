/**
 * Public surface for the `Swarm` UI components (T4).
 *
 * Re-exports the small visual atoms (badge / dots / heartbeat),
 * the colleague row, the sidebar, the per-tab notification ring,
 * and the two modals (inbox + spawn palette).
 *
 * @module components/Swarm
 */
export { StatusBadge } from "./StatusBadge";
export { ExitCodeDots } from "./ExitCodeDots";
export { HeartbeatIndicator } from "./HeartbeatIndicator";
export { ColleagueRow } from "./ColleagueRow";
export { SwarmSidebar } from "./SwarmSidebar";
export type { SidebarPosition } from "./SwarmSidebar";
export { TabNotificationRing } from "./TabNotificationRing";
export { InboxPanel } from "./InboxPanel";
export { SpawnPalette } from "./SpawnPalette";
// F5: pure formatters re-exported from the canonical lib so
// downstream consumers don't have to know they moved.
export { truncateCwd, formatRelativeTime } from "../../lib/swarm/formatters";
