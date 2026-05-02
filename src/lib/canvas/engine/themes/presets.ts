/**
 * Theme presets for InfiniCanvas — one-click professional color themes.
 *
 * Defines reusable color palettes and provides a pure function to compute
 * themed style overrides for any set of expressions based on their kind.
 *
 * @module
 */

import type { VisualExpression, ExpressionStyle } from "../../protocol";

// ── Theme types ────────────────────────────────────────────

/** A reusable color theme that can be applied to canvas expressions. */
export interface ThemePreset {
  /** Unique identifier for this theme. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Short description of the theme's visual character. */
  description: string;
  /** Color palette for the theme. */
  colors: {
    /** Main shape fill — rectangles, ellipses, diamonds. */
    primary: string;
    /** Secondary shape fill — containers, groups. */
    secondary: string;
    /** Highlight/accent fill — sticky notes. */
    accent: string;
    /** Default stroke color for all shapes. */
    stroke: string;
    /** Text color — text expressions and font color. */
    text: string;
    /** Background color — sticky note backgrounds, containers. */
    background: string;
  };
  /** Font family applied to all expressions. */
  fontFamily: string;
}

// ── Preset definitions ────────────────────────────────────

/** Built-in theme presets. */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "corporate",
    name: "Corporate",
    description: "Professional blues and grays",
    colors: {
      primary: "#DAE8FC",
      secondary: "#D5E8D4",
      accent: "#FFF2CC",
      stroke: "#6C8EBF",
      text: "#333333",
      background: "#F5F5F5",
    },
    fontFamily: "Inter, sans-serif",
  },
  {
    id: "technical",
    name: "Technical",
    description: "Clean monochrome",
    colors: {
      primary: "#F5F5F5",
      secondary: "#E0E0E0",
      accent: "#FFFFFF",
      stroke: "#333333",
      text: "#1A1A1A",
      background: "#FAFAFA",
    },
    fontFamily: "JetBrains Mono, monospace",
  },
  {
    id: "colorful",
    name: "Colorful",
    description: "Vibrant and modern",
    colors: {
      primary: "#BB86FC",
      secondary: "#03DAC6",
      accent: "#CF6679",
      stroke: "#121212",
      text: "#121212",
      background: "#FFF9C4",
    },
    fontFamily: "Inter, sans-serif",
  },
  {
    id: "dark",
    name: "Dark",
    description: "Dark mode professional",
    colors: {
      primary: "#2D2D2D",
      secondary: "#3D3D3D",
      accent: "#4A90D9",
      stroke: "#888888",
      text: "#E0E0E0",
      background: "#1E1E1E",
    },
    fontFamily: "Inter, sans-serif",
  },
  {
    id: "blueprint",
    name: "Blueprint",
    description: "Engineering blueprint style",
    colors: {
      primary: "#1A3A5C",
      secondary: "#2C5F8A",
      accent: "#4A90D9",
      stroke: "#FFFFFF",
      text: "#FFFFFF",
      background: "#0D2137",
    },
    fontFamily: "JetBrains Mono, monospace",
  },
];

// ── Lookup ────────────────────────────────────────────────

/**
 * Find a theme preset by ID.
 * Returns undefined if no preset matches.
 */
export function getThemeById(themeId: string): ThemePreset | undefined {
  return THEME_PRESETS.find((t) => t.id === themeId);
}

// ── Expression kind classification ─────────────────────────

/** Expression kinds that receive primary fill color. */
const SHAPE_KINDS = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "image",
  "stencil",
]);

/** Expression kinds that receive secondary fill color (containers). */
const CONTAINER_KINDS = new Set([
  "flowchart",
  "sequence-diagram",
  "wireframe",
  "roadmap",
  "mind-map",
  "kanban",
  "reasoning-chain",
  "decision-tree",
  "collaboration-diagram",
  "slide",
  "code-block",
  "table",
]);

// ── Style computation ─────────────────────────────────────

/**
 * Compute the themed style overrides for a single expression.
 *
 * Returns a partial ExpressionStyle with only the properties that the
 * theme should override. Does NOT mutate the input expression.
 */
export function computeThemedStyle(
  expr: VisualExpression,
  theme: ThemePreset,
): Partial<ExpressionStyle> {
  const base: Partial<ExpressionStyle> = {
    strokeColor: theme.colors.stroke,
    fontFamily: theme.fontFamily,
    fillStyle: "solid",
  };

  if (expr.kind === "text") {
    return {
      strokeColor: theme.colors.text,
      fontFamily: theme.fontFamily,
    };
  }

  if (expr.kind === "sticky-note") {
    return {
      ...base,
      backgroundColor: theme.colors.accent,
    };
  }

  if (
    expr.kind === "line" ||
    expr.kind === "arrow" ||
    expr.kind === "freehand"
  ) {
    return {
      strokeColor: theme.colors.stroke,
      fontFamily: theme.fontFamily,
    };
  }

  if (expr.kind === "comment" || expr.kind === "callout") {
    return {
      strokeColor: theme.colors.text,
      fontFamily: theme.fontFamily,
    };
  }

  if (expr.kind === "highlight" || expr.kind === "marker") {
    return {
      strokeColor: theme.colors.stroke,
    };
  }

  if (CONTAINER_KINDS.has(expr.kind)) {
    return {
      ...base,
      backgroundColor: theme.colors.secondary,
    };
  }

  // Default: shapes get primary fill
  if (SHAPE_KINDS.has(expr.kind)) {
    return {
      ...base,
      backgroundColor: theme.colors.primary,
    };
  }

  // Fallback for any unknown kind
  return {
    ...base,
    backgroundColor: theme.colors.primary,
  };
}

// ── Public API ─────────────────────────────────────────────

/**
 * Apply a theme to a list of expressions, returning new expression objects
 * with themed styles. Does NOT mutate the input expressions.
 *
 * This is a pure function — it computes the result but does NOT interact
 * with the store or emit operations. Call from the store action for
 * side effects.
 */
export function applyThemeToExpressions(
  expressions: VisualExpression[],
  theme: ThemePreset,
): VisualExpression[] {
  return expressions.map((expr) => {
    const styleOverrides = computeThemedStyle(expr, theme);
    return {
      ...expr,
      style: { ...expr.style, ...styleOverrides },
    };
  });
}
