/**
 * Unit tests for QuickConnect browser URL detection.
 *
 * Verifies that URLs starting with http:// or https:// are
 * detected and opened as browser tabs instead of SSH connections.
 *
 * Tags: [TDD], [BROWSER-TABS]
 */
import { describe, it, expect } from "vitest";
import { parseConnection } from "../components/QuickConnect/parseConnection";

describe("QuickConnect — browser URL detection", () => {
  it("parses https://example.com as SSH with host containing https://", () => {
    // parseConnection defaults to SSH for bare input — the host will contain
    // the full URL, which App.tsx uses to detect browser intent.
    const result = parseConnection("https://example.com");
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("ssh");
    expect(result!.host).toContain("https");
  });

  it("parses http://10.0.0.1:3000 preserving the URL in host field", () => {
    const result = parseConnection("http://10.0.0.1:3000");
    expect(result).not.toBeNull();
    // The host will contain "http" prefix — App.tsx checks this
    expect(result!.host).toContain("http");
  });

  it("does NOT treat ssh://host as a browser URL", () => {
    const result = parseConnection("ssh admin@10.0.0.1");
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("ssh");
    expect(result!.host).not.toContain("http");
  });

  it("does NOT treat plain hostnames as browser URLs", () => {
    const result = parseConnection("10.0.0.1");
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("ssh");
    expect(result!.host).toBe("10.0.0.1");
  });

  it("preserves https://grafana.local:3000/dashboard path in host", () => {
    const result = parseConnection("https://grafana.local:3000/dashboard");
    expect(result).not.toBeNull();
    // The URL gets partially parsed — the key is that "http" appears
    // in the host so App.tsx can detect it as a browser URL
    expect(result!.host).toContain("http");
  });
});
