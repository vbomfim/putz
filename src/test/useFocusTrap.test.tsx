/**
 * Tests for `useFocusTrap` (T4 / D1).
 *
 * Verifies WAI-ARIA APG dialog/menu Tab-cycle semantics:
 *  - Tab on the LAST focusable wraps to the FIRST.
 *  - Shift+Tab on the FIRST focusable wraps to the LAST.
 *  - Tab from outside the container snaps focus into the container.
 *  - Plain typing keys are ignored.
 *  - Hook is a no-op when `isOpen` is false (no listener attached).
 */
import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

interface HarnessProps {
  open: boolean;
  /** Optional extra trailing button (mounted conditionally to verify
   *  re-query behavior — not just a snapshot of focusables at mount). */
  extra?: boolean;
}

function Harness({ open, extra }: HarnessProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, open);
  return (
    <div>
      <button data-testid="outside-before">outside-before</button>
      <div ref={ref} data-testid="container">
        <button data-testid="first">first</button>
        <button data-testid="middle">middle</button>
        <button data-testid="last">last</button>
        {extra && <button data-testid="extra">extra</button>}
      </div>
      <button data-testid="outside-after">outside-after</button>
    </div>
  );
}

describe("useFocusTrap", () => {
  it("Tab on last focusable wraps to first", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const last = getByTestId("last") as HTMLButtonElement;
    const first = getByTestId("first") as HTMLButtonElement;
    last.focus();
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(getByTestId("container"), { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("Shift+Tab on first focusable wraps to last", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const first = getByTestId("first") as HTMLButtonElement;
    const last = getByTestId("last") as HTMLButtonElement;
    first.focus();
    fireEvent.keyDown(getByTestId("container"), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("Tab from middle focusable does NOT preventDefault (browser handles it)", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const middle = getByTestId("middle") as HTMLButtonElement;
    middle.focus();
    const ev = fireEvent.keyDown(getByTestId("container"), { key: "Tab" });
    // Default behavior preserved → browser will move focus naturally.
    expect(ev).toBe(true);
  });

  it("Tab when focus is outside container snaps focus to first", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const outside = getByTestId("outside-before") as HTMLButtonElement;
    outside.focus();
    fireEvent.keyDown(getByTestId("container"), { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("ignores non-Tab keys", () => {
    const { getByTestId } = render(<Harness open={true} />);
    const last = getByTestId("last") as HTMLButtonElement;
    last.focus();
    fireEvent.keyDown(getByTestId("container"), { key: "Enter" });
    fireEvent.keyDown(getByTestId("container"), { key: "a" });
    expect(document.activeElement).toBe(last);
  });

  it("is a no-op when isOpen=false", () => {
    const { getByTestId } = render(<Harness open={false} />);
    const last = getByTestId("last") as HTMLButtonElement;
    last.focus();
    fireEvent.keyDown(getByTestId("container"), { key: "Tab" });
    // Hook never installed listener → focus stays put (browser would
    // move it but jsdom doesn't simulate Tab traversal on its own).
    expect(document.activeElement).toBe(last);
  });

  it("re-queries focusables on each keydown (newly mounted elements participate)", () => {
    const { getByTestId, rerender } = render(<Harness open={true} />);
    rerender(<Harness open={true} extra={true} />);
    const extra = getByTestId("extra") as HTMLButtonElement;
    extra.focus();
    fireEvent.keyDown(getByTestId("container"), { key: "Tab" });
    // `extra` is now the last focusable → wraps to first.
    expect(document.activeElement).toBe(getByTestId("first"));
  });
});
