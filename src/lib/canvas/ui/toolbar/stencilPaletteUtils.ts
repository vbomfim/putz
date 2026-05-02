/**
 * Pure utility functions for StencilPalette search, sorting, and filtering.
 *
 * Extracted from the component to enable thorough unit testing
 * without React dependencies. All functions are stateless and side-effect free.
 *
 * @module
 */

import type { StencilMeta } from "../../engine";

// ── Constants ──────────────────────────────────────────────

/**
 * Hand-crafted categories shown first in the palette, in display order.
 * Imported/generated categories (drawio-*) appear after these, sorted alphabetically.
 */
const PRIORITY_CATEGORIES: readonly string[] = [
  "network",
  "architecture",
  "kubernetes",
  "azure",
  "azure-arm",
  "generic-it",
  "security",
];

/** Maximum stencils to render initially before showing a "Show more" button. */
export const INITIAL_RENDER_LIMIT = 50;

/** Debounce delay for search input in milliseconds. */
export const SEARCH_DEBOUNCE_MS = 200;

// ── Search / Filter ────────────────────────────────────────

/**
 * Filter stencils by a search query across all categories.
 *
 * Performs case-insensitive substring matching on the stencil label.
 * Returns results grouped by category (sorted via `sortCategories`).
 * Returns all stencils grouped by category when query is empty.
 *
 * @param allMeta - All available stencil metadata (sync, no SVG content).
 * @param query   - Search query string. Empty string returns all.
 * @returns Map of category → matching StencilMeta[], sorted by category priority.
 */
export function filterStencilsBySearch(
  allMeta: readonly StencilMeta[],
  query: string,
): Map<string, StencilMeta[]> {
  const normalizedQuery = query.trim().toLowerCase();
  const grouped = new Map<string, StencilMeta[]>();

  for (const meta of allMeta) {
    if (
      normalizedQuery &&
      !meta.label.toLowerCase().includes(normalizedQuery)
    ) {
      continue;
    }
    const list = grouped.get(meta.category) ?? [];
    list.push(meta);
    grouped.set(meta.category, list);
  }

  // Return sorted map
  const sortedCategories = sortCategories([...grouped.keys()]);
  const sorted = new Map<string, StencilMeta[]>();
  for (const cat of sortedCategories) {
    const entries = grouped.get(cat);
    if (entries) {
      sorted.set(cat, entries);
    }
  }

  return sorted;
}

// ── Category Sorting ───────────────────────────────────────

/**
 * Sort categories in logical display order.
 *
 * Priority:
 * 1. Hand-crafted categories in `PRIORITY_CATEGORIES` order.
 * 2. Remaining categories sorted alphabetically.
 *
 * Unknown categories not in the priority list appear after priority ones.
 *
 * @param categories - Array of category identifiers to sort.
 * @returns New sorted array (does not mutate input).
 */
export function sortCategories(categories: readonly string[]): string[] {
  const prioritySet = new Set(PRIORITY_CATEGORIES);

  const priority: string[] = [];
  const rest: string[] = [];

  for (const cat of categories) {
    if (prioritySet.has(cat)) {
      priority.push(cat);
    } else {
      rest.push(cat);
    }
  }

  // Sort priority categories by their defined order
  priority.sort(
    (a, b) => PRIORITY_CATEGORIES.indexOf(a) - PRIORITY_CATEGORIES.indexOf(b),
  );

  // Sort remaining categories alphabetically
  rest.sort((a, b) => a.localeCompare(b));

  return [...priority, ...rest];
}

// ── Category Counts ────────────────────────────────────────

/**
 * Compute stencil counts per category from metadata.
 *
 * @param allMeta - All available stencil metadata.
 * @returns Map of category → stencil count.
 */
export function getCategoryCounts(
  allMeta: readonly StencilMeta[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const meta of allMeta) {
    counts.set(meta.category, (counts.get(meta.category) ?? 0) + 1);
  }
  return counts;
}

// ── Display Names ──────────────────────────────────────────

/** Map from kebab-case category IDs to human-readable display names. */
const CATEGORY_DISPLAY_NAMES: Record<string, string> = {
  architecture: "Architecture",
  azure: "Azure",
  "azure-arm": "Azure ARM",
  "generic-it": "Generic IT",
  kubernetes: "Kubernetes",
  network: "Network",
  security: "Security",
};

/**
 * Returns a human-readable display name for a category slug.
 * Falls back to title-casing the slug if not found in the map.
 */
export function getCategoryDisplayName(category: string): string {
  return (
    CATEGORY_DISPLAY_NAMES[category] ??
    category
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}
