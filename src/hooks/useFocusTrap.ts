/**
 * `useFocusTrap` — keep keyboard focus inside a container while a
 * modal/menu is open (T4 / D1, WAI-ARIA APG dialog pattern).
 *
 * Behavior:
 *  - When `isOpen` flips true, attaches a `keydown` listener on the
 *    container that intercepts Tab / Shift+Tab.
 *  - On Tab at the LAST focusable element → wrap to FIRST.
 *  - On Shift+Tab at the FIRST focusable element → wrap to LAST.
 *  - Re-queries focusables on every keydown so newly-mounted elements
 *    (e.g., a button revealed by a state change inside the modal)
 *    participate without extra wiring.
 *  - No-op when `isOpen` is false or the container ref is null.
 *
 * Focus restoration on close is the caller's job — see
 * `SpawnPalette.previousFocusRef` for the canonical pattern.
 *
 * Why re-query instead of MutationObserver: the keydown handler runs at
 * most a few times per second during real interaction, and the
 * focusable selector is fast (single querySelectorAll). MutationObserver
 * adds complexity without measurable benefit at this scale.
 *
 * @module hooks/useFocusTrap
 */
import { useEffect, type RefObject } from "react";

/**
 * CSS selector matching every "Tab-reachable" element. Mirrors the
 * WAI-ARIA APG canonical list. We exclude `tabindex="-1"` because those
 * elements are programmatically focusable but NOT in the Tab order.
 */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Trap Tab / Shift+Tab focus inside `containerRef.current` while
 * `isOpen` is true.
 *
 * @param containerRef - ref to the modal/menu container element
 * @param isOpen - whether the trap should be active
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  isOpen: boolean,
): void {
  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => {
        // Skip explicitly hidden elements. We deliberately do NOT use
        // `offsetParent !== null` because jsdom (and any layout-less
        // environment) returns null for everything, which would
        // collapse the focusable set to empty in tests. The `hidden`
        // attribute + `aria-hidden="true"` cover the practical cases
        // of intentionally non-interactive elements.
        if (el.hasAttribute("hidden")) return false;
        if (el.getAttribute("aria-hidden") === "true") return false;
        return true;
      });

      if (focusables.length === 0) {
        // Nothing focusable inside the container — swallow Tab so
        // focus can't escape to the page behind the modal.
        e.preventDefault();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        // Shift+Tab at first → wrap to last. Also: if focus is somehow
        // OUTSIDE the container, snap it back to last.
        if (active === first || !container.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !container.contains(active)) {
        // Tab at last → wrap to first. Same outside-container fallback.
        e.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", handler);
    return () => container.removeEventListener("keydown", handler);
  }, [containerRef, isOpen]);
}

export const FOCUS_TRAP_SELECTOR = FOCUSABLE_SELECTOR;
