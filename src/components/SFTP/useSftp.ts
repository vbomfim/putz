/**
 * React hook for SFTP session management and file operations.
 *
 * Handles SFTP session lifecycle, directory listing, file transfers,
 * and remote file operations via Tauri IPC commands.
 *
 * @module useSftp
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  RemoteFileEntry,
  RemoteFileStat,
  TransferInfo,
  TransferProgressPayload,
  TransferCompletePayload,
} from "./types";

interface UseSftpOptions {
  /** SSH connection ID to open SFTP on. */
  connectionId: string;
}

interface UseSftpReturn {
  /** SFTP session ID (null if not connected). */
  sessionId: string | null;
  /** Whether SFTP session is ready. */
  isReady: boolean;
  /** Error message if session setup failed. */
  error: string | null;
  /** Current remote directory path. */
  currentPath: string;
  /** Files in the current directory. */
  files: RemoteFileEntry[];
  /** Whether a directory listing is in progress. */
  isLoading: boolean;
  /** Active and recent transfers. */
  transfers: TransferInfo[];

  /** Navigate to a directory. */
  navigateTo: (path: string) => Promise<void>;
  /** Navigate up one directory level. */
  navigateUp: () => Promise<void>;
  /** Refresh current directory listing. */
  refresh: () => Promise<void>;
  /** Download a remote file to a local path. */
  download: (remotePath: string, localPath: string) => Promise<string>;
  /** Upload a local file to a remote path. */
  upload: (localPath: string, remotePath: string) => Promise<string>;
  /** Rename a remote file or directory. */
  rename: (oldPath: string, newPath: string) => Promise<void>;
  /** Delete a remote file or directory. */
  deleteFile: (path: string) => Promise<void>;
  /** Create a new remote directory. */
  mkdir: (path: string) => Promise<void>;
  /** Get file metadata. */
  stat: (path: string) => Promise<RemoteFileStat>;
  /** Close the SFTP session. */
  close: () => Promise<void>;
}

/**
 * React hook that manages an SFTP session lifecycle.
 *
 * Opens an SFTP subsystem channel on an existing SSH connection,
 * provides file browsing and transfer capabilities.
 */
