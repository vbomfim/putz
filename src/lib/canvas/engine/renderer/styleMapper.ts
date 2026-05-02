/**
 * Style mapping — ExpressionStyle → Rough.js Options.
 *
 * Converts the protocol's `ExpressionStyle` to the options accepted by
 * Rough.js drawing methods. Opacity is handled separately via
 * `ctx.globalAlpha` and is not included in the Rough.js options.
 *
 * @module
 */

import type { ExpressionStyle } from "../../protocol";
import type { Options } from "roughjs/bin/core.js";

/**
 * Map an ExpressionStyle to Rough.js drawing options. [AC11]
 *
 * - `strokeColor` → `stroke`
 * - `backgroundColor` → `fill` (undefined when 'transparent')
 * - `fillStyle` → `fillStyle` (undefined when 'none')
 * - `strokeWidth` → `strokeWidth`
 * - `roughness` → `roughness`
 * - `opacity` is NOT mapped (handled via `ctx.globalAlpha`)
 */
/** Convert strokeStyle to a canvas/Rough.js dash pattern. */
function strokeStyleToDash(
  strokeStyle: string,
  strokeWidth: number,
): number[] | undefined {
  switch (strokeStyle) {
    case "dashed":
      return [strokeWidth * 4, strokeWidth * 3];
    case "dotted":
      return [strokeWidth, strokeWidth * 2];
    default:
      return undefined;
  }
}

export function mapStyleToRoughOptions(
  style: ExpressionStyle,
  seed?: number,
): Options {
  const noFill =
    style.fillStyle === "none" || style.backgroundColor === "transparent";
  const dash = strokeStyleToDash(
    style.strokeStyle ?? "solid",
    style.strokeWidth,
  );
  return {
    stroke: style.strokeColor,
    fill: noFill ? undefined : style.backgroundColor,
    fillStyle: noFill ? undefined : style.fillStyle,
    strokeWidth: style.strokeWidth,
    roughness: style.roughness,
    // When roughness is 0 (clean geometry), disable line curvature too
    ...(style.roughness === 0 ? { bowing: 0 } : {}),
    strokeLineDash: dash,
    ...(seed !== undefined ? { seed } : {}),
  };
}

/** Derive a deterministic numeric seed from a string (expression ID). */
export function idToSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Compute a deterministic hash string for caching Rough.js drawables.
 *
 * The hash includes all style fields that affect rendering. Two identical
 * styles produce the same hash; any change produces a different hash.
 *
 * @deprecated Use computeRenderHash for cache keys that include position/size/data.
 */
export function computeStyleHash(style: ExpressionStyle): string {
  return [
    style.strokeColor,
    style.backgroundColor,
    style.fillStyle,
    style.strokeStyle ?? "solid",
    style.strokeWidth,
    style.roughness,
    style.opacity,
    style.fontSize ?? "",
    style.fontFamily ?? "",
  ].join("|");
}

/**
 * Compute a deterministic hash for caching Rough.js drawables.
 *
 * Includes style, position, size, and data fields — any change to the
 * visual representation of the expression will produce a different hash,
 * triggering a cache miss and drawable regeneration.
 */
export function computeRenderHash(
  style: ExpressionStyle,
  position: { x: number; y: number },
  size: { width: number; height: number },
  data: unknown,
): string {
  return [
    style.strokeColor,
    style.backgroundColor,
    style.fillStyle,
    style.strokeStyle ?? "solid",
    style.strokeWidth,
    style.roughness,
    style.opacity,
    style.fontSize ?? "",
    style.fontFamily ?? "",
    position.x,
    position.y,
    size.width,
    size.height,
    JSON.stringify(data),
  ].join("|");
}
