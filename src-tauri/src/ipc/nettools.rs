/// IPC command handlers for network tools (ping, backup).
///
/// Ping sessions run asynchronously — `ping_start` returns a session ID
/// immediately and emits `ping-result-{id}` / `ping-summary-{id}` events.
use tauri::{AppHandle, State};

use crate::nettools::backup::{self, SaveBackupRequest, SaveBackupResponse};
use crate::nettools::ping::{
    self, build_ping_command, parse_reply_line, parse_rtt_stats_line, parse_summary_line,
    PingManager, PingRequest, PingResult, PingSummary,
};

use tokio::io::{AsyncBufReadExt, BufReader};

/// Starts a ping session against one or more targets.
///
/// Returns a session ID. Results are emitted as events:
/// - `ping-result-{id}`: per-reply results
/// - `ping-summary-{id}`: per-target summary when complete
#[tauri::command]
pub async fn ping_start(
    app: AppHandle,
    state: State<'_, PingManager>,
    request: PingRequest,
) -> Result<String, String> {
    ping::validate_request(&request)?;

    let id = uuid::Uuid::new_v4().to_string();
    let count = request.count.unwrap_or(4);
    let interval = request.interval.unwrap_or(1.0);

    let mut handles = Vec::new();

    for target in &request.targets {
        let app = app.clone();
        let id = id.clone();
        let target = target.clone();

        let handle = tokio::spawn(async move {
            let mut cmd = build_ping_command(&target, count, interval);

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    let _ = tauri::Emitter::emit(
                        &app,
                        &format!("ping-summary-{id}"),
                        &PingSummary {
                            id: id.clone(),
                            target: target.clone(),
                            sent: 0,
                            received: 0,
                            loss_pct: 100.0,
                            min_ms: None,
                            avg_ms: None,
                            max_ms: None,
                            done: true,
                        },
                    );
                    eprintln!("Failed to spawn ping for {target}: {e}");
                    return;
                }
            };

            let stdout = child.stdout.take().unwrap();
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            let mut seq_counter: u32 = 0;

            // Track stats for summary
            let mut sent: u32 = count;
            let mut received: u32 = 0;
            let mut loss_pct: f64 = 0.0;
            let mut min_ms: Option<f64> = None;
            let mut avg_ms: Option<f64> = None;
            let mut max_ms: Option<f64> = None;
            let mut got_summary = false;

            while let Ok(Some(line)) = lines.next_line().await {
                // Try parsing as reply
                if let Some((seq, rtt)) = parse_reply_line(&line) {
                    seq_counter += 1;
                    let _ = tauri::Emitter::emit(
                        &app,
                        &format!("ping-result-{id}"),
                        &PingResult {
                            id: id.clone(),
                            target: target.clone(),
                            seq: if seq > 0 { seq } else { seq_counter },
                            rtt_ms: rtt,
                            timed_out: rtt.is_none(),
                        },
                    );
                }

                // Try parsing as summary
                if let Some((s, r, l)) = parse_summary_line(&line) {
                    sent = s;
                    received = r;
                    loss_pct = l;
                    got_summary = true;
                }

                // Try parsing as RTT stats
                if let Some((mn, av, mx)) = parse_rtt_stats_line(&line) {
                    min_ms = Some(mn);
                    avg_ms = Some(av);
                    max_ms = Some(mx);
                }
            }

            // Wait for process to exit
            let _ = child.wait().await;

            // Emit summary
            let _ = tauri::Emitter::emit(
                &app,
                &format!("ping-summary-{id}"),
                &PingSummary {
                    id: id.clone(),
                    target,
                    sent,
                    received,
                    loss_pct: if got_summary { loss_pct } else { 100.0 },
                    min_ms,
                    avg_ms,
                    max_ms,
                    done: true,
                },
            );
        });

        handles.push(handle);
    }

    state.register(&id, handles);
    Ok(id)
}

/// Stops a running ping session.
#[tauri::command]
pub fn ping_stop(state: State<'_, PingManager>, id: String) -> Result<(), String> {
    state.stop(&id)
}

/// Saves captured command output as a backup file.
///
/// Writes to `~/putz-backups/{hostname}_{timestamp}.txt`.
#[tauri::command]
pub fn save_backup(request: SaveBackupRequest) -> Result<SaveBackupResponse, String> {
    backup::save_backup(&request)
}
