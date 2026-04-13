/**
 * BrowserView — web browser inside a tab.
 * Uses Tauri add_child for native webview embedded in tab.
 * Survives React remounts by always using browser_open (which reuses existing webviews).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLayoutStore } from "../../stores/layoutStore";
import "./BrowserView.css";

interface BrowserViewProps {
  browserId: string;
  initialUrl: string;
  isActive: boolean;
  regionId: string;
  tabId: string;
  onClose?: () => void;
}

const MAX_URL_LENGTH = 2048;

// macOS title bar offset — add_child coordinates are relative to the window
// (including title bar), but getBoundingClientRect() is relative to the viewport
// (below title bar). We detect this offset once and cache it.
let cachedTitleBarOffset: number | null = null;
async function getTitleBarOffset(): Promise<number> {
  if (cachedTitleBarOffset !== null) return cachedTitleBarOffset;
  try {
    const win = getCurrentWindow();
    const [outerSize, innerSize, scale] = await Promise.all([
      win.outerSize(),
      win.innerSize(),
      win.scaleFactor(),
    ]);
    // On macOS: add_child coords are relative to the window (including title bar)
    // but getBoundingClientRect is relative to the viewport (below title bar).
    // On Windows/Linux: both are relative to the client area — no offset needed.
    const rawOffset = (outerSize.height - innerSize.height) / scale;
    // Only apply offset on macOS (where it's typically 28px)
    // Windows returns 0 or a small frame size that doesn't need correction
    const isMac = navigator.userAgent.includes("Mac");
    cachedTitleBarOffset = isMac ? Math.round(rawOffset) : 0;
  } catch {
    cachedTitleBarOffset = 0;
  }
  return cachedTitleBarOffset;
}

export function BrowserView({ browserId, initialUrl, isActive, regionId, tabId, onClose }: BrowserViewProps) {
  const [urlInput, setUrlInput] = useState(initialUrl || "");
  const [currentUrl, setCurrentUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const webviewCreated = useRef(false);
  const titleBarOffset = useRef(0); // computed async per platform
  const updateTabBrowserUrl = useLayoutStore((s) => s.updateTabBrowserUrl);

  // Detect title bar offset on mount
  useEffect(() => {
    getTitleBarOffset().then((offset) => { titleBarOffset.current = offset; });
  }, []);

  // Focus URL bar on mount
  useEffect(() => {
    if (!initialUrl) {
      setTimeout(() => urlInputRef.current?.focus(), 100);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const normalizeUrl = (input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    return `https://${trimmed}`;
  };

  // Sync webview position to match the content area below the toolbar
  const syncPosition = useCallback(() => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const offset = titleBarOffset.current;
    invoke("browser_resize", {
      tabId: browserId,
      x: Math.round(rect.left),
      y: Math.round(rect.top) + offset,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }).catch(() => {});
  }, [browserId]);

  // Open or navigate — browser_open handles existing webviews by reusing them
  const openWebview = useCallback((url: string) => {
    setIsLoading(true);
    setError(null);

    requestAnimationFrame(() => {
      const rect = contentRef.current?.getBoundingClientRect();
      const offset = titleBarOffset.current;
      const x = rect && rect.width > 0 ? Math.round(rect.left) : 60;
      const y = (rect && rect.height > 0 ? Math.round(rect.top) : 80) + offset;
      const w = rect && rect.width > 0 ? Math.round(rect.width) : 900;
      const h = rect && rect.height > 0 ? Math.round(rect.height) : 600;

      invoke("browser_open", {
        tabId: browserId, url, x, y, width: w, height: h,
      }).then(() => {
        webviewCreated.current = true;
        setIsLoading(false);
        setCurrentUrl(url);
        setUrlInput(url);
        updateTabBrowserUrl(regionId, tabId, url);
        // Sync position as layout settles
        requestAnimationFrame(syncPosition);
        setTimeout(syncPosition, 100);
        setTimeout(syncPosition, 300);
      }).catch((err) => {
        setIsLoading(false);
        setError(typeof err === "string" ? err : "Failed to open browser");
      });
    });
  }, [browserId, regionId, tabId, updateTabBrowserUrl, syncPosition]);

  const doNavigate = useCallback(() => {
    const url = normalizeUrl(urlInput);
    if (!url || url.length > MAX_URL_LENGTH) return;
    openWebview(url);
  }, [urlInput, openWebview]);

  // On mount: hide webview if inactive, auto-navigate if active with URL
  useEffect(() => {
    // Always hide existing native webview immediately if tab isn't active
    // (handles remount after split where webview persists at old position)
    invoke("browser_set_visible", { tabId: browserId, visible: false }).catch(() => {});

    if (initialUrl && isActive) {
      const timer = setTimeout(() => openWebview(initialUrl), 300);
      return () => clearTimeout(timer);
    } else if (initialUrl) {
      // Tab exists but isn't active — just restore URL state, don't open webview
      setUrlInput(initialUrl);
      setCurrentUrl(initialUrl);
      webviewCreated.current = true; // mark as created (it exists in Rust)
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize webview when container changes size
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !webviewCreated.current) return;

    syncPosition();
    const t1 = setTimeout(syncPosition, 200);
    const t2 = setTimeout(syncPosition, 1000);

    const observer = new ResizeObserver(syncPosition);
    observer.observe(container);
    return () => { observer.disconnect(); clearTimeout(t1); clearTimeout(t2); };
  }, [browserId, currentUrl, syncPosition]);

  // Show/hide webview based on tab active state + reposition when becoming active
  useEffect(() => {
    if (!webviewCreated.current) return;
    invoke("browser_set_visible", { tabId: browserId, visible: isActive }).catch(() => {});
    if (isActive) {
      // Reposition after becoming active (layout may have changed)
      requestAnimationFrame(syncPosition);
      setTimeout(syncPosition, 100);
    }
  }, [browserId, isActive, syncPosition]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); doNavigate(); }
    if (e.key === "Escape") { setUrlInput(currentUrl); }
  }, [doNavigate, currentUrl]);

  const handleRefresh = useCallback(() => {
    if (currentUrl) openWebview(currentUrl);
  }, [currentUrl, openWebview]);

  return (
    <div className="browser-view" style={{ display: "flex", flex: 1, flexDirection: "column" }}>
      <div className="browser-toolbar">
        <button className="browser-nav-btn" onClick={handleRefresh} type="button" title="Refresh">↻</button>
        <div className="browser-url-form">
          <input
            ref={urlInputRef}
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
            if (url) invoke("browser_open", { tabId: browserId + "-pop", url, x: 0, y: 0, width: 900, height: 700, popup: true }).catch(() => {});
          }} title="Pop out to window" style={{ fontSize: "11px" }}>⇱</button>
          {onClose && <button className="browser-nav-btn browser-close-pane-btn" onClick={onClose} type="button" title="Close" style={{ color: "#f38ba8" }}>✕</button>}
        </div>
      </div>

      {error && <div style={{ padding: "8px", color: "#f38ba8", fontSize: "12px" }}>{error}</div>}
      {isLoading && <div style={{ padding: "8px", color: "#89b4fa", fontSize: "12px" }}>Loading...</div>}

      <div
        ref={contentRef}
        className="browser-content"
        style={{ flex: 1, position: "relative", minHeight: 0 }}
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
