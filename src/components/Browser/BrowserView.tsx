/**
 * BrowserView — Renders a web page inside the tab using an iframe.
 * "Pop Out" button opens the page in a separate native Tauri window.
 */
import { useCallback, useState } from "react";
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

  const normalizeUrl = (input: string): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
    return `https://${trimmed}`;
  };

  const doNavigate = useCallback(() => {
    const url = normalizeUrl(urlInput);
    if (!url || url.length > MAX_URL_LENGTH) return;
    setCurrentUrl(url);
    setUrlInput(url);
    setError(null);
  }, [urlInput]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      doNavigate();
    }
    if (e.key === "Escape") {
      setUrlInput(currentUrl);
    }
  }, [doNavigate, currentUrl]);

  const handlePopOut = useCallback(() => {
    const url = currentUrl || normalizeUrl(urlInput);
    if (!url) return;
    invoke("browser_open", {
      tabId: browserId, url,
      x: 0, y: 0, width: 900, height: 700,
    }).catch((err) => {
      setError(typeof err === "string" ? err : "Failed to open browser window");
    });
  }, [browserId, currentUrl, urlInput]);

  return (
    <div className="browser-view" data-testid="browser-view" style={{ display: isActive ? "flex" : "none", flex: 1, flexDirection: "column" }}>
      {/* URL bar */}
      <div className="browser-toolbar">
        <button className="browser-nav-btn" onClick={doNavigate} type="button" title="Go / Refresh">↻</button>
        <div className="browser-url-form">
          <input
            className="browser-url-input"
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL and press Enter..."
            aria-label="URL"
          />
          <button className="browser-go-btn" type="button" onClick={doNavigate} title="Go">→</button>
          <button className="browser-nav-btn" type="button" onClick={handlePopOut} title="Pop out to native window" style={{ fontSize: "11px" }}>⇱</button>
          {onClose && (
            <button className="browser-nav-btn browser-close-pane-btn" onClick={onClose} type="button" title="Close" style={{ color: "#f38ba8" }}>✕</button>
          )}
        </div>
      </div>

      {/* Content: iframe or empty state */}
      {error && <div className="browser-error">{error}</div>}
      {currentUrl ? (
        <iframe
          src={currentUrl}
          className="browser-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          allow="clipboard-read; clipboard-write"
          title="Browser"
          style={{ flex: 1, border: "none", width: "100%", background: "#fff" }}
        />
      ) : (
        <div className="browser-empty">
          <p style={{ color: "rgba(205,214,244,0.5)", fontSize: "14px" }}>Type a URL above and press Enter</p>
        </div>
      )}
    </div>
  );
}
