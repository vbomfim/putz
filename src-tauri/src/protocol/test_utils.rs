/// Shared test utilities for protocol tests.
///
/// Provides mock implementations of traits used across multiple
/// test modules to avoid duplication.

use std::sync::Mutex as StdMutex;

use super::telnet::EventEmitter;
use super::ConnectionStatusPayload;

/// Mock event emitter for testing protocol connections.
///
/// Records all emitted outputs and status changes for assertion.
pub struct MockEmitter {
    pub outputs: StdMutex<Vec<(String, String)>>,
    pub statuses: StdMutex<Vec<(String, ConnectionStatusPayload)>>,
}

impl MockEmitter {
    pub fn new() -> Self {
        Self {
            outputs: StdMutex::new(Vec::new()),
            statuses: StdMutex::new(Vec::new()),
        }
    }
}

impl EventEmitter for MockEmitter {
    fn emit_output(&self, connection_id: &str, data: &str) {
        self.outputs
            .lock()
            .unwrap()
            .push((connection_id.to_string(), data.to_string()));
    }

    fn emit_status(
        &self,
        connection_id: &str,
        payload: &ConnectionStatusPayload,
    ) {
        self.statuses
            .lock()
            .unwrap()
            .push((connection_id.to_string(), payload.clone()));
    }
}
