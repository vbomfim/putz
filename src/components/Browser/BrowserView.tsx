/**
 * BrowserView — web browser inside a tab.
 * Tries native embedded webview first. Falls back to pop-out window.
 * Maintains URL bar with navigation controls.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./BrowserView.css";

interface BrowserViewProps {
  browserId: string;
  initialUrl: string;
  isActive: boolean;
  onClose?: () => void;
}

const MAX_URL_LENGTH = 2048;

export function BrowserView({ browserId, initialUrl, isActive, onClose }: BrowserViewProps) {
  const [urlInput, setUrlInput] = useState(initialUrl || "");
  const [currentUrl, setCurrentUrl] = useState(initialUrl || "");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const webviewCreated = useRef(false);

  const normalizeUrl = (input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    return `https://${trimmed}`;
  };

  // Navigate: create webview on first call, then navigate on subsequent calls
  const doNavigate = useCallback(() => {
    const url = normalizeUrl(urlInput);
    if (!url || url.length > MAX_URL_LENGTH) return;
    setCurrentUrl(url);
    setUrlInput(url);
    setError(null);

    if (!webviewCreated.current) {
      // First navigation — create the webview
      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      webviewCreated.current = true;
      setIsLoading(true);
      invoke("browser_open", {
        tabId: browserId,
        url,
        x: rect ? Math.round(rect.left) : 0,
        y: rect ? Math.round(rect.top) : 0,
        width: rect ? Math.round(rect.width) : 900,
        height: rect ? Math.round(rect.height) : 600,
      }).then(() => setIsLoading(false)).catch((err) => {
        setIsLoading(false);
        webviewCreated.current = false;
        setError(typeof err === "string" ? err : "Failed to open browser");
      });
    } else {
      invoke("browser_navigate", { tabId: browserId, url }).catch((err) => {
        setError(typeof err === "string" ? err : "Navigation failed");
      });
    }
  }, [browserId, urlInput]);

  // Resize webview when container changes size
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !webviewCreated.current) return;
    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        invoke("browser_resize", {
          tabId: browserId,
          x: Math.round(rect.left), y: Math.round(rect.top),
          width: Math.round(rect.width), height: Math.round(rect.height),
        }).catch(() => {});
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [browserId, currentUrl]);

  // Show/hide webview based on tab active state
  useEffect(() => {
    if (!webviewCreated.current) return;
    invoke("browser_set_visible", { tabId: browserId, visible: isActive }).catch(() => {});
  }, [browserId, isActive]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (webviewCreated.current) {
        invoke("browser_set_visible", { tabId: browserId, visible: false }).catch(() => {});
      }
    };
  }, [browserId]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); doNavigate(); }
    if (e.key === "Escape") { setUrlInput(currentUrl); }
  }, [doNavigate, currentUrl]);

  const handleRefresh = useCallback(() => {
    if (currentUrl) invoke("browser_navigate", { tabId: browserId, url: currentUrl }).catch(() => {});
  }, [browserId, currentUrl]);

  return (
    <div className="browser-view" style={{ display: "flex", flex: 1, flexDirection: "column" }}>
      {/* URL bar */}
      <div className="browser-toolbar">
        <button className="browser-nav-btn" onClick={handleRefresh} type="button" title="Refresh">↻</button>
        <div className="browser-url-form">
          <input
            className="browser-url-input"
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL and press Enter..."
          />
          <button className="browser-go-btn" type="button" onClick={doNavigate} title="Go">→</button>
          <button className="browser-nav-btn" type="button" onClick={() => {
            const url = currentUrl || normalizeUrl(urlInput);
            if (url) invoke("browser_open", { tabId: browserId + "-pop", url, x: 0, y: 0, width: 900, height: 700 }).catch(() => {});
          }} title="Pop out to window" style={{ fontSize: "11px" }}>⇱</button>
          {onClose && <button className="browser-nav-btn browser-close-pane-btn" onClick={onClose} type="button" title="Close" style={{ color: "#f38ba8" }}>✕</button>}
        </div>
      </div>

      {error && <div style={{ padding: "8px", color: "#f38ba8", fontSize: "12px" }}>{error}</div>}
      {isLoading && <div style={{ padding: "8px", color: "#89b4fa", fontSize: "12px" }}>Loading...</div>}

      {/* Native webview renders over this container */}
      <div
        ref={containerRef}
        className="browser-content"
        style={{ flex: 1, position: "relative", background: currentUrl ? "transparent" : "#1e1e2e" }}
      >
        {!currentUrl && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "rgba(205,214,244,0.4)" }}>
            Type a URL above and press Enter
          </div>
        )}
      </div>
    </div>
  );
}
