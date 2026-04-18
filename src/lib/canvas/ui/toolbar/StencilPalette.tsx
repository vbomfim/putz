/**
 * StencilPalette — browsable panel for placing SVG stencil expressions.
 *
 * Provides a scrollable panel with collapsible category sections
 * showing a grid of stencil thumbnails. Supports click-to-place
 * (at viewport center) and drag-to-place (at drop position).
 *
 * Features:
 * - Search/filter across all categories (uses sync metadata)
 * - Category count badges from metadata
 * - "Show more" pagination for large categories (>50 stencils)
 * - Priority-based category sort order
 * - Tooltip on stencil hover
 * - Debounced search input (200ms)
 *
 * Categories are listed immediately from metadata. SVGs are loaded
 * lazily when a category is expanded, with a loading indicator.
 *
 * @module
 */

import { useState, useCallback, useEffect, useMemo, memo, type DragEvent } from 'react';
import { nanoid } from 'nanoid';
import { ChevronDown, ChevronRight, Loader2, Search, X } from 'lucide-react';
import type { VisualExpression, ExpressionData } from '../../protocol';
import { DEFAULT_EXPRESSION_STYLE } from '../../protocol';
import {
  getCategoryStencils,
  getAllStencilMeta,
  svgToDataUri,
} from '../../engine';
import type { StencilEntry } from '../../engine';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import {
  filterStencilsBySearch,
  sortCategories,
  getCategoryCounts,
  getCategoryDisplayName,
  INITIAL_RENDER_LIMIT,
  SEARCH_DEBOUNCE_MS,
} from './stencilPaletteUtils';

// ── Constants ──────────────────────────────────────────────

/** Panel width in pixels. */
const PANEL_WIDTH = 240;

/** Size of each stencil thumbnail in pixels. */
const THUMBNAIL_SIZE = 48;

/** Number of columns in the stencil grid. */
const GRID_COLUMNS = 3;

// ── Props ──────────────────────────────────────────────────

/** Props for StencilPalette. */
export interface StencilPaletteProps {
  /** Callback when a stencil expression is created. */
  onInsert: (expression: VisualExpression) => void;
  /** Whether the panel is visible. */
  isOpen: boolean;
}

// ── Expression factory ─────────────────────────────────────

/**
 * Creates a VisualExpression from a stencil catalog entry.
 *
 * Places at (0, 0) — the caller (App.tsx) handles viewport centering.
 * Uses the stencil's defaultSize from the catalog.
 */
function createStencilExpression(entry: StencilEntry): VisualExpression {
  const data: ExpressionData = {
    kind: 'stencil' as const,
    stencilId: entry.id,
    category: entry.category,
    label: entry.label,
  };

  return {
    id: nanoid(),
    kind: 'stencil',
    position: { x: 0, y: 0 },
    size: { ...entry.defaultSize },
    angle: 0,
    style: { ...DEFAULT_EXPRESSION_STYLE, fontSize: 10 },
    meta: {
      author: { type: 'human', id: 'local-user', name: 'User' },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      locked: false,
    },
    data,
  };
}

// ── Component ──────────────────────────────────────────────

/**
 * StencilPalette — scrollable panel with search, collapsible categories,
 * count badges, and "show more" pagination.
 *
 * Each category shows a grid of stencil thumbnails with labels.
 * Clicking a stencil calls onInsert with a new VisualExpression.
 * Dragging a stencil sets transfer data for canvas drop handling.
 *
 * Categories are listed immediately from sync metadata. SVGs load
 * lazily when a category is expanded or matched by search.
 */
