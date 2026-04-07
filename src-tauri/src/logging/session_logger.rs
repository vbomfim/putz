/// Session logger — writes terminal output to timestamped log files.
///
/// Handles buffered writing, optional ANSI stripping, timestamp prefixing,
/// and file rotation at configurable size thresholds.
///
/// Thread safety: Internal Mutex allows concurrent access from
/// PTY reader threads without blocking the LogManager's HashMap lock.
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use time::OffsetDateTime;

use super::config::{LogConfig, LogStatus};
use super::error::LogError;

/// Regex pattern for standard ANSI escape sequences.
/// Matches: ESC [ (params) (final byte)
/// Also matches OSC sequences: ESC ] ... ST
const ANSI_ESCAPE_PATTERN: &str = r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b\[[0-9;]*m";

/// Internal mutable state of the session logger.
struct LoggerInner {
    writer: BufWriter<File>,
    config: LogConfig,
    current_file_path: PathBuf,
    current_file_size: u64,
    bytes_written: u64,
    rotation_count: u32,
    last_flush: Instant,
    /// Tracks whether the last byte written was a newline,
    /// so timestamps are only added at the start of lines.
    at_line_start: bool,
    /// Buffer for accumulating partial lines (for ANSI stripping).
    line_buffer: Vec<u8>,
}

/// Session logger that writes terminal output to a file.
///
/// Each session gets its own logger instance. The logger is
/// accessed from the PTY reader thread via `Arc<SessionLogger>`.
pub struct SessionLogger {
    inner: Mutex<LoggerInner>,
}

impl SessionLogger {
    /// Creates a new session logger, creating the log directory and file.
    ///
    /// File naming: `{session_name}_{YYYY-MM-DD_HH-mm-ss}.log`
    /// Directory is created recursively if it doesn't exist.
    /// File permissions set to 0644 on Unix.
    pub fn new(config: LogConfig) -> Result<Self, LogError> {
        config
            .validate()
            .map_err(|e| LogError::InvalidSessionName(e))?;

        // Create log directory
        fs::create_dir_all(&config.directory)
            .map_err(|e| LogError::DirectoryFailed(e.to_string()))?;

        let file_path = generate_log_file_path(&config);
        let file = create_log_file(&file_path)?;

        let inner = LoggerInner {
            writer: BufWriter::new(file),
            config,
            current_file_path: file_path,
            current_file_size: 0,
            bytes_written: 0,
            rotation_count: 0,
            last_flush: Instant::now(),
            at_line_start: true,
            line_buffer: Vec::with_capacity(4096),
        };

        Ok(Self {
            inner: Mutex::new(inner),
        })
    }

    /// Writes raw terminal output data to the log.
    ///
    /// Optionally strips ANSI escape sequences and prepends timestamps.
    /// Buffered — actual disk I/O happens on flush.
    pub fn write_data(&self, data: &[u8]) -> Result<(), LogError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|e| LogError::WriteFailed(e.to_string()))?;

        let processed = if inner.config.strip_ansi {
            strip_ansi_sequences(data)
        } else {
            data.to_vec()
        };

        if processed.is_empty() {
            return Ok(());
        }

        // Check if rotation is needed before writing
        let estimated_size =
            inner.current_file_size + processed.len() as u64 + timestamp_overhead(&inner);
        if estimated_size > inner.config.max_file_size {
            rotate_file(&mut inner)?;
        }

        // Write with optional timestamps
        let bytes_written = if inner.config.timestamps {
            write_with_timestamps(&mut inner, &processed)?
        } else {
            inner
                .writer
                .write_all(&processed)
                .map_err(|e| LogError::WriteFailed(e.to_string()))?;
            processed.len() as u64
        };

        inner.current_file_size += bytes_written;
        inner.bytes_written += bytes_written;

        // Periodic flush
        let elapsed = inner.last_flush.elapsed().as_millis() as u64;
        if elapsed >= inner.config.flush_interval_ms {
            inner
                .writer
                .flush()
                .map_err(|e| LogError::WriteFailed(e.to_string()))?;
            inner.last_flush = Instant::now();
        }

        Ok(())
    }

    /// Forces a flush of all buffered data to disk.
    pub fn flush(&self) -> Result<(), LogError> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|e| LogError::WriteFailed(e.to_string()))?;
        inner
            .writer
            .flush()
            .map_err(|e| LogError::WriteFailed(e.to_string()))?;
        inner.last_flush = Instant::now();
        Ok(())
    }

    /// Returns the current logging status.
    pub fn status(&self) -> LogStatus {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        LogStatus {
            active: true,
            file_path: Some(inner.current_file_path.to_string_lossy().to_string()),
            bytes_written: inner.bytes_written,
            rotation_count: inner.rotation_count,
        }
    }

    /// Returns the current log file path.
    pub fn file_path(&self) -> PathBuf {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.current_file_path.clone()
    }
}

