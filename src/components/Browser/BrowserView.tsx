/**
 * BrowserView — Renders a native Tauri webview overlay for browsing.
 *
 * Displays a URL bar at the top with navigation controls and a placeholder
 * div whose position is used to overlay a native Tauri webview. The webview
 * floats above the React DOM and is managed via Tauri IPC commands.
 *
 * Lifecycle:
 * - On mount: calls browser_open to create the native webview
 * - On resize: calls browser_resize to reposition the webview
 * - On unmount: calls browser_close to destroy the webview
 * - On tab switch: calls browser_set_visible to show/hide
 *
 * @module BrowserView
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./BrowserView.css";

interface BrowserViewProps {
  /** Tab ID — used as the webview identifier. */
  tabId: string;
  /** Initial URL to load. */
  initialUrl: string;
  /** Whether this tab is currently visible (active). */
  isActive: boolean;
}

/** Maximum URL length to prevent abuse. */
const MAX_URL_LENGTH = 2048;

/**
 * BrowserView component — renders a URL bar and manages a native webview.
 *
 * The webview is a native overlay positioned over a placeholder div.
 * ResizeObserver tracks the placeholder's position and size to keep
 * the native webview aligned.
 */
export function BrowserView({ tabId, initialUrl, isActive }: BrowserViewProps) {
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const webviewCreated = useRef(false);

  // Open the native webview on mount — only if we have a real URL
  useEffect(() => {
    const container = containerRef.current;
    if (!container || webviewCreated.current) return;

    // Skip webview creation if URL is empty or incomplete
    const isValidUrl = initialUrl.startsWith("http://") || initialUrl.startsWith("https://");
    const hasHost = isValidUrl && initialUrl.length > 10; // more than just "https://"
    if (!hasHost) {
      // Just show the URL bar — user will type a URL and press Enter
      return;
    }

    const rect = container.getBoundingClientRect();
    webviewCreated.current = true;
    setIsLoading(true);

    invoke("browser_open", {
      tabId,
      url: initialUrl,
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
      .then(() => {
        setIsLoading(false);
      })
      .catch((err) => {
        setIsLoading(false);
        webviewCreated.current = false;
        setError(
          typeof err === "string" ? err : err instanceof Error ? err.message : "Failed to open browser",
        );
        console.error("[BrowserView] browser_open failed:", err);
      });

    // Cleanup: close webview on unmount
    return () => {
      if (webviewCreated.current) {
        invoke("browser_close", { tabId }).catch(() => {
          // Ignore — webview may already be closed
        });
        webviewCreated.current = false;
      }
    };
  }, [tabId, initialUrl]);

  // Track container size changes with ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (!webviewCreated.current) return;
      const rect = container.getBoundingClientRect();
      invoke("browser_resize", {
        tabId,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      }).catch(() => {
        // Ignore resize errors
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [tabId]);

  // Show/hide webview when tab becomes active/inactive
  useEffect(() => {
    if (!webviewCreated.current) return;
    invoke("browser_set_visible", { tabId, visible: isActive }).catch(() => {
      // Ignore visibility errors
    });
  }, [tabId, isActive]);

  /** Navigate to a new URL via the URL bar. */
  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = urlInput.trim();
      if (!trimmed || trimmed.length > MAX_URL_LENGTH) return;

      // Auto-prepend https:// if no protocol specified
      const url =
        trimmed.startsWith("http://") || trimmed.startsWith("https://")
          ? trimmed
          : `https://${trimmed}`;

      setCurrentUrl(url);
      setUrlInput(url);
      setError(null);

      if (!webviewCreated.current) {
        // First navigation — create the webview
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        webviewCreated.current = true;
        setIsLoading(true);
        invoke("browser_open", {
          tabId,
          url,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
          .then(() => setIsLoading(false))
          .catch((err) => {
            setIsLoading(false);
            webviewCreated.current = false;
            setError(typeof err === "string" ? err : "Failed to open browser");
            console.error("[BrowserView] browser_open failed:", err);
          });
      } else {
        // Webview exists — just navigate
        invoke("browser_navigate", { tabId, url }).catch((err) => {
          setError(typeof err === "string" ? err : "Navigation failed");
        });
      }
    },
    [tabId, urlInput],
  );

  /** Refresh the current page. */
  const handleRefresh = useCallback(() => {
    invoke("browser_navigate", { tabId, url: currentUrl }).catch(() => {
      // Ignore
    });
  }, [tabId, currentUrl]);

  /** Handle URL input key events. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        setUrlInput(currentUrl);
      }
    },
    [currentUrl],
  );

  return (
    <div
      className="browser-view"
      data-testid="browser-view"
      data-tab-id={tabId}
    >
      {/* URL bar */}
      <div className="browser-toolbar" data-testid="browser-toolbar">
        <button
          className="browser-nav-btn"
          onClick={handleRefresh}
          aria-label="Refresh"
          title="Refresh"
          type="button"
          data-testid="browser-refresh-btn"
        >
          ↻
        </button>
        <form
          className="browser-url-form"
          onSubmit={handleNavigate}
        >
          <input
            className="browser-url-input"
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL..."
            aria-label="URL"
            data-testid="browser-url-input"
          />
          <button
            className="browser-go-btn"
            type="submit"
            aria-label="Go"
            data-testid="browser-go-btn"
          >
            →
          </button>
        </form>
      </div>

      {/* Webview placeholder — native webview overlays this area */}
      <div
        ref={containerRef}
        className="browser-content"
        data-testid="browser-content"
      >
        {isLoading && (
          <div className="browser-loading" data-testid="browser-loading">
            Loading...
          </div>
        )}
        {error && (
          <div className="browser-error" data-testid="browser-error">
            <p>{error}</p>
            <button onClick={handleRefresh} type="button">
              Retry
            </button>
          </div>
        )}
        {!isLoading && !error && (
          <div className="browser-placeholder" data-testid="browser-placeholder">
            {/* Native webview renders on top of this area */}
          </div>
        )}
      </div>
    </div>
  );
}