export function useSftp({ connectionId }: UseSftpOptions): UseSftpReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<RemoteFileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [transfers, setTransfers] = useState<TransferInfo[]>([]);

  const sessionIdRef = useRef<string | null>(null);
  const unlistenersRef = useRef<UnlistenFn[]>([]);

  // Open SFTP session on mount
  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      try {
        const sid = await invoke<string>("sftp_open", {
          connectionId,
        });

        if (disposed) {
          invoke("sftp_close", { sftpSessionId: sid }).catch(() => {});
          return;
        }

        sessionIdRef.current = sid;
        setSessionId(sid);
        setIsReady(true);

        // Load initial directory
        const entries = await invoke<RemoteFileEntry[]>("sftp_list", {
          sftpSessionId: sid,
          path: "/",
        });

        if (!disposed) {
          setFiles(entries);
        }
      } catch (err: unknown) {
        if (!disposed) {
          const message = err instanceof Error ? err.message : String(err);
          setError(`SFTP connection failed: ${message}`);
        }
      }
    };

    setup();

    return () => {
      disposed = true;
      // Cleanup event listeners
      for (const unlisten of unlistenersRef.current) {
        unlisten();
      }
      unlistenersRef.current = [];

      // Close SFTP session
      if (sessionIdRef.current) {
        invoke("sftp_close", {
          sftpSessionId: sessionIdRef.current,
        }).catch(() => {});
        sessionIdRef.current = null;
      }
    };
  }, [connectionId]);

  const navigateTo = useCallback(
    async (path: string) => {
      const sid = sessionIdRef.current;
      if (!sid) return;

      setIsLoading(true);
      try {
        const entries = await invoke<RemoteFileEntry[]>("sftp_list", {
          sftpSessionId: sid,
          path,
        });
        setFiles(entries);
        setCurrentPath(path);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Failed to list directory: ${message}`);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const navigateUp = useCallback(async () => {
    if (currentPath === "/") return;
    const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
    await navigateTo(parent);
  }, [currentPath, navigateTo]);

  const refresh = useCallback(async () => {
    await navigateTo(currentPath);
  }, [currentPath, navigateTo]);

  const download = useCallback(
    async (remotePath: string, localPath: string): Promise<string> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("SFTP session not ready");

      const transferId = await invoke<string>("sftp_download", {
        sftpSessionId: sid,
        remotePath,
        localPath,
      });

      // Add to transfers list
      const newTransfer: TransferInfo = {
        transferId,
        sftpSessionId: sid,
        remotePath,
        localPath,
        direction: "download",
        status: "queued",
        bytesTransferred: 0,
        totalBytes: 0,
        speed: 0,
        etaSeconds: 0,
      };
      setTransfers((prev) => [...prev, newTransfer]);

      // Listen for progress events
      const unlistenProgress = await listen<TransferProgressPayload>(
        `sftp-progress-${transferId}`,
        (event) => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.transferId === transferId
                ? {
                    ...t,
                    status: event.payload.status,
                    bytesTransferred: event.payload.bytesTransferred,
                    totalBytes: event.payload.totalBytes,
                    speed: event.payload.speed,
                    etaSeconds: event.payload.etaSeconds,
                  }
                : t,
            ),
          );
        },
      );
      unlistenersRef.current.push(unlistenProgress);

      // Listen for completion event
      const unlistenComplete = await listen<TransferCompletePayload>(
        `sftp-complete-${transferId}`,
        (event) => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.transferId === transferId
                ? {
                    ...t,
                    status: event.payload.status,
                    bytesTransferred: event.payload.bytesTransferred,
                    error: event.payload.error,
                  }
                : t,
            ),
          );
        },
      );
      unlistenersRef.current.push(unlistenComplete);

      return transferId;
    },
    [],
  );

  const upload = useCallback(
    async (localPath: string, remotePath: string): Promise<string> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("SFTP session not ready");

      const transferId = await invoke<string>("sftp_upload", {
        sftpSessionId: sid,
        localPath,
        remotePath,
      });

      const newTransfer: TransferInfo = {
        transferId,
        sftpSessionId: sid,
        remotePath,
        localPath,
        direction: "upload",
        status: "queued",
        bytesTransferred: 0,
        totalBytes: 0,
        speed: 0,
        etaSeconds: 0,
      };
      setTransfers((prev) => [...prev, newTransfer]);

      // Progress and completion listeners (same pattern as download)
      const unlistenProgress = await listen<TransferProgressPayload>(
        `sftp-progress-${transferId}`,
        (event) => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.transferId === transferId
                ? {
                    ...t,
                    status: event.payload.status,
                    bytesTransferred: event.payload.bytesTransferred,
                    totalBytes: event.payload.totalBytes,
                    speed: event.payload.speed,
                    etaSeconds: event.payload.etaSeconds,
                  }
                : t,
            ),
          );
        },
      );
      unlistenersRef.current.push(unlistenProgress);

      const unlistenComplete = await listen<TransferCompletePayload>(
        `sftp-complete-${transferId}`,
        (event) => {
          setTransfers((prev) =>
            prev.map((t) =>
              t.transferId === transferId
                ? {
                    ...t,
                    status: event.payload.status,
                    bytesTransferred: event.payload.bytesTransferred,
                    error: event.payload.error,
                  }
                : t,
            ),
          );
        },
      );
      unlistenersRef.current.push(unlistenComplete);

      return transferId;
    },
    [],
  );

  const renameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("SFTP session not ready");
      await invoke("sftp_rename", {
        sftpSessionId: sid,
        oldPath,
        newPath,
      });
    },
    [],
  );

  const deleteFile = useCallback(
    async (path: string) => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("SFTP session not ready");
      await invoke("sftp_delete", { sftpSessionId: sid, path });
    },
    [],
  );

  const mkdir = useCallback(
    async (path: string) => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("SFTP session not ready");
      await invoke("sftp_mkdir", { sftpSessionId: sid, path });
    },
    [],
  );

  const statFile = useCallback(
    async (path: string): Promise<RemoteFileStat> => {
      const sid = sessionIdRef.current;
      if (!sid) throw new Error("SFTP session not ready");
      return invoke<RemoteFileStat>("sftp_stat", {
        sftpSessionId: sid,
        path,
      });
    },
    [],
  );

  const closeSession = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await invoke("sftp_close", { sftpSessionId: sid });
    } catch {
      // Ignore — session may already be closed
    }
    sessionIdRef.current = null;
    setSessionId(null);
    setIsReady(false);
  }, []);

  return {
    sessionId,
    isReady,
    error,
    currentPath,
    files,
    isLoading,
    transfers,
    navigateTo,
    navigateUp,
    refresh,
    download,
    upload,
    rename: renameFile,
    deleteFile,
    mkdir,
    stat: statFile,
    close: closeSession,
  };
}
