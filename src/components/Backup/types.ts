/**
 * Type definitions for the Quick Config Backup feature.
 *
 * @module backupTypes
 */

/** Request to save a device configuration backup. */
export interface SaveBackupRequest {
  /** Hostname or label for the device. */
  hostname: string;
  /** The captured configuration text. */
  content: string;
}

/** Response after saving a backup. */
export interface SaveBackupResponse {
  /** Full path where the backup was saved. */
  path: string;
  /** Size of the saved file in bytes. */
  size: number;
}
