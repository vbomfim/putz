/// Script recorder — captures keystrokes and generates automation scripts.
///
/// Records user input to a terminal session and generates JavaScript
/// scripts with `putz.send()` and `putz.waitFor()` calls.
///
/// Keystroke merging: Rapid sequential characters are merged into a
/// single `putz.send("combined text")` call. An Enter key (carriage
/// return) triggers a `putz.waitFor()` after the command.
use std::time::Instant;

/// Time threshold for merging keystrokes (milliseconds).
/// Keystrokes within this window are combined into one `send()` call.
const MERGE_THRESHOLD_MS: u128 = 200;

/// A recorded keystroke event.
#[derive(Debug, Clone)]
struct KeystrokeEvent {
    /// The input data (could be a single char or control sequence).
    data: String,
    /// When the keystroke was recorded.
    timestamp: Instant,
}

/// Active recording session.
#[derive(Debug)]
pub struct ScriptRecorder {
    /// Session ID being recorded.
    session_id: String,
    /// Accumulated keystroke events.
    events: Vec<KeystrokeEvent>,
    /// When recording started.
    started_at: Instant,
}

impl ScriptRecorder {
    /// Creates a new recorder for the given session.
    pub fn new(session_id: &str) -> Self {
        Self {
            session_id: session_id.to_string(),
            events: Vec::new(),
            started_at: Instant::now(),
        }
    }

    /// Records a keystroke event.
    pub fn record_keystroke(&mut self, data: &str) {
        self.events.push(KeystrokeEvent {
            data: data.to_string(),
            timestamp: Instant::now(),
        });
    }

    /// Returns the session ID being recorded.
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    /// Generates a JavaScript script from the recorded keystrokes.
    ///
    /// Merges rapid sequential characters and adds `waitFor()` calls
    /// after commands (Enter key presses).
    pub fn generate_script(&self) -> String {
        if self.events.is_empty() {
            return "// Empty recording — no keystrokes captured\n".to_string();
        }

        let mut lines = Vec::new();
        lines.push(format!(
            "// Recorded script for session: {}",
            self.session_id
        ));
        lines.push(format!(
            "// Recorded at: {}",
            chrono::Utc::now().to_rfc3339()
        ));
        lines.push(String::new());

        let mut current_text = String::new();
        let mut prev_timestamp: Option<Instant> = None;

        for event in &self.events {
            let is_enter = event.data == "\r" || event.data == "\n" || event.data == "\r\n";

            let should_flush = if let Some(prev) = prev_timestamp {
                let elapsed = event.timestamp.duration_since(prev).as_millis();
                elapsed > MERGE_THRESHOLD_MS || is_enter
            } else {
                is_enter
            };

            if should_flush && !current_text.is_empty() {
                // Emit the accumulated text as a send()
                let escaped = escape_js_string(&current_text);
                lines.push(format!("putz.send('{escaped}');"));
                current_text.clear();
            }

            if is_enter {
                // Enter key: emit send with the Enter, then a waitFor
                if !current_text.is_empty() {
                    let escaped = escape_js_string(&current_text);
                    lines.push(format!("putz.send('{escaped}');"));
                    current_text.clear();
                }
                // Add a waitFor for the prompt (user can customize)
                lines.push(
                    "putz.waitFor('>', 10000); // Adjust prompt pattern and timeout".to_string(),
                );
                lines.push(String::new());
            } else if is_control_sequence(&event.data) {
                // Control sequences get their own send()
                if !current_text.is_empty() {
                    let escaped = escape_js_string(&current_text);
                    lines.push(format!("putz.send('{escaped}');"));
                    current_text.clear();
                }
                let escaped = escape_js_string(&event.data);
                lines.push(format!("putz.send('{escaped}'); // Control sequence"));
            } else {
                // Regular character — accumulate
                current_text.push_str(&event.data);
            }

            prev_timestamp = Some(event.timestamp);
        }

        // Flush any remaining text
        if !current_text.is_empty() {
            let escaped = escape_js_string(&current_text);
            lines.push(format!("putz.send('{escaped}');"));
        }

        lines.push(String::new());
        lines.push("putz.log('Script completed');".to_string());

        lines.join("\n")
    }
}

/// Escapes a string for use in a JavaScript single-quoted string literal.
fn escape_js_string(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\'' => result.push_str("\\'"),
            '\\' => result.push_str("\\\\"),
            '\n' => result.push_str("\\n"),
            '\r' => result.push_str("\\r"),
            '\t' => result.push_str("\\t"),
            '\x08' => result.push_str("\\x08"), // Backspace
            '\x1b' => result.push_str("\\x1b"), // Escape
            '\x7f' => result.push_str("\\x7f"), // Delete
            c if c.is_control() => {
                result.push_str(&format!("\\x{:02x}", c as u32));
            }
            _ => result.push(c),
        }
    }
    result
}

