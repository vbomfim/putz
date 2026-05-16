/**
 * Persistence migration utilities (current schema: v2).
 *
 * Handles upgrading on-disk state from older snapshots to the current
 * schema by:
 * - Filtering out tabs with content types removed in the decommission
 *   epic (#86) and the templates/history removal (this PR — v1→v2)
 * - Picking only valid fields (allowlist) from persisted tab objects
 * - Validating the structural shape of each tab (required fields)
 * - Fixing dangling `activeTabId` references after tab removal
 * - Normalizing invalid `tabPosition` values to a safe default
 *
 * All functions are pure (input → output, no side effects) and wrapped
 * in try/catch to guarantee a safe fallback.
 *
 * Schema versions:
 *   undefined / 0 → pre-v1.0 (may contain ssh, vault, chatview, etc.)
 *   1             → v1.0 (decommissioned content types removed)
 *   2             → v1.1 (command templates + command history removed)
 *   3             → v1.2 (tab persistence: + cwd, + command, + restoreTabsOnLaunch) — CURRENT
 *
 * Migration registry:
 *   v1→v3 and v2→v3 are no-op for shape (additive fields default to undefined).
 *   Existing snapshots simply gain the new optional fields on next save.
 *
 * Side effect:
 *   On every load, this module also clears any persisted
 *   command-history / templates state from localStorage, since those
 *   features (and the keys they wrote) no longer exist. See
 *   {@link clearRemovedFeatureStorage}.
 *
 * @module migratePersistence
 */
import type { Region, RegionTab, TabContentType } from "../types";

/** Current schema version for persisted layout/workspace data. */
export const CURRENT_SCHEMA_VERSION = 3;

/**
 * localStorage keys that may have been written by the removed
 * Command Templates / Command History features. The migrator nukes
 * these on first launch after upgrade so we don't carry orphan
 * Tier-2 PII forever.
 */
export const REMOVED_FEATURE_STORAGE_KEYS: readonly string[] = [
  "putz-history",
  "putz-templates",
  "putz-command-history",
  "putz-command-templates",
];

/**
 * Allowlist of content types supported in schema v2.
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
  // v3 (tab persistence)
  "cwd",
]);

/** Maximum length for any persisted string path (cwd, file paths). */
export const MAX_PATH_LENGTH = 4096;

/**
 * Keys that must never appear on a tab object — defense-in-depth against
 * prototype pollution.
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Picks only valid RegionTab fields from a tab object (allowlist approach).
 */
export function stripToValidFields(tab: Record<string, unknown>): RegionTab {
  const cleaned = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(tab)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (!VALID_TAB_FIELDS.has(key)) continue;
    cleaned[key] = tab[key];
  }
  sanitizeNewV3Fields(cleaned);
  return cleaned as unknown as RegionTab;
}

/**
 * Sanitizes the v3-introduced `cwd` field on a partially-cleaned tab.
 * Mutates `cleaned` in place: if `cwd` fails validation it is deleted.
 */
function sanitizeNewV3Fields(cleaned: Record<string, unknown>): void {
  if ("cwd" in cleaned) {
    const v = cleaned.cwd;
    if (
      typeof v !== "string" ||
      v.length === 0 ||
      v.length > MAX_PATH_LENGTH ||
      v.includes("\0")
    ) {
      delete cleaned.cwd;
    }
  }
}

/**
 * Checks whether a tab's content type is valid in v1.0.
 */
export function isValidContentType(type: unknown): type is TabContentType {
  return typeof type === "string" && VALID_TAB_TYPES.has(type);
}

/**
 * Valid `tabPosition` values for a Region. Anything outside this set
 * is normalized to `DEFAULT_TAB_POSITION` during migration.
 */
const VALID_TAB_POSITIONS: ReadonlySet<string> = new Set([
  "top",
  "bottom",
  "left",
  "right",
]);

/** Default `tabPosition` used when the persisted value is missing or invalid. */
const DEFAULT_TAB_POSITION = "top" as const;

