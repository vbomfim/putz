//! Application menu bar — native Tauri menus for macOS/Windows/Linux.
//!
//! Builds the full application menu hierarchy using Tauri 2.0's Menu API.
//! Each menu item has a string ID that is emitted as a `menu-event` to
//! the frontend via `app.emit()`.
//!
//! Menu structure:
//! File | Edit | View | Session | Tools | Window | Help

use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Wry};

/// Payload emitted to the frontend on menu events.
#[derive(Clone, serde::Serialize)]
struct MenuEventPayload {
    id: String,
}

/// Helper to create a menu item with ID, label, and optional accelerator.
macro_rules! menu_item {
    ($app:expr, $id:expr, $label:expr) => {
        MenuItemBuilder::with_id($id, $label).build($app)?
    };
    ($app:expr, $id:expr, $label:expr, $accel:expr) => {
        MenuItemBuilder::with_id($id, $label)
            .accelerator($accel)
            .build($app)?
    };
}

/// Builds the complete application menu bar.
///
/// # Errors
/// Returns a `tauri::Error` if menu construction fails.
pub fn build_menu(app: &AppHandle<Wry>) -> Result<tauri::menu::Menu<Wry>, tauri::Error> {
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&menu_item!(
            app,
            "menu-new-terminal",
            "New Terminal",
            "CmdOrCtrl+T"
        ))
        .item(&menu_item!(
            app,
            "menu-open-file",
            "Open File...",
            "CmdOrCtrl+O"
        ))
        .separator()
        .item(&menu_item!(
            app,
            "menu-close-tab",
            "Close Tab",
            "CmdOrCtrl+Shift+W"
        ))
        .item(&menu_item!(app, "menu-close-all-tabs", "Close All Tabs"))
        .separator()
        .item(&menu_item!(app, "menu-exit", "Exit", "CmdOrCtrl+Q"))
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&menu_item!(
            app,
            "menu-copy",
            "Terminal Copy",
            "CmdOrCtrl+Shift+C"
        ))
        .item(&menu_item!(
            app,
            "menu-paste",
            "Terminal Paste",
            "CmdOrCtrl+Shift+V"
        ))
        .item(&menu_item!(app, "menu-select-all", "Terminal Select All"))
        .separator()
        .item(&menu_item!(app, "menu-find", "Find...", "CmdOrCtrl+F"))
        .separator()
        .item(&menu_item!(
            app,
            "menu-preferences",
            "Preferences...",
            "CmdOrCtrl+,"
        ))
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&menu_item!(
            app,
            "menu-toggle-sidebar",
            "Toggle Sidebar",
            "CmdOrCtrl+B"
        ))
        .separator()
        .item(&menu_item!(
            app,
            "menu-split-vertical",
            "Split Vertical",
            "CmdOrCtrl+Shift+E"
        ))
        .item(&menu_item!(
            app,
            "menu-split-horizontal",
            "Split Horizontal",
            "CmdOrCtrl+Shift+D"
        ))
        .item(&menu_item!(app, "menu-unsplit-pane", "Unsplit Pane"))
        .separator()
        .item(&menu_item!(
            app,
            "menu-toggle-highlighting",
            "Toggle Highlighting",
            "CmdOrCtrl+Shift+H"
        ))
        .item(&menu_item!(
            app,
            "menu-toggle-broadcast",
            "Toggle Broadcast",
            "CmdOrCtrl+Shift+A"
        ))
        .separator()
        .item(&menu_item!(app, "menu-zoom-in", "Zoom In", "CmdOrCtrl+="))
        .item(&menu_item!(app, "menu-zoom-out", "Zoom Out", "CmdOrCtrl+-"))
        .item(&menu_item!(
            app,
            "menu-reset-zoom",
            "Reset Zoom",
            "CmdOrCtrl+0"
        ))
        .separator()
        .item(&menu_item!(app, "menu-full-screen", "Full Screen", "F11"))
        .separator()
        .item(&menu_item!(app, "menu-theme-editor", "Color Theme..."))
        .item(&menu_item!(app, "menu-font-config", "Font Settings..."))
        .separator()
        .item(&menu_item!(
            app,
            "menu-toggle-workspace-bar",
            "Toggle Workspace Bar"
        ))
        .item(&menu_item!(
            app,
            "menu-toggle-bookmarks-bar",
            "Toggle Bookmarks Bar"
        ))
        .build()?;

    // ─── Bookmarks ─────────────────────────────────────────
    //
    // The "Add Bookmark" item intentionally has NO accelerator.
    // Reason: macOS menu accelerators fire before DOM keydown events
    // and ignore DOM focus state. This means the xterm guard
    // (bail when .xterm is focused) cannot run — Ctrl+D would
    // always add a bookmark instead of sending EOF to the terminal.
    // The DOM keydown handler in useKeyboardShortcuts.ts owns
    // the Cmd+D / Ctrl+D shortcut with the focus check.
    let bookmarks_menu = SubmenuBuilder::new(app, "Bookmarks")
        .item(&menu_item!(
            app,
            "menu-toggle-bookmarks-bar",
            "Toggle Bookmarks Bar",
            "CmdOrCtrl+Shift+J"
        ))
        .separator()
        .item(&menu_item!(app, "menu-add-bookmark", "Add Bookmark"))
        .item(&menu_item!(
            app,
            "menu-manage-bookmarks",
            "Manage Bookmarks…"
        ))
        .build()?;

    let tools_menu = SubmenuBuilder::new(app, "Tools")
        .item(&menu_item!(app, "menu-script-editor", "Script Editor"))
        .separator()
        .item(&menu_item!(
            app,
            "menu-git-graph",
            "Git Graph",
            "CmdOrCtrl+Shift+G"
        ))
        .separator()
        .item(&menu_item!(app, "menu-radio", "Radio", "CmdOrCtrl+Shift+R"))
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&menu_item!(app, "menu-new-window", "New Window"))
        .item(&menu_item!(
            app,
            "menu-pop-out-tab",
            "Pop Out Tab",
            "CmdOrCtrl+Shift+P"
        ))
        .separator()
        .item(&menu_item!(
            app,
            "menu-tile-horizontally",
            "Tile Horizontally"
        ))
        .item(&menu_item!(app, "menu-tile-vertically", "Tile Vertically"))
        .item(&menu_item!(app, "menu-cascade", "Cascade"))
        .separator()
        .item(&menu_item!(
            app,
            "menu-next-tab",
            "Next Tab",
            "CmdOrCtrl+Tab"
        ))
        .item(&menu_item!(
            app,
            "menu-previous-tab",
            "Previous Tab",
            "CmdOrCtrl+Shift+Tab"
        ))
        .build()?;

    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("Putz"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .short_version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some(
            "A local developer terminal with a Canvas tab and a Git Graph tab",
        ))
        .license(Some("MIT"))
        .build();

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Putz"),
            Some(about_metadata),
        )?)
        .item(&menu_item!(app, "menu-documentation", "Documentation"))
        .item(&menu_item!(
            app,
            "menu-keyboard-shortcuts",
            "Keyboard Shortcuts"
        ))
        .item(&menu_item!(app, "menu-check-updates", "Check for Updates"))
        .separator()
        .item(&menu_item!(
            app,
            "menu-report-issue",
            "Report Issue (GitHub)"
        ))
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&bookmarks_menu)
        .item(&tools_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}

