//! Browser webview manager — manages native child webviews for browser tabs.
//!
//! Each browser tab creates a child webview overlaid on the main window at
//! a specific position and size. The webview loads an external URL and can
//! be navigated, resized, shown/hidden, or destroyed.
//!
//! Uses Tauri 2.0's multi-webview API (`Window::add_child`) which requires
//! the `unstable` feature flag on the `tauri` crate.

use std::collections::HashMap;
use std::sync::Mutex;

/// Tracks active browser webview labels by tab ID.
///
/// We store the webview label (string identifier) rather than the webview
/// handle itself, because Tauri's WebviewWindow handles are not Send+Sync
/// in all contexts. We retrieve the webview from the AppHandle when needed.
pub struct BrowserManager {
    /// Maps tab ID → webview label.
    webviews: Mutex<HashMap<String, String>>,
}

impl BrowserManager {
    /// Creates a new empty browser manager.
    pub fn new() -> Self {
        Self {
            webviews: Mutex::new(HashMap::new()),
        }
    }

    /// Registers a webview for a tab.
    pub fn register(&self, tab_id: &str, label: &str) {
        let mut map = self.webviews.lock().unwrap();
        map.insert(tab_id.to_string(), label.to_string());
    }

    /// Removes a webview registration for a tab. Returns the label if found.
    pub fn unregister(&self, tab_id: &str) -> Option<String> {
        let mut map = self.webviews.lock().unwrap();
        map.remove(tab_id)
    }

    /// Gets the webview label for a tab, if registered.
    pub fn get_label(&self, tab_id: &str) -> Option<String> {
        let map = self.webviews.lock().unwrap();
        map.get(tab_id).cloned()
    }

    /// Returns the number of active browser webviews.
    #[cfg(test)]
    pub fn count(&self) -> usize {
        let map = self.webviews.lock().unwrap();
        map.len()
    }

    /// Returns all registered webview labels.
    pub fn all_labels(&self) -> Vec<String> {
        let map = self.webviews.lock().unwrap();
        map.values().cloned().collect()
    }

    /// Closes all tracked webviews. Called on app shutdown.
    pub fn close_all(&self) {
        let mut map = self.webviews.lock().unwrap();
        map.clear();
    }
}

impl Default for BrowserManager {
    fn default() -> Self {
        Self::new()
    }
}

// ─── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_manager_is_empty() {
        let mgr = BrowserManager::new();
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn register_and_get_label() {
        let mgr = BrowserManager::new();
        mgr.register("tab-1", "browser-webview-tab-1");
        assert_eq!(
            mgr.get_label("tab-1"),
            Some("browser-webview-tab-1".to_string())
        );
    }

    #[test]
    fn unregister_removes_entry() {
        let mgr = BrowserManager::new();
        mgr.register("tab-1", "browser-webview-tab-1");
        let label = mgr.unregister("tab-1");
        assert_eq!(label, Some("browser-webview-tab-1".to_string()));
        assert_eq!(mgr.get_label("tab-1"), None);
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn unregister_nonexistent_returns_none() {
        let mgr = BrowserManager::new();
        assert_eq!(mgr.unregister("tab-999"), None);
    }

    #[test]
    fn get_label_nonexistent_returns_none() {
        let mgr = BrowserManager::new();
        assert_eq!(mgr.get_label("tab-999"), None);
    }

    #[test]
    fn close_all_clears_everything() {
        let mgr = BrowserManager::new();
        mgr.register("tab-1", "wv-1");
        mgr.register("tab-2", "wv-2");
        mgr.register("tab-3", "wv-3");
        assert_eq!(mgr.count(), 3);

        mgr.close_all();
        assert_eq!(mgr.count(), 0);
    }

    #[test]
    fn multiple_tabs_are_independent() {
        let mgr = BrowserManager::new();
        mgr.register("tab-a", "wv-a");
        mgr.register("tab-b", "wv-b");

        assert_eq!(mgr.get_label("tab-a"), Some("wv-a".to_string()));
        assert_eq!(mgr.get_label("tab-b"), Some("wv-b".to_string()));
        assert_eq!(mgr.count(), 2);

        mgr.unregister("tab-a");
        assert_eq!(mgr.get_label("tab-a"), None);
        assert_eq!(mgr.get_label("tab-b"), Some("wv-b".to_string()));
        assert_eq!(mgr.count(), 1);
    }

    #[test]
    fn register_overwrites_existing() {
        let mgr = BrowserManager::new();
        mgr.register("tab-1", "wv-old");
        mgr.register("tab-1", "wv-new");
        assert_eq!(mgr.get_label("tab-1"), Some("wv-new".to_string()));
        assert_eq!(mgr.count(), 1);
    }
}
