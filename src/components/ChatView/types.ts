/**
 * Type definitions for the ChatView expect-style session log.
 *
 * Defines the structured command/response pair format used
 * to present terminal sessions as a readable chat-style log.
 *
 * @module chatViewTypes
 */

/** A single command/response exchange in the chat log. */
export interface ChatEntry {
  /** Unique identifier for this exchange. */
  id: string;
  /** ISO 8601 timestamp of when the command was sent. */
  timestamp: string;
  /** The command that was sent to the terminal. */
  command: string;
  /** The response received from the terminal (may be empty). */
  response: string;
  /** Whether this entry is collapsed in the UI. */
  isCollapsed: boolean;
}

/** Direction indicator for chat log entries. */
export type ChatDirection = "sent" | "received";