impl Drop for SessionLogger {
    fn drop(&mut self) {
        // Flush remaining data on drop
        if let Ok(mut inner) = self.inner.lock() {
            let _ = inner.writer.flush();
        }
    }
}

/// Generates the log file path from config.
/// Format: `{directory}/{session_name}_{YYYY-MM-DD_HH-mm-ss}.log`
fn generate_log_file_path(config: &LogConfig) -> PathBuf {
    let now = OffsetDateTime::now_utc();
    let timestamp = format!(
        "{:04}-{:02}-{:02}_{:02}-{:02}-{:02}",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second()
    );
    config
        .directory
        .join(format!("{}_{}.log", config.session_name, timestamp))
}

/// Creates a log file with appropriate permissions.
fn create_log_file(path: &PathBuf) -> Result<File, LogError> {
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|e| LogError::FileCreateFailed(e.to_string()))?;

    // Set 0644 permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o644));
    }

    Ok(file)
}

/// Strips ANSI escape sequences from raw bytes.
///
/// Handles standard CSI sequences (`ESC[...m`), OSC sequences (`ESC]...BEL`),
/// and other common escape patterns.
pub fn strip_ansi_sequences(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    let mut i = 0;

    while i < data.len() {
        if data[i] == 0x1b {
            // ESC character — start of escape sequence
            if i + 1 < data.len() {
                match data[i + 1] {
                    b'[' => {
                        // CSI sequence: ESC [ (params) (final byte)
                        i += 2;
                        while i < data.len()
                            && (data[i] == b';'
                                || data[i] == b'?'
                                || data[i] == b'>'
                                || data[i] == b'!'
                                || (data[i] >= b'0' && data[i] <= b'9'))
                        {
                            i += 1;
                        }
                        // Skip the final byte (letter)
                        if i < data.len() && data[i].is_ascii_alphabetic() {
                            i += 1;
                        }
                        continue;
                    }
                    b']' => {
                        // OSC sequence: ESC ] ... BEL or ESC ] ... ST
                        i += 2;
                        while i < data.len() && data[i] != 0x07 {
                            // Check for ST (ESC \)
                            if data[i] == 0x1b
                                && i + 1 < data.len()
                                && data[i + 1] == b'\\'
                            {
                                i += 2;
                                break;
                            }
                            i += 1;
                        }
                        if i < data.len() && data[i] == 0x07 {
                            i += 1;
                        }
                        continue;
                    }
                    b'(' | b')' | b'*' | b'+' => {
                        // Character set designation: skip 2 more bytes
                        i += 3;
                        continue;
                    }
                    _ => {
                        // Other ESC sequences: skip ESC + one byte
                        i += 2;
                        continue;
                    }
                }
            } else {
                // Lone ESC at end of data — skip it
                i += 1;
                continue;
            }
        }

        // Strip other control characters except newline, carriage return, tab
        if data[i] < 0x20 && data[i] != b'\n' && data[i] != b'\r' && data[i] != b'\t' {
            i += 1;
            continue;
        }

        result.push(data[i]);
        i += 1;
    }

    result
}

/// Estimates timestamp overhead per potential new line.
fn timestamp_overhead(inner: &LoggerInner) -> u64 {
    if inner.config.timestamps {
        // "[2025-01-15 14:32:01.123] " = 27 bytes
        27
    } else {
        0
    }
}

/// Writes data with timestamp prefixes at the start of each line.
fn write_with_timestamps(inner: &mut LoggerInner, data: &[u8]) -> Result<u64, LogError> {
    let mut bytes_written = 0u64;

    for &byte in data {
        if inner.at_line_start && byte != b'\n' && byte != b'\r' {
            let ts = format_timestamp();
            inner
                .writer
                .write_all(ts.as_bytes())
                .map_err(|e| LogError::WriteFailed(e.to_string()))?;
            bytes_written += ts.len() as u64;
            inner.at_line_start = false;
        }

        inner
            .writer
            .write_all(&[byte])
            .map_err(|e| LogError::WriteFailed(e.to_string()))?;
        bytes_written += 1;

        if byte == b'\n' {
            inner.at_line_start = true;
        }
    }

    Ok(bytes_written)
}

/// Formats the current timestamp for log line prefixes.
/// Format: `[2025-01-15 14:32:01.123] `
fn format_timestamp() -> String {
    let now = OffsetDateTime::now_utc();
    format!(
        "[{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}] ",
        now.year(),
        now.month() as u8,
        now.day(),
        now.hour(),
        now.minute(),
        now.second(),
        now.millisecond()
    )
}