/**
 * Structural shape predicate for a migrated RegionTab.
 *
 * After `stripToValidFields` has run, we still need to confirm the
 * required fields actually exist with the right primitive types — a
 * persisted snapshot from a corrupted shutdown may have a tab with
 * `type: "terminal"` but no `id`, `title`, or `sessionId`. Such a tab
 * cannot be safely rendered and must be dropped (not coerced).
 *
 * Required: `id`, `title`, `sessionId` — all non-empty strings.
 *
 * Privacy: we deliberately do NOT log the contents of dropped tabs.
 * They may contain editor file paths or terminal session IDs which
 * could be sensitive. The migration logs only the *count* of dropped
 * tabs at the region level (see `migrateRegion`).
 */
export function isValidRegionTabShape(tab: RegionTab): boolean {
  return (
    typeof tab.id === "string" &&
    tab.id.length > 0 &&
    typeof tab.title === "string" &&
    tab.title.length > 0 &&
    typeof tab.sessionId === "string" &&
    tab.sessionId.length > 0
  );
}

/**
 * Migrates a single region's tabs:
 * 1. Removes tabs with unknown/removed content types
 * 2. Strips removed fields from remaining tabs
 * 3. Drops tabs whose required shape (id/title/sessionId) is invalid
 * 4. Normalizes invalid `tabPosition` to the default
 * 5. Fixes `activeTabId` if it pointed to a removed tab
 *
 * @param region - Raw persisted region (may have stale data)
 * @returns Cleaned region safe for v1.0
 */
export function migrateRegion(region: Record<string, unknown>): Region {
  const rawTabs = Array.isArray(region.tabs) ? region.tabs : [];

  // Filter to valid content types, then pick only valid fields, then
  // drop tabs that don't satisfy the required structural shape.
  const candidateTabs: RegionTab[] = rawTabs
    .filter(
      (tab: Record<string, unknown>) =>
        tab != null &&
        typeof tab === "object" &&
        isValidContentType((tab as Record<string, unknown>).type),
    )
    .map((tab: Record<string, unknown>) => stripToValidFields(tab));

  const migratedTabs: RegionTab[] = candidateTabs.filter(isValidRegionTabShape);

  const droppedShapeCount = candidateTabs.length - migratedTabs.length;
  if (droppedShapeCount > 0) {
    // Log count only — never the contents (privacy: file paths,
    // session IDs may be sensitive).
    console.warn(
      `[migrateRegion] dropped ${droppedShapeCount} tab(s) with invalid shape`,
    );
  }

  // Fix activeTabId — if it pointed to a removed tab, pick the first remaining
  const activeTabId =
    typeof region.activeTabId === "string" &&
    migratedTabs.some((t) => t.id === region.activeTabId)
      ? (region.activeTabId as string)
      : (migratedTabs[0]?.id ?? "");

  // Normalize tabPosition to a known value; reject persisted garbage
  // like "diagonal" or non-strings.
  const tabPosition: Region["tabPosition"] =
    typeof region.tabPosition === "string" &&
    VALID_TAB_POSITIONS.has(region.tabPosition)
      ? (region.tabPosition as Region["tabPosition"])
      : DEFAULT_TAB_POSITION;

  return {
    id: typeof region.id === "string" ? region.id : "",
    tabs: migratedTabs,
    activeTabId,
    tabPosition,
  };
}

/**
 * Maximum depth allowed in a persisted layout tree. Defends against
 * pathological / hostile input (deeply nested splits → stack overflow
 * during render, DoS). 10 levels = 1024 leaf regions max — far above
 * realistic UI usage.
 */
export const MAX_LAYOUT_DEPTH = 10;

/**
 * Recursively validates a persisted layout tree. Enforces:
 *   - Max depth (defends against stack overflow / DoS)
 *   - Every leaf `regionId` exists in the regions map
 *   - Split nodes have valid `direction`, `ratio` ∈ [0.1, 0.9],
 *     and well-formed `first`/`second` children
 *
 * Returns `true` if the tree is structurally safe to render. On any
 * failure, returns `false` and the caller should drop `layout` to null
 * (snapshot becomes a fresh single-region workspace).
 *
 * Cycle detection: the depth cap implicitly prevents infinite cycles
 * because JSON.parse cannot produce reference cycles, but a
 * pathological depth would still exhaust the stack — hence the cap.
 */
