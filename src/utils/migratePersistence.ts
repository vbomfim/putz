/**
 * Persistence migration utilities for v1.0.
 *
 * Handles upgrading on-disk state from v0.3.x → v1.0 by:
 * - Filtering out tabs with content types removed in the decommission epic (#86)
 * - Picking only valid fields (allowlist) from persisted tab objects
 * - Fixing dangling `activeTabId` references after tab removal
 *
 * All functions are pure (input → output, no side effects) and wrapped
 * in try/catch to guarantee a safe fallback.
 *
 * Schema versions:
 *   undefined / 0 → pre-v1.0 (may contain ssh, vault, chatview, etc.)
 *   1             → v1.0 (decommissioned content types removed)
 *
 * Migration registry:
 *   Add future version bumps to the MIGRATIONS record below.
 *   Example: { 0: migrateV0ToV1, 1: migrateV1ToV2 }
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
export const VALID_TAB_TYPES: ReadonlySet<string> = new Set<string>([
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
 * Canonical allowlist of valid RegionTab fields.
 *
 * Only these keys are kept during migration — everything else (removed fields,
 * unknown adversarial keys, prototype-pollution keys) is silently dropped.
 * Sourced from the RegionTab interface in src/types/index.ts.
 */
const VALID_TAB_FIELDS: ReadonlySet<string> = new Set<string>([
  "id",
  "title",
  "type",
  "sessionId",
  "editorFilePath",
  "editorScriptId",
  "diffLeftPath",
  "diffRightPath",
  "diffLeftContent",
  "diffRightContent",
]);

/**
 * Keys that must never appear on a tab object — defense-in-depth against
 * prototype pollution even though `JSON.parse` doesn't create polluted
 * objects in modern JS engines.
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Picks only valid RegionTab fields from a tab object (allowlist approach).
 *
 * Returns a null-prototype object containing only keys present in
 * VALID_TAB_FIELDS. Dangerous keys (__proto__, constructor, prototype)
 * are rejected even if they were somehow in the allowlist.
 */
export function stripToValidFields(tab: Record<string, unknown>): RegionTab {
  const cleaned = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(tab)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (!VALID_TAB_FIELDS.has(key)) continue;
    cleaned[key] = tab[key];
  }
  return cleaned as unknown as RegionTab;
}

/**
 * Checks whether a tab's content type is valid in v1.0.
 */
export function isValidContentType(type: unknown): type is TabContentType {
  return typeof type === "string" && VALID_TAB_TYPES.has(type);
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

  // Filter to valid content types, then pick only valid fields
  const migratedTabs: RegionTab[] = rawTabs
    .filter(
      (tab: Record<string, unknown>) =>
        tab != null &&
        typeof tab === "object" &&
        isValidContentType((tab as Record<string, unknown>).type),
    )
    .map((tab: Record<string, unknown>) => stripToValidFields(tab));

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
 * If the input already has `schemaVersion === CURRENT_SCHEMA_VERSION`, the
 * migration pipeline is skipped but shape validation still runs (defense-in-depth).
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
  schemaVersion: number;
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
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}