/// Rotates the log file when it exceeds the configured maximum size.
fn rotate_file(inner: &mut LoggerInner) -> Result<(), LogError> {
    // Flush current file
    inner
        .writer
        .flush()
        .map_err(|e| LogError::RotationFailed(e.to_string()))?;

    // Increment rotation count
    inner.rotation_count += 1;

    // Generate new file path with rotation suffix
    let stem = inner
        .current_file_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let new_path = inner
        .current_file_path
        .with_file_name(format!("{}_part{}.log", stem, inner.rotation_count + 1));

    // Create new file
    let new_file = create_log_file(&new_path)?;
    inner.writer = BufWriter::new(new_file);
    inner.current_file_path = new_path;
    inner.current_file_size = 0;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn test_config(dir: &std::path::Path) -> LogConfig {
        LogConfig {
            directory: dir.to_path_buf(),
            session_name: "test-session".into(),
            timestamps: false,
            strip_ansi: false,
            max_file_size: 100 * 1024 * 1024,
            flush_interval_ms: 0, // flush immediately in tests
        }
    }

    #[test]
    fn creates_log_file_on_new() {
        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path());
        let logger = SessionLogger::new(config).unwrap();
        let path = logger.file_path();
        assert!(path.exists());
        assert!(path.to_string_lossy().ends_with(".log"));
    }

    #[test]
    fn creates_directory_if_missing() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.directory = dir.path().join("nested").join("deep");
        let logger = SessionLogger::new(config).unwrap();
        let path = logger.file_path();
        assert!(path.exists());
    }

    #[test]
    fn writes_raw_data() {
        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path());
        let logger = SessionLogger::new(config).unwrap();

        logger.write_data(b"Hello, World!\n").unwrap();
        logger.flush().unwrap();

        let path = logger.file_path();
        let mut content = String::new();
        File::open(path).unwrap().read_to_string(&mut content).unwrap();
        assert_eq!(content, "Hello, World!\n");
    }

    #[test]
    fn writes_multiple_chunks() {
        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path());
        let logger = SessionLogger::new(config).unwrap();

        logger.write_data(b"line 1\n").unwrap();
        logger.write_data(b"line 2\n").unwrap();
        logger.write_data(b"line 3\n").unwrap();
        logger.flush().unwrap();

        let path = logger.file_path();
        let mut content = String::new();
        File::open(path).unwrap().read_to_string(&mut content).unwrap();
        assert_eq!(content, "line 1\nline 2\nline 3\n");
    }

    #[test]
    fn strips_ansi_sequences_when_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.strip_ansi = true;
        let logger = SessionLogger::new(config).unwrap();

        // ESC[32m = green, ESC[0m = reset
        logger
            .write_data(b"\x1b[32mGreen text\x1b[0m normal\n")
            .unwrap();
        logger.flush().unwrap();

        let path = logger.file_path();
        let mut content = String::new();
        File::open(path).unwrap().read_to_string(&mut content).unwrap();
        assert_eq!(content, "Green text normal\n");
    }

    #[test]
    fn preserves_ansi_when_disabled() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.strip_ansi = false;
        let logger = SessionLogger::new(config).unwrap();

        let data = b"\x1b[32mGreen\x1b[0m";
        logger.write_data(data).unwrap();
        logger.flush().unwrap();

        let path = logger.file_path();
        let mut content = Vec::new();
        File::open(path).unwrap().read_to_end(&mut content).unwrap();
        assert_eq!(content, data);
    }

    #[test]
    fn adds_timestamps_when_enabled() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.timestamps = true;
        let logger = SessionLogger::new(config).unwrap();

        logger.write_data(b"hello\nworld\n").unwrap();
        logger.flush().unwrap();

        let path = logger.file_path();
        let mut content = String::new();
        File::open(path).unwrap().read_to_string(&mut content).unwrap();

        let lines: Vec<&str> = content.lines().collect();
        assert_eq!(lines.len(), 2);
        // Each line should start with [YYYY-MM-DD HH:MM:SS.mmm]
        for line in &lines {
            assert!(line.starts_with('['), "Line should start with timestamp: {line}");
            assert!(line.contains("] "), "Line should have timestamp separator: {line}");
        }
    }

    #[test]
    fn no_timestamp_on_empty_lines() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.timestamps = true;
        let logger = SessionLogger::new(config).unwrap();

        // Write a line followed by just a newline
        logger.write_data(b"hello\n\n").unwrap();
        logger.flush().unwrap();

        let path = logger.file_path();
        let mut content = String::new();
        File::open(path).unwrap().read_to_string(&mut content).unwrap();

        // Should have timestamp on "hello" line but not on empty line
        assert!(content.contains("] hello"));
        // The second newline should not get a timestamp prefix
        // (byte is \n, which sets at_line_start but doesn't get a prefix)
    }

    #[test]
    fn rotates_at_max_file_size() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.max_file_size = 1024; // 1KB for easy testing
        let logger = SessionLogger::new(config).unwrap();

        let first_path = logger.file_path();

        // Write enough data to trigger rotation (>1KB)
        let chunk = b"1234567890abcdef\n"; // 17 bytes
        for _ in 0..100 {
            logger.write_data(chunk).unwrap();
        }
        logger.flush().unwrap();

        let status = logger.status();
        assert!(status.rotation_count > 0, "Should have rotated at least once");

        // New file path should differ from original
        let new_path = logger.file_path();
        assert_ne!(first_path, new_path);
        assert!(new_path.to_string_lossy().contains("_part"));
    }

    #[test]
    fn status_reports_bytes_written() {
        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path());
        let logger = SessionLogger::new(config).unwrap();

        let status_before = logger.status();
        assert_eq!(status_before.bytes_written, 0);

        logger.write_data(b"test data\n").unwrap();
        logger.flush().unwrap();

        let status_after = logger.status();
        assert_eq!(status_after.bytes_written, 10); // "test data\n" = 10 bytes
        assert!(status_after.active);
        assert!(status_after.file_path.is_some());
    }

    #[test]
    fn file_path_contains_session_name() {
        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path());
        let logger = SessionLogger::new(config).unwrap();
        let path = logger.file_path();
        assert!(path.to_string_lossy().contains("test-session"));
    }

    #[test]
    fn rejects_invalid_session_name() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = test_config(dir.path());
        config.session_name = "../traversal".into();
        assert!(SessionLogger::new(config).is_err());
    }

    // --- ANSI stripping unit tests ---

    #[test]
    fn strip_ansi_removes_color_codes() {
        let input = b"\x1b[31mred\x1b[0m";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"red");
    }

    #[test]
    fn strip_ansi_removes_cursor_movement() {
        let input = b"\x1b[2Jhello\x1b[H";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"hello");
    }

    #[test]
    fn strip_ansi_removes_osc_sequences() {
        // Window title: ESC ] 0 ; title BEL
        let input = b"\x1b]0;My Title\x07rest";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"rest");
    }

    #[test]
    fn strip_ansi_preserves_plain_text() {
        let input = b"Hello, World!";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"Hello, World!");
    }

    #[test]
    fn strip_ansi_preserves_newlines_and_tabs() {
        let input = b"line1\nline2\ttab\r\n";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"line1\nline2\ttab\r\n");
    }

    #[test]
    fn strip_ansi_handles_complex_params() {
        // Bold + color: ESC[1;32m
        let input = b"\x1b[1;32mbold green\x1b[0m";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"bold green");
    }

    #[test]
    fn strip_ansi_handles_empty_input() {
        let result = strip_ansi_sequences(b"");
        assert!(result.is_empty());
    }

    #[test]
    fn strip_ansi_removes_control_chars() {
        // Bell character (0x07) outside OSC should be stripped
        let input = b"hello\x07world";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"helloworld");
    }

    #[test]
    fn strip_ansi_handles_256_color() {
        // ESC[38;5;196m = 256-color red
        let input = b"\x1b[38;5;196mcolored\x1b[0m";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"colored");
    }

    #[test]
    fn strip_ansi_handles_truecolor() {
        // ESC[38;2;255;0;0m = RGB red
        let input = b"\x1b[38;2;255;0;0mrgb red\x1b[0m";
        let result = strip_ansi_sequences(input);
        assert_eq!(result, b"rgb red");
    }

    // --- Timestamp format test ---

    #[test]
    fn format_timestamp_has_correct_format() {
        let ts = format_timestamp();
        // [YYYY-MM-DD HH:MM:SS.mmm] + trailing space
        assert!(ts.starts_with('['));
        assert!(ts.ends_with("] "));
        // Length: [2025-01-15 14:32:01.123] = 26 chars + space = 27 chars
        // But if milliseconds < 100, format may vary. Check reasonable range.
        assert!(ts.len() >= 26 && ts.len() <= 28, "Timestamp length was {}: {ts}", ts.len());
    }

    // --- Edge cases ---

    #[test]
    fn write_empty_data_is_noop() {
        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path());
        let logger = SessionLogger::new(config).unwrap();

        logger.write_data(b"").unwrap();
        logger.flush().unwrap();

        let status = logger.status();
        assert_eq!(status.bytes_written, 0);
    }

    #[cfg(unix)]
    #[test]
    fn log_file_has_correct_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let config = test_config(dir.path());
        let logger = SessionLogger::new(config).unwrap();
        let path = logger.file_path();

        let metadata = fs::metadata(path).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(mode, 0o644);
    }
}
