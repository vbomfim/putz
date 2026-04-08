/// IPC commands for browser webview operations.
/// Uses WebviewWindow for pop-out, and attempts WebviewBuilder for in-tab.
use tauri::{AppHandle, Manager, State, Url, WebviewUrl, WebviewWindowBuilder, WebviewBuilder};

use crate::browser::BrowserManager;

fn validate_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("Invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("Unsupported URL scheme: {scheme}")),
    }
}

/// Opens a browser — tries as child webview of main window first, falls back to separate window.
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
    let parsed_url = validate_url(&url)?; let parsed_url2 = validate_url(&url).unwrap();
    let label = format!("browser-{}", tab_id);

    // If window/webview already exists, bring to front
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
        existing.navigate(parsed_url).map_err(|e| format!("Navigation failed: {e}"))?;
        return Ok(());
    }

    if let Some(existing) = app.get_webview(&label) {
        let _ = existing.navigate(parsed_url);
        return Ok(());
    }

    // Try to create as child webview of the main window (embedded in tab)
    let main_window = app.get_window("main");
    if let Some(win) = main_window {
        let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed_url));
        match win.add_child(
            builder,
            tauri::LogicalPosition::new(x, y),
            tauri::LogicalSize::new(width, height),
        ) {
            Ok(_webview) => {
                state.register(&tab_id, &label);
                return Ok(());
            }
            Err(e) => {
                eprintln!("[browser] add_child failed ({}), falling back to window", e);
            }
        }
    }

    // Fallback: open as separate window
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed_url2))
        .title(format!("Putz — {}", url))
        .inner_size(
            if width > 0.0 { width } else { 900.0 },
            if height > 0.0 { height } else { 700.0 },
        )
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
    let parsed_url = validate_url(&url)?; let parsed_url2 = validate_url(&url).unwrap();
    let label = state.get_label(&tab_id)
        .ok_or_else(|| format!("No browser for tab {tab_id}"))?;
    
    // Try webview first (child), then window
    if let Some(wv) = app.get_webview(&label) {
        wv.navigate(parsed_url).map_err(|e| format!("Navigation failed: {e}"))?;
    } else if let Some(win) = app.get_webview_window(&label) {
        win.navigate(parsed_url).map_err(|e| format!("Navigation failed: {e}"))?;
    } else {
        return Err(format!("Browser '{label}' not found"));
    }
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
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.close();
    }
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
    Ok(())
}

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
    let label = state.get_label(&tab_id).ok_or("Not found")?;
    if let Some(wv) = app.get_webview(&label) {
        let _ = wv.set_position(tauri::LogicalPosition::new(x, y));
        let _ = wv.set_size(tauri::LogicalSize::new(width, height));
    }
    Ok(())
}

#[tauri::command]
pub fn browser_set_visible(
    app: AppHandle,
    state: State<'_, BrowserManager>,
    tab_id: String,
    visible: bool,
) -> Result<(), String> {
    let label = state.get_label(&tab_id).ok_or("Not found")?;
    if let Some(wv) = app.get_webview(&label) {
        if visible { let _ = wv.show(); } else { let _ = wv.hide(); }
    }
    if let Some(win) = app.get_webview_window(&label) {
        if visible { let _ = win.show(); } else { let _ = win.hide(); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validate_url_accepts_https() { assert!(validate_url("https://example.com").is_ok()); }
    #[test]
    fn validate_url_rejects_javascript() { assert!(validate_url("javascript:alert(1)").is_err()); }
}
