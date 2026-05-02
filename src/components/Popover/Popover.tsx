/**
 * Popover — portal-rendered floating panel anchored to a trigger element.
 *
 * Positioning rules (simple and predictable):
 *  • `placement="bottom"` opens below the anchor; flips above if there's not
 *    enough room below.
 *  • `placement="top"` opens above the anchor; flips below if there's not
 *    enough room above.
 *  • Horizontal position is the anchor's left edge, clamped to the viewport.
 *  • `maxHeight` is clamped to the available vertical space in the chosen
 *    direction, guaranteeing the panel always fits on screen.
 *
 * The panel is rendered via `createPortal` to `document.body`, so it is never
 * clipped by ancestor `overflow` or affected by ancestor stacking contexts.
 *
 * @module
 */
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface PopoverProps {
  /** The element the popover is anchored to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Whether the popover is currently visible. */
  open: boolean;
  /** Called when a click outside the popover (and outside the anchor) occurs. */
  onClose: () => void;
  /** Preferred side relative to the anchor. Flips automatically if cramped. */
  placement?: "top" | "bottom";
  /** Fixed width. Omit for content-based width (clamped by min/max). */
  width?: number;
  /** Minimum width. */
  minWidth?: number;
  /** Maximum width. */
  maxWidth?: number;
  /** Upper bound on the panel height. The actual max-height may be smaller
   *  when the viewport has less room on the chosen side. */
  maxHeight?: number;
  /** Minimum height that must fit on the preferred side before we flip. */
  flipThreshold?: number;
  /** Viewport margin kept between the panel and the window edges. */
  margin?: number;
  /** `z-index` applied to the panel. */
  zIndex?: number;
  /** CSS class name applied to the panel element. */
  className?: string;
  /** Extra styles merged into the computed position styles. */
  style?: CSSProperties;
  /** Popover content. */
  children: ReactNode;
}

export function Popover({
  anchorRef,
  open,
  onClose,
  placement = "bottom",
  width,
  minWidth,
  maxWidth,
  maxHeight = 320,
  flipThreshold = 100,
  margin = 6,
  zIndex = 400,
  className,
  style,
  children,
}: PopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [computed, setComputed] = useState<CSSProperties | null>(null);

  // Compute position whenever open/placement toggles. We also listen for
  // scroll and resize to keep the panel anchored correctly.
  useLayoutEffect(() => {
    if (!open) {
      setComputed(null);
      return;
    }

    const recompute = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Horizontal: align to anchor left, clamp to viewport.
      const panelWidth =
        width ?? Math.min(maxWidth ?? 280, Math.max(minWidth ?? 200, 240));
      let left = rect.left;
      if (left + panelWidth > vw - margin) left = vw - panelWidth - margin;
      if (left < margin) left = margin;

      // Vertical: pick side, flip if cramped.
      const spaceBelow = vh - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      let side: "top" | "bottom" = placement;
      if (
        side === "bottom" &&
        spaceBelow < flipThreshold &&
        spaceAbove > spaceBelow
      ) {
        side = "top";
      } else if (
        side === "top" &&
        spaceAbove < flipThreshold &&
        spaceBelow > spaceAbove
      ) {
        side = "bottom";
      }

      let top: number | undefined;
      let bottom: number | undefined;
      let clampedMaxH: number;
      if (side === "bottom") {
        top = rect.bottom + 2;
        clampedMaxH = Math.max(60, Math.min(maxHeight, spaceBelow));
        if (top < margin) top = margin;
      } else {
        // Anchor the panel's BOTTOM edge just above the trigger. The panel
        // grows upward naturally as content loads, so we avoid the "floats
        // high with gap" artifact that `top = rect.top - maxHeight` causes
        // when content is async or smaller than max.
        bottom = vh - rect.top + 2;
        clampedMaxH = Math.max(60, Math.min(maxHeight, spaceAbove));
      }

      setComputed({
        position: "fixed",
        left,
        top,
        bottom,
        width,
        minWidth,
        maxWidth,
        maxHeight: clampedMaxH,
        overflowY: "auto",
        zIndex,
        // Force own compositor layer so WebView2 does not leave stale pixels
        // on GPU-accelerated siblings (xterm WebGL canvas) behind the panel.
        transform: "translateZ(0)",
        isolation: "isolate",
        contain: "layout paint",
      });
    };

    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [
    open,
    placement,
    width,
    minWidth,
    maxWidth,
    maxHeight,
    flipThreshold,
    margin,
    zIndex,
    anchorRef,
  ]);

  // Observe the panel itself — when async children load and its size changes,
  // recompute position so the flip/clamp logic applies to the real size.
  useEffect(() => {
    if (!open || !computed || typeof ResizeObserver === "undefined") return;
    const panel = panelRef.current;
    if (!panel) return;
    const ro = new ResizeObserver(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const vh = window.innerHeight;
      const spaceBelow = vh - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      let side: "top" | "bottom" = placement;
      if (
        side === "bottom" &&
        spaceBelow < flipThreshold &&
        spaceAbove > spaceBelow
      )
        side = "top";
      else if (
        side === "top" &&
        spaceAbove < flipThreshold &&
        spaceBelow > spaceAbove
      )
        side = "bottom";
      const clampedMaxH = Math.max(
        60,
        Math.min(maxHeight, side === "bottom" ? spaceBelow : spaceAbove),
      );
      setComputed((prev) =>
        prev ? { ...prev, maxHeight: clampedMaxH } : prev,
      );
    });
    ro.observe(panel);
    return () => ro.disconnect();
  }, [open, computed, anchorRef, placement, flipThreshold, margin, maxHeight]);

  // When the popover opens or closes, notify GPU-accelerated siblings
  // (xterm WebGL canvas) so they can force a full repaint. WebView2
  // otherwise leaves stale pixels under the overlay.
  useEffect(() => {
    if (!open) return;
    const nudge = () => {
      window.dispatchEvent(new Event("resize"));
      window.dispatchEvent(new CustomEvent("putz-overlay-toggle"));
    };
    nudge();
    return () => {
      // Delay so the portal has actually unmounted before the terminal refreshes.
      setTimeout(nudge, 0);
    };
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose, anchorRef]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open || !computed) return null;

  return createPortal(
    <div ref={panelRef} className={className} style={{ ...computed, ...style }}>
      {children}
    </div>,
    document.body,
  );
}
