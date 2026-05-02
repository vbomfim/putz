/**
 * PingDashboard — real-time multi-target ping visualization.
 *
 * Allows adding targets (hostnames/IPs), starting concurrent pings,
 * and viewing results in a live-updating table with min/avg/max/loss.
 *
 * Listens to Tauri events for real-time updates from the Rust backend.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { pingStart, pingStop } from "./pingApi";
import type { PingResult, PingSummary, PingTargetStats } from "./types";
import {
  DEFAULT_PING_COUNT,
  DEFAULT_PING_INTERVAL,
  MAX_PING_TARGETS,
} from "./types";
import "./Ping.css";

/** Returns a CSS class for the loss percentage cell. */
function lossClass(lossPct: number): string {
  if (lossPct === 0) return "ping-loss-ok";
  if (lossPct < 50) return "ping-loss-warn";
  return "ping-loss-critical";
}

/** Formats a millisecond value to 1 decimal place, or "—" if null. */
function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  return `${ms.toFixed(1)}`;
}

export function PingDashboard() {
  const [targetInput, setTargetInput] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [count, setCount] = useState(DEFAULT_PING_COUNT);
  const [interval, setInterval_] = useState(DEFAULT_PING_INTERVAL);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [stats, setStats] = useState<Map<string, PingTargetStats>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const unlistenRefs = useRef<UnlistenFn[]>([]);

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => {
      for (const unlisten of unlistenRefs.current) {
        unlisten();
      }
    };
  }, []);

  const addTarget = useCallback(() => {
    const trimmed = targetInput.trim();
    if (!trimmed) return;
    if (targets.includes(trimmed)) return;
    if (targets.length >= MAX_PING_TARGETS) return;
    setTargets((prev) => [...prev, trimmed]);
    setTargetInput("");
  }, [targetInput, targets]);

  const removeTarget = useCallback((target: string) => {
    setTargets((prev) => prev.filter((t) => t !== target));
  }, []);

  const handleStart = useCallback(async () => {
    if (targets.length === 0) return;
    setError(null);

    // Initialize stats
    const initial = new Map<string, PingTargetStats>();
    for (const t of targets) {
      initial.set(t, {
        target: t,
        status: "running",
        sent: 0,
        received: 0,
        lossPct: 0,
        minMs: null,
        avgMs: null,
        maxMs: null,
        lastMs: null,
      });
    }
    setStats(initial);

    try {
      const id = await pingStart({ targets, count, interval });
      setSessionId(id);
      setIsRunning(true);

      // Track completed targets
      let completedCount = 0;
      const totalTargets = targets.length;

      // Listen for per-reply results
      const unlistenResult = await listen<PingResult>(
        `ping-result-${id}`,
        (event) => {
          const result = event.payload;
          setStats((prev) => {
            const next = new Map(prev);
            const existing = next.get(result.target);
            if (existing) {
              const sent = existing.sent + 1;
              const received = result.timedOut
                ? existing.received
                : existing.received + 1;
              const lastMs = result.rttMs;

              // Update min/avg/max
              let minMs = existing.minMs;
              let avgMs = existing.avgMs;
              let maxMs = existing.maxMs;

              if (result.rttMs !== null) {
                minMs =
                  minMs === null ? result.rttMs : Math.min(minMs, result.rttMs);
                maxMs =
                  maxMs === null ? result.rttMs : Math.max(maxMs, result.rttMs);
                // Running average
                avgMs =
                  avgMs === null
                    ? result.rttMs
                    : (avgMs * (received - 1) + result.rttMs) / received;
              }

              next.set(result.target, {
                ...existing,
                sent,
                received,
                lossPct: sent > 0 ? ((sent - received) / sent) * 100 : 0,
                minMs,
                avgMs,
                maxMs,
                lastMs,
              });
            }
            return next;
          });
        },
      );

      // Listen for summary results
      const unlistenSummary = await listen<PingSummary>(
        `ping-summary-${id}`,
        (event) => {
          const summary = event.payload;
          setStats((prev) => {
            const next = new Map(prev);
            next.set(summary.target, {
              target: summary.target,
              status: "done",
              sent: summary.sent,
              received: summary.received,
              lossPct: summary.lossPct,
              minMs: summary.minMs,
              avgMs: summary.avgMs,
              maxMs: summary.maxMs,
              lastMs: null,
            });
            return next;
          });

          completedCount++;
          if (completedCount >= totalTargets) {
            setIsRunning(false);
            setSessionId(null);
          }
        },
      );

      unlistenRefs.current = [unlistenResult, unlistenSummary];
    } catch (e) {
      setError(String(e));
      setIsRunning(false);
    }
  }, [targets, count, interval]);

  const handleStop = useCallback(async () => {
    if (!sessionId) return;
    try {
      await pingStop(sessionId);
    } catch {
      // Ignore stop errors
    }
    setIsRunning(false);
    setSessionId(null);

    // Mark all running targets as done
    setStats((prev) => {
      const next = new Map(prev);
      for (const [key, val] of next) {
        if (val.status === "running") {
          next.set(key, { ...val, status: "done" });
        }
      }
      return next;
    });
  }, [sessionId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        addTarget();
      }
    },
    [addTarget],
  );

  return (
    <div className="ping-dashboard" data-testid="ping-dashboard">
      <h2 className="ping-title">Ping Dashboard</h2>

      {/* Target input */}
      <div className="ping-input-row">
        <input
          type="text"
          className="ping-target-input"
          placeholder="Hostname or IP address"
          value={targetInput}
          onChange={(e) => setTargetInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          data-testid="ping-target-input"
          aria-label="Ping target"
        />
        <button
          className="ping-add-btn"
          onClick={addTarget}
          disabled={isRunning || !targetInput.trim()}
          type="button"
          data-testid="ping-add-btn"
        >
          Add
        </button>
      </div>

      {/* Target tags */}
      {targets.length > 0 && (
        <div className="ping-targets" data-testid="ping-targets">
          {targets.map((t) => (
            <span key={t} className="ping-target-tag">
              {t}
              {!isRunning && (
                <button
                  className="ping-target-remove"
                  onClick={() => removeTarget(t)}
                  type="button"
                  aria-label={`Remove ${t}`}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Options row */}
      <div className="ping-options-row">
        <label className="ping-option">
          Count:
          <input
            type="number"
            min={1}
            max={1000}
            value={count}
            onChange={(e) =>
              setCount(Number(e.target.value) || DEFAULT_PING_COUNT)
            }
            disabled={isRunning}
            className="ping-option-input"
            data-testid="ping-count-input"
          />
        </label>
        <label className="ping-option">
          Interval (s):
          <input
            type="number"
            min={0.1}
            max={60}
            step={0.1}
            value={interval}
            onChange={(e) =>
              setInterval_(Number(e.target.value) || DEFAULT_PING_INTERVAL)
            }
            disabled={isRunning}
            className="ping-option-input"
            data-testid="ping-interval-input"
          />
        </label>
        <div className="ping-actions">
          {!isRunning ? (
            <button
              className="ping-start-btn"
              onClick={handleStart}
              disabled={targets.length === 0}
              type="button"
              data-testid="ping-start-btn"
            >
              Start Ping
            </button>
          ) : (
            <button
              className="ping-stop-btn"
              onClick={handleStop}
              type="button"
              data-testid="ping-stop-btn"
            >
              Stop
            </button>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="ping-error" data-testid="ping-error" role="alert">
          {error}
        </div>
      )}

      {/* Results table */}
      {stats.size > 0 && (
        <table className="ping-table" data-testid="ping-table">
          <thead>
            <tr>
              <th>Target</th>
              <th>Status</th>
              <th>Sent</th>
              <th>Recv</th>
              <th>Loss %</th>
              <th>Min (ms)</th>
              <th>Avg (ms)</th>
              <th>Max (ms)</th>
              <th>Last (ms)</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(stats.values()).map((s) => (
              <tr key={s.target} data-testid={`ping-row-${s.target}`}>
                <td className="ping-cell-target">{s.target}</td>
                <td className={`ping-cell-status ping-status-${s.status}`}>
                  {s.status}
                </td>
                <td>{s.sent}</td>
                <td>{s.received}</td>
                <td className={lossClass(s.lossPct)}>
                  {s.lossPct.toFixed(1)}%
                </td>
                <td>{fmtMs(s.minMs)}</td>
                <td>{fmtMs(s.avgMs)}</td>
                <td>{fmtMs(s.maxMs)}</td>
                <td>{fmtMs(s.lastMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