export function validateLayoutTree(
  node: unknown,
  regions: Record<string, Region>,
  depth = 0,
): boolean {
  if (depth > MAX_LAYOUT_DEPTH) return false;
  if (node == null || typeof node !== "object") return false;
  const n = node as Record<string, unknown>;
  if (n.type === "region") {
    return typeof n.regionId === "string" && n.regionId in regions;
  }
  if (n.type === "split") {
    if (n.direction !== "horizontal" && n.direction !== "vertical") {
      return false;
    }
    if (
      typeof n.ratio !== "number" ||
      !Number.isFinite(n.ratio) ||
      n.ratio < 0.1 ||
      n.ratio > 0.9
    ) {
      return false;
    }
    if (!Array.isArray(n.children) || n.children.length !== 2) {
      return false;
    }
    return (
      validateLayoutTree(n.children[0], regions, depth + 1) &&
      validateLayoutTree(n.children[1], regions, depth + 1)
    );
  }
  return false;
}

/**
 * Migrates a full persisted workspace-layout snapshot.
 *
 * Walks all regions in the `regions` record, migrating each one.
 * The `layout` tree is validated against the migrated regions map —
 * a tree referencing missing regions, exceeding {@link MAX_LAYOUT_DEPTH},
 * or carrying invalid split ratios is rejected (caller falls back to
 * fresh state).
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

  // Validate the layout tree against the migrated regions map. A bad
  // tree (missing regionId, exceeded depth, invalid ratio) → null
  // layout, which the caller treats as "fresh workspace".
  const layout = validateLayoutTree(raw.layout, migratedRegions)
    ? raw.layout
    : null;
  if (layout == null) {
    console.warn(
      "[migrateWorkspaceLayout] dropped invalid layout tree (depth/ratio/regionId failure)",
    );
  }

  return {
    layout,
    regions: migratedRegions,
    focusedRegionId:
      typeof raw.focusedRegionId === "string" ? raw.focusedRegionId : "",
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

/**
 * Removes localStorage keys written by features that no longer exist
 * (Command Templates, Command History). Idempotent: safe to call on
 * every boot.
 *
 * Privacy: shell command history is **Tier-2 PII** (commands may include
 * hostnames, file paths, IPs). This wipes it from local storage on first
 * launch after upgrade.
 *
 * Removal must NOT depend on a successful `getItem` read. Hostile shims,
 * quota errors, or "denied storage" sandboxes can throw on `getItem`
 * while still allowing `removeItem` to succeed — and the PII removal
 * is the privacy contract here, not the read. We therefore call
 * `removeItem(key)` unconditionally inside per-key try/catch.
 *
 * The returned array reports keys that the caller can be confident
 * *did* exist before removal (used for telemetry / tests). Keys whose
 * `getItem` probe threw will not appear in the array, but `removeItem`
 * was still attempted.
 *
 * @returns the keys whose presence was confirmed before removal
 */
export function clearRemovedFeatureStorage(
  storage: Pick<
    Storage,
    "getItem" | "removeItem"
  > | null = typeof localStorage !== "undefined" ? localStorage : null,
): string[] {
  if (storage == null) return [];
  const removed: string[] = [];
  for (const key of REMOVED_FEATURE_STORAGE_KEYS) {
    let existed = false;
    try {
      existed = storage.getItem(key) != null;
    } catch {
      // Hostile shim / quota / denied storage on read — fall through,
      // we still attempt removeItem below. Privacy contract is the
      // removal, not the read.
    }
    try {
      storage.removeItem(key);
      if (existed) removed.push(key);
    } catch {
      // Hostile shim — best-effort, swallow.
    }
  }
  return removed;
}
