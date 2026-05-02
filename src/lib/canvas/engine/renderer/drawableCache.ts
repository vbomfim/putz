/**
 * Rough.js drawable cache.
 *
 * Caches `Drawable` objects per expression to avoid regenerating them
 * every frame. The cache key combines the expression ID with a render hash
 * that covers style, position, size, and data. When any of these change,
 * the old cache entry is automatically invalidated because the hash won't match.
 *
 * @module
 */

import type { ExpressionStyle } from "../../protocol";
import type { Drawable } from "roughjs/bin/core.js";
import { computeRenderHash } from "./styleMapper";

/** Entry stored in the drawable cache. */
interface CacheEntry {
  renderHash: string;
  drawable: Drawable;
}

/** Render context used to compute the cache key hash. */
export interface RenderContext {
  style: ExpressionStyle;
  position: { x: number; y: number };
  size: { width: number; height: number };
  data: unknown;
}

/** Drawable cache interface. */
export interface DrawableCache {
  /** Get a cached drawable if the render hash matches. */
  get(id: string, ctx: RenderContext): Drawable | undefined;
  /** Get any cached drawable regardless of hash (for flicker-free fallback). */
  getStale(id: string): Drawable | undefined;
  /** Store a drawable for an expression with the given render context. */
  set(id: string, ctx: RenderContext, drawable: Drawable): void;
  /** Remove a specific expression from the cache. */
  invalidate(id: string): void;
  /** Remove all entries from the cache. */
  clear(): void;
}

/**
 * Create a new drawable cache. [AC14]
 *
 * Stores one drawable per expression ID. When `get` is called with a
 * different render hash, it returns `undefined` (cache miss), prompting
 * the caller to regenerate and re-cache.
 */
export function createDrawableCache(): DrawableCache {
  const entries = new Map<string, CacheEntry>();

  return {
    get(id: string, ctx: RenderContext): Drawable | undefined {
      const entry = entries.get(id);
      if (!entry) return undefined;

      const hash = computeRenderHash(
        ctx.style,
        ctx.position,
        ctx.size,
        ctx.data,
      );
      if (entry.renderHash !== hash) return undefined;

      return entry.drawable;
    },

    /** Get any cached drawable (even stale) for flicker-free rendering. */
    getStale(id: string): Drawable | undefined {
      return entries.get(id)?.drawable;
    },

    set(id: string, ctx: RenderContext, drawable: Drawable): void {
      entries.set(id, {
        renderHash: computeRenderHash(
          ctx.style,
          ctx.position,
          ctx.size,
          ctx.data,
        ),
        drawable,
      });
    },

    invalidate(id: string): void {
      entries.delete(id);
    },

    clear(): void {
      entries.clear();
    },
  };
}
