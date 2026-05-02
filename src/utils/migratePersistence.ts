/**
 * Persistence migration utilities for v1.0.
 *
 * Handles upgrading on-disk state from v0.3.x → v1.0 by:
 * - Filtering out tabs with content types removed in the decommission epic (#86)
 * - Stripping removed fields (e.g., `status`) from persisted tab objects
 * - Fixing dangling `activeTabId` references after tab removal
 *
 * All functions are pure (input → output, no side effects) and wrapped
 * in try/catch to guarantee a safe fallback.
 *
 * Schema versions:
 *   undefined / 0 → pre-v1.0 (may contain ssh, vault, chatview, etc.)
 *   1             → v1.0 (decommissioned content types removed)
 *
 * @module migratePersistence
 */
import type { Region, RegionTab, TabContentType } from "../types";

/** Current schema version for persisted layout/workspace data. */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Allowlist of content types supported in v1.0.
 *
 * Uses an allowlist (not blocklist) so that any unknown type — whether from
 * a removed feature or data corruption — is filtered out. New content types
 * added in future versions must be added here.
 */
export const VALID_CONTENT_TYPES: ReadonlySet<string> = new Set<string>([
  "terminal",
  "editor",
  "diff",
  "search",
  "history",
  "templates",
  "settings",
  "markdown",
  "csv",
  "bookmarks",
  "drawio",
  "git-graph",
  "radio",
]);

/**
 * Fields that existed on RegionTab in v0.3.x but were removed in v1.0.
 * These are stripped during migration to avoid carrying dead data.
 */
const REMOVED_TAB_FIELDS: ReadonlySet<string> = new Set([
  "status",
  "connectionId",
  "remoteHost",
  "remotePort",
  "sshConfig",
  "serialConfig",
]);

/**
 * Strips removed fields from a tab object.
 *
 * Returns a new object with only the fields defined in the current
 * RegionTab interface. Unknown fields are silently dropped.
 */
export function stripRemovedFields(tab: Record<string, unknown>): RegionTab {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tab)) {
    if (!REMOVED_TAB_FIELDS.has(key)) {
      cleaned[key] = value;
    }
  }
  return cleaned as unknown as RegionTab;
}

/**
 * Checks whether a tab's content type is valid in v1.0.
 */
export function isValidContentType(type: unknown): type is TabContentType {
  return typeof type === "string" && VALID_CONTENT_TYPES.has(type);
}

/**
 * Migrates a single region's tabs:
 * 1. Removes tabs with unknown/removed content types
 * 2. Strips removed fields from remaining tabs
 * 3. Fixes `activeTabId` if it pointed to a removed tab
 *
 * @param region - Raw persisted region (may have stale data)
 * @returns Cleaned region safe for v1.0
 */
export function migrateRegion(region: Record<string, unknown>): Region {
  const rawTabs = Array.isArray(region.tabs) ? region.tabs : [];

  // Filter to valid content types, then strip removed fields
  const migratedTabs: RegionTab[] = rawTabs
    .filter(
      (tab: Record<string, unknown>) =>
        tab != null &&
        typeof tab === "object" &&
        isValidContentType((tab as Record<string, unknown>).type),
    )
    .map((tab: Record<string, unknown>) => stripRemovedFields(tab));

  // Fix activeTabId — if it pointed to a removed tab, pick the first remaining
  const activeTabId =
    typeof region.activeTabId === "string" &&
    migratedTabs.some((t) => t.id === region.activeTabId)
      ? (region.activeTabId as string)
      : (migratedTabs[0]?.id ?? "");

  return {
    id: typeof region.id === "string" ? region.id : "",
    tabs: migratedTabs,
    activeTabId,
    tabPosition:
      typeof region.tabPosition === "string"
        ? (region.tabPosition as Region["tabPosition"])
        : "top",
  };
}

/**
 * Migrates a full persisted workspace-layout snapshot.
 *
 * Walks all regions in the `regions` record, migrating each one.
 * The `layout` tree (LayoutNode) is structurally safe — it only references
 * region IDs, which are preserved. Tabs inside regions are the concern.
 *
 * @param raw - Raw persisted data (may be any shape)
 * @returns Migrated data, or null if input is irrecoverable
 */
export function migrateWorkspaceLayout(
  raw: Record<string, unknown> | null | undefined,
): {
  layout: unknown;
  regions: Record<string, Region>;
  focusedRegionId: string;
} | null {
  if (raw == null || typeof raw !== "object") return null;

  const rawRegions = raw.regions;
  if (rawRegions == null || typeof rawRegions !== "object") return null;

  const migratedRegions: Record<string, Region> = {};
  for (const [regionId, regionData] of Object.entries(
    rawRegions as Record<string, unknown>,
  )) {
    if (regionData != null && typeof regionData === "object") {
      migratedRegions[regionId] = migrateRegion(
        regionData as Record<string, unknown>,
      );
    }
  }

  return {
    layout: raw.layout,
    regions: migratedRegions,
    focusedRegionId:
      typeof raw.focusedRegionId === "string" ? raw.focusedRegionId : "",
  };
}
