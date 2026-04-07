/// Error types for the template engine.
///
/// Provides structured errors for template CRUD and execution failures.
use std::fmt;

/// Errors that can occur during template operations.
#[derive(Debug)]
pub enum TemplateError {
    /// Template not found by ID.
    NotFound(String),
    /// Template name is empty or exceeds limits.
    InvalidName(String),
    /// Template content is empty or exceeds limits.
    InvalidContent(String),
    /// Cannot delete a built-in template.
    CannotDeleteBuiltin(String),
    /// File system I/O error.
    Io(std::io::Error),
    /// JSON serialization/deserialization error.
    Json(serde_json::Error),
    /// Invalid UUID format.
    InvalidId(String),
}

impl fmt::Display for TemplateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "Template not found: {id}"),
            Self::InvalidName(msg) => write!(f, "Invalid template name: {msg}"),
            Self::InvalidContent(msg) => write!(f, "Invalid template content: {msg}"),
            Self::CannotDeleteBuiltin(name) => {
                write!(f, "Cannot delete built-in template: {name}")
            }
            Self::Io(err) => write!(f, "I/O error: {err}"),
            Self::Json(err) => write!(f, "JSON error: {err}"),
            Self::InvalidId(id) => write!(f, "Invalid template ID: {id}"),
        }
    }
}

impl std::error::Error for TemplateError {}

impl From<std::io::Error> for TemplateError {
    fn from(err: std::io::Error) -> Self {
        Self::Io(err)
    }
}

impl From<serde_json::Error> for TemplateError {
    fn from(err: serde_json::Error) -> Self {
        Self::Json(err)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_display_not_found() {
        let err = TemplateError::NotFound("abc-123".into());
        assert_eq!(err.to_string(), "Template not found: abc-123");
    }

    #[test]
    fn error_display_invalid_name() {
        let err = TemplateError::InvalidName("too short".into());
        assert_eq!(err.to_string(), "Invalid template name: too short");
    }

    #[test]
    fn error_display_cannot_delete_builtin() {
        let err = TemplateError::CannotDeleteBuiltin("Backup Config".into());
        assert_eq!(
            err.to_string(),
            "Cannot delete built-in template: Backup Config"
        );
    }

    #[test]
    fn error_display_invalid_id() {
        let err = TemplateError::InvalidId("not-a-uuid".into());
        assert_eq!(err.to_string(), "Invalid template ID: not-a-uuid");
    }
}