/// Checks if a string is a terminal control sequence (ESC, Ctrl+, etc.).
fn is_control_sequence(data: &str) -> bool {
    if data.is_empty() {
        return false;
    }
    let first = data.as_bytes()[0];
    // ESC sequences, Ctrl+A through Ctrl+Z (except common ones)
    first == 0x1b || (first < 0x20 && first != b'\r' && first != b'\n')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorder_new_creates_empty_recorder() {
        let rec = ScriptRecorder::new("sess-1");
        assert_eq!(rec.session_id(), "sess-1");
        assert!(rec.events.is_empty());
    }

    #[test]
    fn recorder_empty_generates_comment() {
        let rec = ScriptRecorder::new("sess-1");
        let script = rec.generate_script();
        assert!(script.contains("Empty recording"));
    }

    #[test]
    fn recorder_single_command_with_enter() {
        let mut rec = ScriptRecorder::new("sess-1");
        rec.record_keystroke("s");
        rec.record_keystroke("h");
        rec.record_keystroke("o");
        rec.record_keystroke("w");
        rec.record_keystroke(" ");
        rec.record_keystroke("v");
        rec.record_keystroke("e");
        rec.record_keystroke("r");
        rec.record_keystroke("\r");

        let script = rec.generate_script();
        assert!(script.contains("putz.send('show ver');"));
        assert!(script.contains("putz.waitFor('>'"));
    }

    #[test]
    fn recorder_multiple_commands() {
        let mut rec = ScriptRecorder::new("sess-1");

        // First command
        rec.record_keystroke("e");
        rec.record_keystroke("n");
        rec.record_keystroke("\r");

        // Second command (after a short delay in real usage)
        rec.record_keystroke("c");
        rec.record_keystroke("o");
        rec.record_keystroke("n");
        rec.record_keystroke("f");
        rec.record_keystroke(" ");
        rec.record_keystroke("t");
        rec.record_keystroke("\r");

        let script = rec.generate_script();
        assert!(script.contains("putz.send('en');"));
        assert!(script.contains("putz.send('conf t');"));
        assert_eq!(
            script.matches("putz.waitFor('>'").count(),
            2,
            "Should have two waitFor calls"
        );
    }

    #[test]
    fn recorder_control_sequence_gets_own_send() {
        let mut rec = ScriptRecorder::new("sess-1");
        rec.record_keystroke("t");
        rec.record_keystroke("e");
        rec.record_keystroke("s");
        rec.record_keystroke("t");
        rec.record_keystroke("\x03"); // Ctrl+C

        let script = rec.generate_script();
        assert!(script.contains("putz.send('test');"));
        assert!(script.contains("Control sequence"));
    }

    // ─── escape_js_string tests ────────────────────────────────

    #[test]
    fn escape_single_quote() {
        assert_eq!(escape_js_string("it's"), "it\\'s");
    }

    #[test]
    fn escape_backslash() {
        assert_eq!(escape_js_string("a\\b"), "a\\\\b");
    }

    #[test]
    fn escape_newline() {
        assert_eq!(escape_js_string("a\nb"), "a\\nb");
    }

    #[test]
    fn escape_carriage_return() {
        assert_eq!(escape_js_string("a\rb"), "a\\rb");
    }

    #[test]
    fn escape_tab() {
        assert_eq!(escape_js_string("a\tb"), "a\\tb");
    }

    #[test]
    fn escape_esc_char() {
        assert_eq!(escape_js_string("\x1b[31m"), "\\x1b[31m");
    }

    #[test]
    fn escape_plain_text_unchanged() {
        assert_eq!(escape_js_string("show version"), "show version");
    }

    // ─── is_control_sequence tests ─────────────────────────────

    #[test]
    fn control_esc_is_detected() {
        assert!(is_control_sequence("\x1b[A"));
    }

    #[test]
    fn control_ctrl_c_is_detected() {
        assert!(is_control_sequence("\x03"));
    }

    #[test]
    fn control_cr_is_not_control() {
        assert!(!is_control_sequence("\r"));
    }

    #[test]
    fn control_lf_is_not_control() {
        assert!(!is_control_sequence("\n"));
    }

    #[test]
    fn control_regular_text_not_control() {
        assert!(!is_control_sequence("hello"));
    }

    #[test]
    fn control_empty_not_control() {
        assert!(!is_control_sequence(""));
    }
}
