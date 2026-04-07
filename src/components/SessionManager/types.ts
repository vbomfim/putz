/**
 * Type definitions for the session manager IPC layer.
 *
 * These types mirror the Rust backend's session models.
 * Keep in sync with src-tauri/src/session/models.rs.
 */

/** Connection protocol for a session. */
export type Protocol = "ssh" | "telnet" | "serial" | "local";

/** A saved session profile containing connection details. */
export interface SessionProfile {
  id: string;
  name: string;
  folderId: string;
  protocol: Protocol;
  host?: string;
  port?: number;
  username?: string;
  credentialId?: string;
  serialPort?: string;
  serialBaud?: number;
  serialDataBits?: string;
  serialParity?: string;
  serialStopBits?: string;
  serialFlowControl?: string;
  colorScheme?: string;
  autoLog?: boolean;
  jumpHostId?: string;
  autoLogin?: boolean;
  autoLoginDeviceType?: string;
  createdAt: string;
  updatedAt: string;
}

/** A folder for organizing session profiles. */
export interface SessionFolder {
  id: string;
  name: string;
  parentId: string;
  sortOrder: number;
  expanded: boolean;
}

/** Tree node for the session tree view (discriminated union). */
export type SessionNode = SessionFolderNode | SessionLeafNode;

/** Folder node with children. */
export interface SessionFolderNode {
  type: "folder";
  id: string;
  name: string;
  parentId: string;
  sortOrder: number;
  expanded: boolean;
  children: SessionNode[];
}

/** Session leaf node. */
export interface SessionLeafNode {
  type: "session";
  id: string;
  name: string;
  protocol: Protocol;
  host?: string;
  port?: number;
  username?: string;
}

/** Input for creating a new session (no id — auto-generated). */
export interface CreateSessionInput {
  name: string;
  folderId?: string;
  protocol: Protocol;
  host?: string;
  port?: number;
  username?: string;
  credentialId?: string;
  serialPort?: string;
  serialBaud?: number;
  serialDataBits?: string;
  serialParity?: string;
  serialStopBits?: string;
  serialFlowControl?: string;
  colorScheme?: string;
  autoLog?: boolean;
  jumpHostId?: string;
  autoLogin?: boolean;
  autoLoginDeviceType?: string;
}

/** Input for updating a session (partial — only non-undefined fields apply). */
export interface UpdateSessionInput {
  name?: string;
  folderId?: string;
  protocol?: Protocol;
  host?: string;
  port?: number;
  username?: string;
  credentialId?: string;
  serialPort?: string;
  serialBaud?: number;
  serialDataBits?: string;
  serialParity?: string;
  serialStopBits?: string;
  serialFlowControl?: string;
  colorScheme?: string;
  autoLog?: boolean;
  jumpHostId?: string;
  autoLogin?: boolean;
  autoLoginDeviceType?: string;
}

/** Input for moving a session to a different folder. */
export interface MoveSessionInput {
  id: string;
  targetFolderId: string;
  sortOrder?: number;
}

/** Default port for each protocol. */
export const PROTOCOL_DEFAULT_PORTS: Record<Protocol, number | undefined> = {
  ssh: 22,
  telnet: 23,
  serial: undefined,
  local: undefined,
};

/** Human-readable labels for protocols. */
export const PROTOCOL_LABELS: Record<Protocol, string> = {
  ssh: "SSH",
  telnet: "Telnet",
  serial: "Serial",
  local: "Local Shell",
};
