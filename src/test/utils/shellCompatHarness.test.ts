/**
 * Smoke tests for the shellCompatHarness test utility.
 *
 * The harness underpins all ~183 VT corpus tests. If it has a bug (e.g.,
 * silently using a mocked Terminal, failing to flush writes), every corpus
 * test becomes unreliable. These sanity tests verify the harness itself.
 *
 * @see https://github.com/vbomfim/putz/issues/107
 */
import { describe, it, expect } from "vitest";
import { createTerminalFromBytes, getLineText } from "./shellCompatHarness";

describe("createTerminalFromBytes — harness sanity", () => {
  it("produces a working terminal for empty input", async () => {
    const term = await createTerminalFromBytes(new Uint8Array(0));
    expect(term.cols).toBe(80);
    expect(term.rows).toBe(24);
    expect(getLineText(term, 0)).toBe("");
    term.dispose();
  });

  it("renders simple ASCII text", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const term = await createTerminalFromBytes(bytes);
    expect(getLineText(term, 0)).toContain("hello world");
    term.dispose();
  });

  it("respects custom dimensions", async () => {
    const term = await createTerminalFromBytes(new Uint8Array(0), {
      cols: 120,
      rows: 30,
    });
    expect(term.cols).toBe(120);
    expect(term.rows).toBe(30);
    term.dispose();
  });

  it("invokes beforeWrite hook before bytes flow", async () => {
    let hookFired = false;
    let hookSawZeroBuffer = false;
    const bytes = new TextEncoder().encode("hello");

    const term = await createTerminalFromBytes(bytes, {
      beforeWrite: (t) => {
        hookFired = true;
        // At this point, buffer should have no content yet
        hookSawZeroBuffer = getLineText(t, 0) === "";
      },
    });

    expect(hookFired).toBe(true);
    expect(hookSawZeroBuffer).toBe(true);
    term.dispose();
  });

  it("handles a moderately large byte buffer (10 KB) without timing out", async () => {
    // 10 KB of 'a's — should fit in one terminal write call
    const bytes = new Uint8Array(10 * 1024).fill(0x61); // 'a'
    const term = await createTerminalFromBytes(bytes);
    // Just verify we got a Terminal back without throwing
    expect(term).toBeDefined();
    expect(term.rows).toBe(24);
    term.dispose();
  });
});
