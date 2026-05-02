/**
 * BroadcastBar — Notification bar for active broadcast mode.
 *
 * Renders between the TabBar and the main content area when broadcast
 * mode is active. Shows the number of target tabs, allows toggling
 * individual tab targets via checkboxes, and provides a stop button.
 *
 * @module BroadcastBar
 */
import { useCallback } from "react";
import { useTabStore } from "../../stores/tabStore";
import { useBroadcastStore } from "../../stores/broadcastStore";
import "./BroadcastBar.css";

/** Broadcast control bar shown when broadcasting to multiple tabs. */
export function BroadcastBar() {
  const isActive = useBroadcastStore((s) => s.isActive);
  const targetTabIds = useBroadcastStore((s) => s.targetTabIds);
  const addTab = useBroadcastStore((s) => s.addTab);
  const removeTargetTab = useBroadcastStore((s) => s.removeTab);
  const deactivate = useBroadcastStore((s) => s.deactivate);

  const tabs = useTabStore((s) => s.tabs);
  const activeTabId = useTabStore((s) => s.activeTabId);

  const handleCheckboxChange = useCallback(
    (tabId: string, checked: boolean) => {
      if (checked) {
        addTab(tabId);
      } else {
        removeTargetTab(tabId);
      }
    },
    [addTab, removeTargetTab],
  );

  const handleStop = useCallback(() => {
    deactivate();
  }, [deactivate]);

  if (!isActive) return null;

  const targetCount = targetTabIds.size;
  const otherTabs = tabs.filter((t) => t.id !== activeTabId);

  return (
    <div
      className="broadcast-bar"
      role="status"
      aria-live="polite"
      data-testid="broadcast-bar"
    >
      <div className="broadcast-bar__indicator">
        <span
          className="broadcast-bar__icon"
          aria-hidden="true"
          data-testid="broadcast-icon"
        >
          📡
        </span>
        <span className="broadcast-bar__label" data-testid="broadcast-label">
          Broadcasting to {targetCount} tab{targetCount !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="broadcast-bar__targets" data-testid="broadcast-targets">
        {otherTabs.map((tab) => (
          <label
            key={tab.id}
            className="broadcast-bar__target"
            data-testid={`broadcast-target-${tab.id}`}
          >
            <input
              type="checkbox"
              checked={targetTabIds.has(tab.id)}
              onChange={(e) => handleCheckboxChange(tab.id, e.target.checked)}
              aria-label={`Broadcast to ${tab.title}`}
            />
            <span className="broadcast-bar__target-title">{tab.title}</span>
          </label>
        ))}
      </div>

      <button
        className="broadcast-bar__stop"
        onClick={handleStop}
        type="button"
        aria-label="Stop broadcasting"
        data-testid="broadcast-stop"
      >
        Stop
      </button>

      <span className="broadcast-bar__shortcut">Ctrl+Shift+A</span>
    </div>
  );
}