export function StencilPalette({ onInsert, isOpen }: StencilPaletteProps) {
  const [searchInput, setSearchInput] = useState('');
  const debouncedQuery = useDebouncedValue(searchInput, SEARCH_DEBOUNCE_MS);
  const isSearching = debouncedQuery.trim().length > 0;

  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [loadedStencils, setLoadedStencils] = useState<Map<string, StencilEntry[]>>(
    new Map(),
  );
  const [loadingCategories, setLoadingCategories] = useState<Set<string>>(
    new Set(),
  );
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );

  // Stable reference to all metadata (sync — no SVG content)
  const allMeta = useMemo(() => getAllStencilMeta(), []);

  // Compute category counts from metadata (stable across renders)
  const categoryCounts = useMemo(() => getCategoryCounts(allMeta), [allMeta]);

  // Sorted categories from metadata
  const sortedCategories = useMemo(
    () => sortCategories([...categoryCounts.keys()]),
    [categoryCounts],
  );

  // Filter metadata by search query (operates on sync metadata — instant)
  const filteredByCategory = useMemo(
    () => filterStencilsBySearch(allMeta, debouncedQuery),
    [allMeta, debouncedQuery],
  );

  // Determine which categories to show
  const visibleCategories = useMemo(() => {
    if (isSearching) {
      return [...filteredByCategory.keys()];
    }
    return sortedCategories;
  }, [isSearching, filteredByCategory, sortedCategories]);

  // Set of stencil IDs that match the current search (for filtering loaded stencils)
  const matchingStencilIds = useMemo(() => {
    if (!isSearching) return null;
    const ids = new Set<string>();
    for (const metas of filteredByCategory.values()) {
      for (const meta of metas) {
        ids.add(meta.id);
      }
    }
    return ids;
  }, [isSearching, filteredByCategory]);

  // Reset "show more" expansion when search changes
  useEffect(() => {
    setExpandedCategories(new Set());
  }, [debouncedQuery]);

  // Load stencils for visible categories
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    for (const category of visibleCategories) {
      // Skip collapsed categories (but always load if searching)
      if (!isSearching && collapsedCategories.has(category)) continue;
      if (loadedStencils.has(category)) continue;
      if (loadingCategories.has(category)) continue;

      setLoadingCategories((prev) => new Set(prev).add(category));

      getCategoryStencils(category).then(
        (stencils) => {
          if (cancelled) return;
          setLoadedStencils((prev) => new Map(prev).set(category, stencils));
          setLoadingCategories((prev) => {
            const next = new Set(prev);
            next.delete(category);
            return next;
          });
        },
        () => {
          if (cancelled) return;
          setLoadingCategories((prev) => {
            const next = new Set(prev);
            next.delete(category);
            return next;
          });
        },
      );
    }

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, visibleCategories, isSearching, collapsedCategories]);

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const toggleShowMore = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const handleStencilClick = useCallback(
    (entry: StencilEntry) => {
      const expression = createStencilExpression(entry);
      onInsert(expression);
    },
    [onInsert],
  );

  const handleDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>, entry: StencilEntry) => {
      event.dataTransfer.setData(
        'application/x-infinicanvas-stencil',
        entry.id,
      );
      event.dataTransfer.effectAllowed = 'copy';

      // Create offscreen drag preview from SVG
      const dragImg = new Image(40, 40);
      dragImg.src = svgToDataUri(entry.svgContent);
      document.body.appendChild(dragImg);
      dragImg.style.position = 'absolute';
      dragImg.style.top = '-9999px';
      if (typeof event.dataTransfer.setDragImage === 'function') {
        event.dataTransfer.setDragImage(dragImg, 20, 20);
      }
      requestAnimationFrame(() => document.body.removeChild(dragImg));
    },
    [],
  );

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      data-testid="stencil-palette-panel"
      role="navigation"
      aria-label="Stencil palette"
      style={{
        position: 'fixed',
        left: 60,
        top: '50%',
        transform: 'translateY(-50%)',
        width: PANEL_WIDTH,
        maxHeight: '80vh',
        overflowY: 'auto',
        backgroundColor: 'var(--bg-toolbar, #ffffff)',
        borderRadius: 10,
        boxShadow: '0 4px 16px var(--shadow, rgba(0, 0, 0, 0.15))',
        border: '1px solid var(--border, #e0e0e0)',
        padding: 8,
        zIndex: 20,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Search input */}
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Search
          size={14}
          style={{
            position: 'absolute',
            left: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            color: '#999',
            pointerEvents: 'none',
          }}
        />
        <input
          data-testid="stencil-search-input"
          type="text"
          placeholder="Search stencils…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          aria-label="Search stencils"
          style={{
            width: '100%',
            padding: '6px 28px 6px 28px',
            border: '1px solid var(--border, #e0e0e0)',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'inherit',
            backgroundColor: 'var(--bg-toolbar, #ffffff)',
            color: 'var(--text-primary, #333333)',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        {searchInput && (
          <button
            type="button"
            data-testid="stencil-search-clear"
            aria-label="Clear search"
            onClick={handleClearSearch}
            style={{
              position: 'absolute',
              right: 4,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 2,
              color: '#999',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* No results message */}
      {isSearching && visibleCategories.length === 0 && (
        <div
          data-testid="stencil-search-no-results"
          style={{
            textAlign: 'center',
            padding: '16px 0',
            fontSize: 12,
            color: '#999',
          }}
        >
          No stencils found
        </div>
      )}

      {/* Category list */}
      {visibleCategories.map((category) => {
        const isCollapsed = !isSearching && collapsedCategories.has(category);
        const stencils = loadedStencils.get(category);
        const isLoading = loadingCategories.has(category);
        const displayName = getCategoryDisplayName(category);
        const totalCount = categoryCounts.get(category) ?? 0;
        const isExpanded = expandedCategories.has(category);
        const ChevronIcon = isCollapsed ? ChevronRight : ChevronDown;

        // Filter loaded stencils by search matches
        const visibleStencils = stencils
          ? (matchingStencilIds
              ? stencils.filter((s) => matchingStencilIds.has(s.id))
              : stencils)
          : undefined;

        // Apply "show more" limit (only when not searching)
        const needsShowMore =
          !isSearching &&
          visibleStencils !== undefined &&
          visibleStencils.length > INITIAL_RENDER_LIMIT;
        const renderedStencils =
          needsShowMore && !isExpanded
            ? visibleStencils!.slice(0, INITIAL_RENDER_LIMIT)
            : visibleStencils;
        const remainingCount =
          needsShowMore && visibleStencils
            ? visibleStencils.length - INITIAL_RENDER_LIMIT
            : 0;

        return (
          <div key={category} style={{ marginBottom: 4 }}>
            {/* Category header — clickable to toggle */}
            <button
              type="button"
              data-testid={`category-header-${category}`}
              aria-expanded={!isCollapsed}
              aria-label={`${displayName} category`}
              onClick={() => toggleCategory(category)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                width: '100%',
                padding: '6px 4px',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                backgroundColor: 'transparent',
                color: 'var(--text-primary, #333333)',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'inherit',
                textAlign: 'left',
                transition: 'background-color 0.1s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#f0f4ff';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <ChevronIcon size={14} />
              <span>{displayName}</span>
              <span
                data-testid={`category-count-${category}`}
                style={{
                  marginLeft: 'auto',
                  fontSize: 10,
                  color: '#999',
                  fontWeight: 400,
                }}
              >
                {totalCount}
              </span>
            </button>

            {/* Stencil grid — hidden when collapsed */}
            {!isCollapsed && isLoading && (
              <div
                data-testid={`category-loading-${category}`}
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  padding: '12px 0',
                  color: '#999',
                }}
              >
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            )}

            {!isCollapsed && renderedStencils && (
              <div
                style={{
                  maxHeight: 400,
                  overflowY: 'auto',
                }}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
                    gap: 4,
                    padding: '4px 0',
                  }}
                >
                  {renderedStencils.map((entry) => (
                    <StencilItem
                      key={entry.id}
                      entry={entry}
                      onClick={handleStencilClick}
                      onDragStart={handleDragStart}
                    />
                  ))}
                </div>

                {/* Show more button */}
                {needsShowMore && !isExpanded && (
                  <button
                    type="button"
                    data-testid={`show-more-${category}`}
                    onClick={() => toggleShowMore(category)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '4px 0',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      backgroundColor: 'transparent',
                      color: '#4A90D9',
                      fontSize: 11,
                      fontFamily: 'inherit',
                      textAlign: 'center',
                    }}
                  >
                    Show {remainingCount} more…
                  </button>
                )}
                {needsShowMore && isExpanded && (
                  <button
                    type="button"
                    data-testid={`show-less-${category}`}
                    onClick={() => toggleShowMore(category)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '4px 0',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      backgroundColor: 'transparent',
                      color: '#4A90D9',
                      fontSize: 11,
                      fontFamily: 'inherit',
                      textAlign: 'center',
                    }}
                  >
                    Show less
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── StencilItem sub-component ──────────────────────────────

/** Props for StencilItem. */
interface StencilItemProps {
  entry: StencilEntry;
  onClick: (entry: StencilEntry) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>, entry: StencilEntry) => void;
}

/**
 * Individual stencil thumbnail with label and tooltip.
 *
 * Renders a small SVG preview (48×48) with the stencil label below.
 * Supports click-to-place and drag-to-place interactions.
 * Memoized to avoid unnecessary re-renders when parent state changes.
 */
const StencilItem = memo(function StencilItem({
  entry,
  onClick,
  onDragStart,
}: StencilItemProps) {
  return (
    <div
      data-testid={`stencil-item-${entry.id}`}
      title={entry.label}
      draggable="true"
      onClick={() => onClick(entry)}
      onDragStart={(e) => onDragStart(e, entry)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        padding: 4,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'background-color 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#f0f4ff';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {/* SVG thumbnail — trusted bundled content */}
      <div
        data-testid={`stencil-svg-${entry.id}`}
        style={{
          width: THUMBNAIL_SIZE,
          height: THUMBNAIL_SIZE,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <img
          src={svgToDataUri(entry.svgContent)}
          alt={entry.label}
          width={THUMBNAIL_SIZE - 8}
          height={THUMBNAIL_SIZE - 8}
          style={{ objectFit: 'contain', pointerEvents: 'none' }}
        />
      </div>

      {/* Label */}
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-primary, #666)',
          textAlign: 'center',
          lineHeight: 1.2,
          maxWidth: THUMBNAIL_SIZE + 16,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {entry.label}
      </span>
    </div>
  );
});
