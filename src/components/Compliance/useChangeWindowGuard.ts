/**
 * useChangeWindowGuard — hook that intercepts terminal input to detect
 * dangerous commands and check them against the change window policy.
 *
 * Maintains a simple line buffer. When Enter (\r) is detected, checks
 * the buffered line against the backend. If the command is dangerous
 * and outside a change window, signals the caller to show a warning.
 *
 * Design:
 * - All non-Enter keystrokes pass through immediately (no input lag)
 * - Only the Enter key is potentially held back for checking
 * - Backspace (\x7f, \b) updates the buffer for accurate matching
 * - Paste handling: if paste contains \r, splits and checks the line
 *
 * @module useChangeWindowGuard
 */
import { useState, useCallback, useRef } from "react";
import { changeWindowCheck } from "./complianceApi";

interface ChangeWindowGuardState {
  /** Whether a warning modal should be shown. */
  showWarning: boolean;
  /** The blocked command (for display in the modal). */
  blockedCommand: string;
  /** The reason from the backend. */
  blockedReason: string;
  /** The original data that triggered the block (includes Enter). */
  blockedData: string;
}

interface UseChangeWindowGuardReturn {
  /** Current guard state. */
  guard: ChangeWindowGuardState;
  /**
   * Processes terminal input data before sending to PTY.
   * Returns the data to forward (may be modified or empty if blocked).
   * When a command is blocked, returns null — caller should NOT send to PTY.
   */
  processInput: (data: string) => Promise<string | null>;
  /** Called when user clicks "Proceed Anyway" in the warning modal. */
  handleProceed: () => string;
  /** Called when user clicks "Cancel" in the warning modal. */
  handleCancel: () => void;
}

/**
 * Hook for change window command interception.
 *
 * Usage in useTerminal:
 * ```
 * const { guard, processInput, handleProceed, handleCancel } = useChangeWindowGuard();
 *
 * terminal.onData(async (data) => {
 *   const forwarded = await processInput(data);
 *   if (forwarded !== null) {
 *     invoke("pty_write", { sessionId, data: encode(forwarded) });
 *   }
 * });
 * ```
 */
export function useChangeWindowGuard(): UseChangeWindowGuardReturn {
  const lineBufferRef = useRef<string>("");
  const [guard, setGuard] = useState<ChangeWindowGuardState>({
    showWarning: false,
    blockedCommand: "",
    blockedReason: "",
    blockedData: "",
  });

  const processInput = useCallback(
    async (data: string): Promise<string | null> => {
      // Check if data contains Enter key
      const enterIndex = data.indexOf("\r");
      if (enterIndex === -1 && !data.includes("\n")) {
        // No Enter key — buffer and pass through
        for (const ch of data) {
          if (ch === "\x7f" || ch === "\b") {
            // Backspace — remove last char from buffer
            lineBufferRef.current = lineBufferRef.current.slice(0, -1);
          } else if (ch.charCodeAt(0) >= 32) {
            // Printable character — add to buffer
            lineBufferRef.current += ch;
          }
          // Ignore control characters (arrows, etc.)
        }
        return data;
      }

      // Enter detected — check the buffered command
      // For paste with embedded newlines, check the line before the first Enter
      const command = lineBufferRef.current.trim();
      lineBufferRef.current = ""; // Reset buffer

      if (!command) {
        // Empty command — pass through
        return data;
      }

      try {
        const result = await changeWindowCheck(command);
        if (result.allowed) {
          return data;
        }

        // Command is blocked — show warning
        setGuard({
          showWarning: true,
          blockedCommand: command,
          blockedReason: result.reason,
          blockedData: data,
        });
        return null; // Don't forward to PTY
      } catch {
        // Backend error — allow the command (fail open for usability)
        return data;
      }
    },
    [],
  );

  const handleProceed = useCallback((): string => {
    const data = guard.blockedData;
    setGuard({
      showWarning: false,
      blockedCommand: "",
      blockedReason: "",
      blockedData: "",
    });
    return data;
  }, [guard.blockedData]);

  const handleCancel = useCallback((): void => {
    setGuard({
      showWarning: false,
      blockedCommand: "",
      blockedReason: "",
      blockedData: "",
    });
  }, []);

  return { guard, processInput, handleProceed, handleCancel };
}
