/// IPC commands for browser webview operations.
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder};

use crate::browser::BrowserManager;

fn validate_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported URL scheme: {scheme}")),
    }
}

#[tauri::command]
pub fn browser_open(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
    url: String,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    let parsed_url = validate_url(&url)?;
    let label = format!("browser-{}", tab_id);

    // If window already exists, bring to front and navigate
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        existing.navigate(parsed_url).map_err(|e| format!("Navigation failed: {e}"))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url))
        .title("Putz Browser")
        .inner_size(900.0, 700.0)
        .build()
        .map_err(|e| format!("Failed to create browser: {e}"))?;

    state.register(&tab_id, &label);
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
    url: String,
) -> Result<(), String> {
    let parsed_url = validate_url(&url)?;
    let label = state.get_label(&tab_id)
        .ok_or_else(|| format!("No browser for tab {tab_id}"))?;
    let webview = app.get_webview_window(&label)
        .ok_or_else(|| format!("Window '{label}' not found"))?;
    webview.navigate(parsed_url).map_err(|e| format!("Navigation failed: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn browser_close(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
) -> Result<(), String> {
    let label = match state.unregister(&tab_id) {
        Some(l) => l,
        None => return Ok(()),
    };
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| format!("Failed to close: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn browser_resize(
    _app: AppHandle,
    _state: State<'_, BrowserManager>,
    _tab_id: String,
    _x: f64,
    _y: f64,
    _width: f64,
    _height: f64,
) -> Result<(), String> {
    // No-op for separate windows — they manage their own size
    Ok(())
}

#[tauri::command]
pub fn browser_set_visible(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
    visible: bool,
) -> Result<(), String> {
    let label = state.get_label(&tab_id)
        .ok_or_else(|| format!("No browser for tab {tab_id}"))?;
    let window = app.get_webview_window(&label)
        .ok_or_else(|| format!("Window '{label}' not found"))?;
    if visible { window.show().map_err(|e| e.to_string())?; }
    else { window.hide().map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_url_accepts_https() { assert!(validate_url("https://example.com").is_ok()); }
    #[test]
    fn validate_url_rejects_javascript() { assert!(validate_url("javascript:alert(1)").is_err()); }
    #[test]
    fn validate_url_rejects_file() { assert!(validate_url("file:///etc/passwd").is_err()); }
}
