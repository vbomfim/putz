/**
 * UpdateChecker — Auto-update notification component.
 *
 * Checks for updates on startup using tauri-plugin-updater,
 * and displays a notification bar when a new version is available.
 *
 * User can choose to:
 * - **Update Now** — downloads and installs, then relaunches
 * - **Later** — dismisses until next app restart
 * - **Skip** — dismisses and remembers the skipped version in localStorage
 *
 * @module UpdateChecker
 */
import { useEffect, useState, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import "./UpdateChecker.css";

/** localStorage key for the version the user chose to skip. */
const SKIPPED_VERSION_KEY = "putz-skipped-version";

/** State of the update check lifecycle. */
type UpdateState =
  | { status: "idle" }
  | { status: "available"; version: string; body: string; update: UpdateHandle }
  | { status: "downloading" }
  | { status: "error"; message: string }
  | { status: "dismissed" };

/** Minimal interface for the update object from tauri-plugin-updater. */
interface UpdateHandle {
  downloadAndInstall: () => Promise<void>;
}

/**
 * Check for updates on mount and show a notification if one is available.
 *
 * Renders nothing when no update is available or when dismissed.
 */
export function UpdateChecker() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    let cancelled = false;

    async function checkForUpdate() {
      try {
        const update = await check();

        if (cancelled || !update) return;

        const skippedVersion = localStorage.getItem(SKIPPED_VERSION_KEY);
        if (skippedVersion && update.version === skippedVersion) return;

        setState({
          status: "available",
          version: update.version,
          body: update.body ?? "",
          update: update as unknown as UpdateHandle,
        });
      } catch {
        // Silently ignore update check errors — not critical
      }
    }

    checkForUpdate();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpdateNow = useCallback(async () => {
    if (state.status !== "available") return;
    const { update } = state;

    setState({ status: "downloading" });

    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch {
      setState({
        status: "error",
        message: "Update download failed. Please try again later.",
      });
    }
  }, [state]);

  const handleLater = useCallback(() => {
    setState({ status: "dismissed" });
  }, []);

  const handleSkip = useCallback(() => {
    if (state.status === "available") {
      localStorage.setItem(SKIPPED_VERSION_KEY, state.version);
    }
    setState({ status: "dismissed" });
  }, [state]);

  // Render nothing for idle, dismissed, or no-update states
  if (state.status === "idle" || state.status === "dismissed") {
    return null;
  }

  if (state.status === "downloading") {
    return (
      <div
        className="update-notification update-notification--downloading"
        data-testid="update-notification"
        role="alert"
      >
        <span className="update-notification__message">
          Downloading update…
        </span>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="update-notification update-notification--error"
        data-testid="update-notification"
        role="alert"
      >
        <span className="update-notification__message">
          Update failed. Please try again later.
        </span>
        <button
          className="update-notification__btn"
          onClick={handleLater}
          type="button"
        >
          Dismiss
        </button>
      </div>
    );
  }

  if (state.status === "available") {
    return (
      <div
        className="update-notification"
        data-testid="update-notification"
        role="alert"
      >
        <span className="update-notification__message">
          Putz v{state.version} available
        </span>
        <div className="update-notification__actions">
          <button
            className="update-notification__btn update-notification__btn--primary"
            onClick={handleUpdateNow}
            type="button"
          >
            Update Now
          </button>
          <button
            className="update-notification__btn"
            onClick={handleLater}
            type="button"
          >
            Later
          </button>
          <button
            className="update-notification__btn"
            onClick={handleSkip}
            type="button"
          >
            Skip
          </button>
        </div>
      </div>
    );
  }

  return null;
}
