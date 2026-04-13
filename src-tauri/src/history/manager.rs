/// Command history manager — SQLite-backed command storage and search.
///
/// Manages a SQLite database at `~/.config/putz/command_history.db` for
/// cross-session command recall. Thread-safe via `Mutex<Connection>`.
///
/// Auto-prunes oldest entries when the database exceeds `MAX_HISTORY_ENTRIES`.
use std::sync::Mutex;

use rusqlite::{params, Connection};

use super::error::HistoryError;
use super::models::{
    AddCommandInput, CommandEntry, GetRecentInput, SearchHistoryInput, MAX_HISTORY_ENTRIES,
    MAX_SEARCH_LIMIT,
};

/// Thread-safe command history manager backed by SQLite.
pub struct CommandHistoryManager {
    db: Mutex<Connection>,
}

impl CommandHistoryManager {
    /// Creates a new manager with a SQLite database at the default config path.
    ///
    /// Creates the database and tables if they don't exist.
    pub fn new() -> Result<Self, HistoryError> {
        let db_path = Self::database_path()?;

        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                HistoryError::DatabaseError(format!("Cannot create config dir: {e}"))
            })?;
        }

        let conn = Connection::open(&db_path)
            .map_err(|e| HistoryError::DatabaseError(format!("Cannot open database: {e}")))?;

        Self::initialize_schema(&conn)?;

        Ok(Self {
            db: Mutex::new(conn),
        })
    }

    /// Creates a new manager with an in-memory database (for testing).
    #[cfg(test)]
    pub fn new_in_memory() -> Result<Self, HistoryError> {
        let conn =
            Connection::open_in_memory().map_err(|e| HistoryError::DatabaseError(e.to_string()))?;
        Self::initialize_schema(&conn)?;
        Ok(Self {
            db: Mutex::new(conn),
        })
    }

    /// Returns the default database file path.
    fn database_path() -> Result<std::path::PathBuf, HistoryError> {
        let config_dir = dirs::config_dir().ok_or_else(|| {
            HistoryError::DatabaseError("Cannot determine config directory".into())
        })?;
        Ok(config_dir.join("putz").join("command_history.db"))
    }

    /// Creates the database schema if it doesn't exist.
    fn initialize_schema(conn: &Connection) -> Result<(), HistoryError> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_name TEXT NOT NULL,
                host TEXT NOT NULL DEFAULT '',
                command TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                session_id TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_commands_session_id ON commands(session_id);
            CREATE INDEX IF NOT EXISTS idx_commands_timestamp ON commands(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_commands_command ON commands(command);",
        )
        .map_err(|e| HistoryError::DatabaseError(format!("Schema init failed: {e}")))?;
        Ok(())
    }

    /// Adds a command to the history.
    ///
    /// Validates input, inserts the entry, and auto-prunes if over the limit.
    pub fn add(&self, input: AddCommandInput) -> Result<i64, HistoryError> {
        let command = input.command.trim();
        if command.is_empty() {
            return Err(HistoryError::InvalidInput("command is empty".into()));
        }
        if command.len() > 10_000 {
            return Err(HistoryError::InvalidInput(
                "command exceeds 10,000 characters".into(),
            ));
        }
        if input.session_id.trim().is_empty() {
            return Err(HistoryError::InvalidInput("session_id is empty".into()));
        }

        let db = self
            .db
            .lock()
            .map_err(|_| HistoryError::LockError("mutex poisoned".into()))?;

        let now = chrono::Utc::now().to_rfc3339();

        db.execute(
            "INSERT INTO commands (session_name, host, command, timestamp, session_id)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                input.session_name.trim(),
                input.host.trim(),
                command,
                now,
                input.session_id.trim(),
            ],
        )?;

        let id = db.last_insert_rowid();

        // Auto-prune if over limit
        self.prune_if_needed(&db)?;

        Ok(id)
    }

    /// Searches command history by substring match on the command text.
    ///
    /// Results are ordered by most recent first.
    pub fn search(&self, input: SearchHistoryInput) -> Result<Vec<CommandEntry>, HistoryError> {
        let query = input.query.trim();
        if query.is_empty() {
            return Err(HistoryError::InvalidInput("search query is empty".into()));
        }

        let limit = input.limit.min(MAX_SEARCH_LIMIT);

        let db = self
            .db
            .lock()
            .map_err(|_| HistoryError::LockError("mutex poisoned".into()))?;

        let pattern = format!("%{query}%");

        if let Some(session_id) = &input.session_id {
            let mut stmt = db.prepare(
                "SELECT id, session_name, host, command, timestamp, session_id
                 FROM commands
                 WHERE command LIKE ?1 AND session_id = ?2
                 ORDER BY timestamp DESC
                 LIMIT ?3",
            )?;
            let entries = stmt
                .query_map(params![pattern, session_id.trim(), limit], |row| {
                    Ok(CommandEntry {
                        id: row.get(0)?,
                        session_name: row.get(1)?,
                        host: row.get(2)?,
                        command: row.get(3)?,
                        timestamp: row.get(4)?,
                        session_id: row.get(5)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(entries)
        } else {
            let mut stmt = db.prepare(
                "SELECT id, session_name, host, command, timestamp, session_id
                 FROM commands
                 WHERE command LIKE ?1
                 ORDER BY timestamp DESC
                 LIMIT ?2",
            )?;
            let entries = stmt
                .query_map(params![pattern, limit], |row| {
                    Ok(CommandEntry {
                        id: row.get(0)?,
                        session_name: row.get(1)?,
                        host: row.get(2)?,
                        command: row.get(3)?,
                        timestamp: row.get(4)?,
                        session_id: row.get(5)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(entries)
        }
    }

    /// Gets the most recent commands for a specific session.
    pub fn get_recent(&self, input: GetRecentInput) -> Result<Vec<CommandEntry>, HistoryError> {
        if input.session_id.trim().is_empty() {
            return Err(HistoryError::InvalidInput("session_id is empty".into()));
        }

        let limit = input.limit.min(MAX_SEARCH_LIMIT);

        let db = self
            .db
            .lock()
            .map_err(|_| HistoryError::LockError("mutex poisoned".into()))?;

        let mut stmt = db.prepare(
            "SELECT id, session_name, host, command, timestamp, session_id
             FROM commands
             WHERE session_id = ?1
             ORDER BY timestamp DESC
             LIMIT ?2",
        )?;

        let entries = stmt
            .query_map(params![input.session_id.trim(), limit], |row| {
                Ok(CommandEntry {
                    id: row.get(0)?,
                    session_name: row.get(1)?,
                    host: row.get(2)?,
                    command: row.get(3)?,
                    timestamp: row.get(4)?,
                    session_id: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    /// Clears all command history.
    pub fn clear(&self) -> Result<(), HistoryError> {
        let db = self
            .db
            .lock()
            .map_err(|_| HistoryError::LockError("mutex poisoned".into()))?;

        db.execute("DELETE FROM commands", [])?;
        Ok(())
    }

    /// Returns the total number of entries in history.
    #[allow(dead_code)]
    pub fn count(&self) -> Result<u32, HistoryError> {
        let db = self
            .db
            .lock()
            .map_err(|_| HistoryError::LockError("mutex poisoned".into()))?;

        let count: u32 = db.query_row("SELECT COUNT(*) FROM commands", [], |row| row.get(0))?;

        Ok(count)
    }

    /// Prunes oldest entries if the total exceeds `MAX_HISTORY_ENTRIES`.
    fn prune_if_needed(&self, db: &Connection) -> Result<(), HistoryError> {
        let count: u32 = db.query_row("SELECT COUNT(*) FROM commands", [], |row| row.get(0))?;

        if count > MAX_HISTORY_ENTRIES {
            let excess = count - MAX_HISTORY_ENTRIES;
            db.execute(
                "DELETE FROM commands WHERE id IN (
                    SELECT id FROM commands ORDER BY timestamp ASC LIMIT ?1
                )",
                params![excess],
            )?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_manager() -> CommandHistoryManager {
        CommandHistoryManager::new_in_memory().unwrap()
    }

    fn make_input(command: &str, session_id: &str) -> AddCommandInput {
        AddCommandInput {
            session_name: "TestSession".into(),
            host: "10.0.0.1".into(),
            command: command.into(),
            session_id: session_id.into(),
        }
    }

    // ─── Add ─────────────────────────────────────────────────────────

    #[test]
    fn add_command_returns_id() {
        let mgr = make_manager();
        let id = mgr.add(make_input("show ip route", "s1")).unwrap();
        assert!(id > 0);
    }

    #[test]
    fn add_command_trims_whitespace() {
        let mgr = make_manager();
        mgr.add(make_input("  show version  ", "s1")).unwrap();
        let entries = mgr
            .get_recent(GetRecentInput {
                session_id: "s1".into(),
                limit: 10,
            })
            .unwrap();
        assert_eq!(entries[0].command, "show version");
    }

    #[test]
    fn add_command_rejects_empty() {
        let mgr = make_manager();
        let result = mgr.add(make_input("", "s1"));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("empty"));
    }

    #[test]
    fn add_command_rejects_whitespace_only() {
        let mgr = make_manager();
        let result = mgr.add(make_input("   ", "s1"));
        assert!(result.is_err());
    }

    #[test]
    fn add_command_rejects_empty_session_id() {
        let mgr = make_manager();
        let result = mgr.add(make_input("ls", ""));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("session_id"));
    }

    #[test]
    fn add_command_rejects_too_long() {
        let mgr = make_manager();
        let long_cmd = "a".repeat(10_001);
        let result = mgr.add(make_input(&long_cmd, "s1"));
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("10,000"));
    }

    // ─── Search ──────────────────────────────────────────────────────

    #[test]
    fn search_finds_matching_commands() {
        let mgr = make_manager();
        mgr.add(make_input("show ip route", "s1")).unwrap();
        mgr.add(make_input("show ip interface brief", "s1"))
            .unwrap();
        mgr.add(make_input("configure terminal", "s1")).unwrap();

        let results = mgr
            .search(SearchHistoryInput {
                query: "show".into(),
                session_id: None,
                limit: 50,
            })
            .unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn search_is_case_insensitive() {
        let mgr = make_manager();
        mgr.add(make_input("Show IP Route", "s1")).unwrap();

        let results = mgr
            .search(SearchHistoryInput {
                query: "show ip".into(),
                session_id: None,
                limit: 50,
            })
            .unwrap();
        // SQLite LIKE is case-insensitive for ASCII by default
        assert_eq!(results.len(), 1);
    }

    #[test]
    fn search_filters_by_session() {
        let mgr = make_manager();
        mgr.add(make_input("show version", "s1")).unwrap();
        mgr.add(make_input("show version", "s2")).unwrap();

        let results = mgr
            .search(SearchHistoryInput {
                query: "show".into(),
                session_id: Some("s1".into()),
                limit: 50,
            })
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].session_id, "s1");
    }

    #[test]
    fn search_respects_limit() {
        let mgr = make_manager();
        for i in 0..20 {
            mgr.add(make_input(&format!("cmd {i}"), "s1")).unwrap();
        }

        let results = mgr
            .search(SearchHistoryInput {
                query: "cmd".into(),
                session_id: None,
                limit: 5,
            })
            .unwrap();
        assert_eq!(results.len(), 5);
    }

    #[test]
    fn search_clamps_limit_to_max() {
        let mgr = make_manager();
        mgr.add(make_input("test", "s1")).unwrap();

        // Limit beyond MAX_SEARCH_LIMIT should be clamped
        let results = mgr
            .search(SearchHistoryInput {
                query: "test".into(),
                session_id: None,
                limit: 999,
            })
            .unwrap();
        assert_eq!(results.len(), 1); // Only 1 entry exists
    }

    #[test]
    fn search_rejects_empty_query() {
        let mgr = make_manager();
        let result = mgr.search(SearchHistoryInput {
            query: "".into(),
            session_id: None,
            limit: 50,
        });
        assert!(result.is_err());
    }

    #[test]
    fn search_returns_most_recent_first() {
        let mgr = make_manager();
        mgr.add(make_input("first", "s1")).unwrap();
        mgr.add(make_input("second", "s1")).unwrap();
        mgr.add(make_input("third", "s1")).unwrap();

        let results = mgr
            .search(SearchHistoryInput {
                query: "d".into(), // matches "second" and "third"
                session_id: None,
                limit: 50,
            })
            .unwrap();
        assert!(results.len() >= 2);
        // Most recent should be first
        assert!(results[0].timestamp >= results[1].timestamp);
    }

    // ─── Get Recent ──────────────────────────────────────────────────

    #[test]
    fn get_recent_returns_session_commands() {
        let mgr = make_manager();
        mgr.add(make_input("cmd1", "s1")).unwrap();
        mgr.add(make_input("cmd2", "s1")).unwrap();
        mgr.add(make_input("other", "s2")).unwrap();

        let results = mgr
            .get_recent(GetRecentInput {
                session_id: "s1".into(),
                limit: 50,
            })
            .unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn get_recent_rejects_empty_session_id() {
        let mgr = make_manager();
        let result = mgr.get_recent(GetRecentInput {
            session_id: "".into(),
            limit: 50,
        });
        assert!(result.is_err());
    }

    // ─── Clear ───────────────────────────────────────────────────────

    #[test]
    fn clear_removes_all_entries() {
        let mgr = make_manager();
        mgr.add(make_input("cmd1", "s1")).unwrap();
        mgr.add(make_input("cmd2", "s2")).unwrap();
        assert_eq!(mgr.count().unwrap(), 2);

        mgr.clear().unwrap();
        assert_eq!(mgr.count().unwrap(), 0);
    }

    // ─── Auto-prune ──────────────────────────────────────────────────

    #[test]
    fn auto_prunes_when_over_limit() {
        let mgr = make_manager();

        // Insert MAX + 10 entries — use a batch for speed
        {
            let db = mgr.db.lock().unwrap();
            let mut stmt = db
                .prepare(
                    "INSERT INTO commands (session_name, host, command, timestamp, session_id)
                     VALUES ('test', '', ?1, datetime('now'), 's1')",
                )
                .unwrap();
            for i in 0..(MAX_HISTORY_ENTRIES + 10) {
                stmt.execute(params![format!("cmd-{i}")]).unwrap();
            }
        }

        // Adding one more triggers prune
        mgr.add(make_input("trigger-prune", "s1")).unwrap();

        let count = mgr.count().unwrap();
        assert!(count <= MAX_HISTORY_ENTRIES);
    }

    // ─── Count ───────────────────────────────────────────────────────

    #[test]
    fn count_returns_zero_for_empty() {
        let mgr = make_manager();
        assert_eq!(mgr.count().unwrap(), 0);
    }

    #[test]
    fn count_tracks_additions() {
        let mgr = make_manager();
        mgr.add(make_input("cmd1", "s1")).unwrap();
        mgr.add(make_input("cmd2", "s1")).unwrap();
        assert_eq!(mgr.count().unwrap(), 2);
    }
}
