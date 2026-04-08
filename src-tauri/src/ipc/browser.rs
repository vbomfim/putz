/// IPC commands for browser webview operations.
///
/// These are the Tauri command handlers invoked from the React frontend
/// via `@tauri-apps/api/core`'s `invoke()`. Each command manages native
/// child webviews overlaid on the main window for browser tabs.
///
/// Security: URLs are validated before loading. Only http/https schemes
/// are allowed for external content.
use tauri::{AppHandle, Manager, State, Url, WebviewBuilder, WebviewUrl};

use crate::browser::BrowserManager;

/// Validates that a URL is safe to load (http or https only).
fn validate_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported URL scheme: {scheme}. Only http and https are allowed.")),
    }
}

/// Opens a new browser webview as a child of the main window.
///
/// Creates a native webview positioned at the given coordinates.
/// The webview loads the specified URL and is tracked by tab ID.
#[tauri::command]
pub fn browser_open(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let parsed_url = validate_url(&url)?;

    // Generate a unique webview label from the tab ID
    let label = format!("browser-{}", tab_id);

    // Get the main window — try both Tauri 2.0 window access methods
    let window = app
        .get_window("main")
        .or_else(|| {
            // Fallback: get the first available window
            app.windows().into_values().next()
        })
        .ok_or_else(|| "No window found".to_string())?;

    // Create a child webview positioned over the placeholder div
    let webview_url = WebviewUrl::External(parsed_url);
    let builder = WebviewBuilder::new(&label, webview_url);

    window
        .add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Failed to create browser webview: {e}"))?;

    // Track the webview
    state.register(&tab_id, &label);

    Ok(())
}

/// Navigates an existing browser webview to a new URL.
#[tauri::command]
pub fn browser_navigate(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let parsed_url = validate_url(&url)?;

    let label = state
        .get_label(&tab_id)
        .ok_or_else(|| format!("No browser webview found for tab {tab_id}"))?;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' not found"))?;

    webview
        .navigate(parsed_url)
        .map_err(|e| format!("Navigation failed: {e}"))?;

    Ok(())
}

/// Closes and destroys a browser webview.
#[tauri::command]
pub fn browser_close(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
) -> Result<(), String> {
    let label = match state.unregister(&tab_id) {
        Some(l) => l,
        None => return Ok(()), // Already closed or never opened
    };

    if let Some(webview) = app.get_webview(&label) {
        webview.close().map_err(|e| format!("Failed to close webview: {e}"))?;
    }

    Ok(())
}

/// Repositions and resizes a browser webview.
///
/// Called when the container div changes size (e.g., window resize,
/// split pane adjustment).
#[tauri::command]
pub fn browser_resize(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = state
        .get_label(&tab_id)
        .ok_or_else(|| format!("No browser webview found for tab {tab_id}"))?;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' not found"))?;

    webview
        .set_position(tauri::LogicalPosition::new(x, y))
        .map_err(|e| format!("Failed to reposition webview: {e}"))?;

    webview
        .set_size(tauri::LogicalSize::new(width, height))
        .map_err(|e| format!("Failed to resize webview: {e}"))?;

    Ok(())
}

/// Shows or hides a browser webview.
///
/// Used when switching tabs — hide webviews for inactive tabs,
/// show for the active tab. Critical because Tauri webviews are
/// native overlays that float above the React DOM.
#[tauri::command]
pub fn browser_set_visible(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
    visible: bool,
) -> Result<(), String> {
    let label = state
        .get_label(&tab_id)
        .ok_or_else(|| format!("No browser webview found for tab {tab_id}"))?;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview '{label}' not found"))?;

    if visible {
        webview
            .show()
            .map_err(|e| format!("Failed to show webview: {e}"))?;
    } else {
        webview
            .hide()
            .map_err(|e| format!("Failed to hide webview: {e}"))?;
    }

    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_url_accepts_https() {
        let result = validate_url("https://example.com");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_url_accepts_http() {
        let result = validate_url("http://10.0.0.1:3000/dashboard");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_url_rejects_javascript_scheme() {
        let result = validate_url("javascript:alert(1)");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported URL scheme"));
    }

    #[test]
    fn validate_url_rejects_file_scheme() {
        let result = validate_url("file:///etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Unsupported URL scheme"));
    }

    #[test]
    fn validate_url_rejects_data_scheme() {
        let result = validate_url("data:text/html,<h1>XSS</h1>");
        assert!(result.is_err());
    }

    #[test]
    fn validate_url_rejects_malformed_url() {
        let result = validate_url("not a url at all");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid URL"));
    }

    #[test]
    fn validate_url_accepts_url_with_path_and_query() {
        let result = validate_url("https://grafana.local:3000/d/abc?from=now-1h");
        assert!(result.is_ok());
        let parsed = result.unwrap();
        assert_eq!(parsed.host_str(), Some("grafana.local"));
        assert_eq!(parsed.port(), Some(3000));
    }
}