/// Handles a menu event by emitting it to the frontend.
///
/// Called from `on_menu_event` in `lib.rs`. Emits a `menu-event` to
/// the webview with the menu item ID as the payload.
pub fn handle_menu_event(app: &AppHandle<Wry>, event: &tauri::menu::MenuEvent) {
    let id = event.id().0.clone();
    let _ = app.emit("menu-event", MenuEventPayload { id });
}

// ─── Tests ────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_event_payload_serializes_correctly() {
        let payload = MenuEventPayload {
            id: "menu-new-terminal".to_string(),
        };
        let json = serde_json::to_string(&payload).unwrap();
        assert!(json.contains("menu-new-terminal"));
    }

    #[test]
    fn menu_event_payload_contains_id_field() {
        let payload = MenuEventPayload {
            id: "menu-toggle-bookmarks-bar".to_string(),
        };
        let json = serde_json::to_value(&payload).unwrap();
        assert_eq!(json["id"], "menu-toggle-bookmarks-bar");
    }

    /// Verifies the menu_item! macro creates valid string IDs.
    #[test]
    fn menu_item_ids_are_valid_strings() {
        let ids = [
            "menu-new-terminal",
            "menu-close-tab",
            "menu-toggle-bookmarks-bar",
            "menu-split-vertical",
            "menu-keyboard-shortcuts",
            "menu-add-bookmark",
        ];
        for id in ids {
            assert!(!id.is_empty(), "Menu item ID should not be empty");
            assert!(
                id.starts_with("menu-"),
                "Menu item ID should start with 'menu-'"
            );
            assert!(
                id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'),
                "Menu item ID '{id}' should only contain alphanumeric chars and hyphens"
            );
        }
    }
}
