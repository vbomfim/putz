/**
 * SettingsTab — App preferences as a tab.
 *
 * Sections: Terminal Background, Appearance, Editor.
 *
 * @module SettingsTab
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/settingsStore";
import { useThemeStore } from "../../stores/themeStore";
import type { BackgroundEffect } from "../Terminal/TerminalBackground";
import { ShellIntegrationPanel } from "./ShellIntegrationPanel";
import "../../styles/tab-list.css";

interface Theme {
  id: string;
  name: string;
  isBuiltin: boolean;
  colors: Record<string, string>;
}

interface SwarmState {
  enabled: boolean;
  url: string | null;
  colleague_count: number;
  colleague_ids: string[];
}

const EFFECTS: { id: BackgroundEffect; label: string; desc: string }[] = [
  { id: "none", label: "None", desc: "Clean background" },
  { id: "matrix", label: "Matrix", desc: "Green digital rain" },
  { id: "starfield", label: "Starfield", desc: "3D star warp" },
  { id: "rain", label: "Rain", desc: "Falling digits" },
  { id: "network", label: "Network", desc: "Connected particles" },
  { id: "copilot", label: "Copilot", desc: "Animated Copilot avatar" },
];

export function SettingsTab() {
  const backgroundEffect = useSettingsStore((s) => s.backgroundEffect);
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity);
  const backgroundColorMode = useSettingsStore((s) => s.backgroundColorMode);
  const backgroundCustomColor = useSettingsStore(
    (s) => s.backgroundCustomColor,
  );
  const backgroundSpeed = useSettingsStore((s) => s.backgroundSpeed);
  const setBackgroundEffect = useSettingsStore((s) => s.setBackgroundEffect);
  const setBackgroundOpacity = useSettingsStore((s) => s.setBackgroundOpacity);
  const setBackgroundColorMode = useSettingsStore(
    (s) => s.setBackgroundColorMode,
  );
  const setBackgroundCustomColor = useSettingsStore(
    (s) => s.setBackgroundCustomColor,
  );
  const setBackgroundSpeed = useSettingsStore((s) => s.setBackgroundSpeed);
  const backgroundSize = useSettingsStore((s) => s.backgroundSize);
  const setBackgroundSize = useSettingsStore((s) => s.setBackgroundSize);
  const defaultShell = useSettingsStore((s) => s.defaultShell);
  const setDefaultShell = useSettingsStore((s) => s.setDefaultShell);
  const swarmEnabled = useSettingsStore((s) => s.swarmEnabled);
  const setSwarmEnabled = useSettingsStore((s) => s.setSwarmEnabled);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [availableShells, setAvailableShells] = useState<
    { name: string; path: string }[]
  >([]);
  const [swarmState, setSwarmState] = useState<SwarmState | null>(null);

  useEffect(() => {
    invoke<Theme[]>("theme_list")
      .then(setThemes)
      .catch(() => {});
    invoke<{ name: string; path: string }[]>("pty_list_shells")
      .then(setAvailableShells)
      .catch(() => {});
    invoke<SwarmState>("swarm_get_state")
      .then(setSwarmState)
      .catch(() => {});
  }, []);

  const handleSwarmToggle = useCallback(async () => {
    const next = !swarmEnabled;
    setSwarmEnabled(next);
    try {
      await invoke("swarm_set_enabled", { enabled: next });
      const state = await invoke<SwarmState>("swarm_get_state");
      setSwarmState(state);
    } catch (err) {
      // Revert on failure
      setSwarmEnabled(!next);
      console.warn("[SettingsTab] swarm toggle failed:", err);
    }
  }, [swarmEnabled, setSwarmEnabled]);

  const handleThemeSelect = useCallback(
    (theme: Theme) => {
      setActiveTheme(
        theme.id,
        theme.colors as unknown as Parameters<typeof setActiveTheme>[1],
      );
    },
    [setActiveTheme],
  );

  const handleEffectChange = useCallback(
    (effect: string) => {
      setBackgroundEffect(effect);
      if (effect === "copilot" && backgroundOpacity < 0.25) {
        setBackgroundOpacity(0.3);
      }
    },
    [setBackgroundEffect, setBackgroundOpacity, backgroundOpacity],
  );

  return (
    <div className="vault-tab" style={{ padding: 0 }}>
      <div className="vault-tab__header">
        <span style={{ fontSize: 12, fontWeight: 600 }}>⚙️ Settings</span>
      </div>

      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        {/* ── Theme ───────────────────────────────────── */}
        <section>
          <h3
            style={{
              fontSize: 13,
              margin: "0 0 8px",
              color: "var(--text-primary)",
            }}
          >
            Color Theme
          </h3>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {themes.map((theme) => (
              <button
                key={theme.id}
                onClick={() => handleThemeSelect(theme)}
                style={{
                  padding: "6px 12px",
                  border:
                    activeThemeId === theme.id
                      ? "2px solid var(--accent)"
                      : "1px solid var(--hover-bg)",
                  borderRadius: 6,
                  background:
                    activeThemeId === theme.id
                      ? "var(--accent)"
                      : "var(--bg-secondary)",
                  color:
                    activeThemeId === theme.id
                      ? "white"
                      : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
              >
                {theme.name}
                {!theme.isBuiltin && " ✦"}
              </button>
            ))}
          </div>
          {themes.length === 0 && (
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Loading themes…
            </span>
          )}
        </section>

        {/* ── Terminal Background ──────────────────────── */}
        <section>
          <h3
            style={{
              fontSize: 13,
              margin: "0 0 8px",
              color: "var(--text-primary)",
            }}
          >
            Terminal Background
          </h3>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              margin: "0 0 12px",
            }}
          >
            Animated effects are optional eye-candy behind the terminal.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Animation Effect
            </label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {EFFECTS.map((fx) => (
                <button
                  key={fx.id}
                  onClick={() => handleEffectChange(fx.id)}
                  style={{
                    padding: "6px 12px",
                    border:
                      backgroundEffect === fx.id
                        ? "2px solid var(--accent)"
                        : "1px solid var(--hover-bg)",
                    borderRadius: 6,
                    background:
                      backgroundEffect === fx.id
                        ? "var(--accent)"
                        : "var(--bg-secondary)",
                    color:
                      backgroundEffect === fx.id
                        ? "white"
                        : "var(--text-primary)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontFamily: "inherit",
                  }}
                  title={fx.desc}
                >
                  {fx.label}
                </button>
              ))}
            </div>
          </div>

          {backgroundEffect !== "none" && (
            <>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <label
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                    minWidth: 50,
                  }}
                >
                  Opacity
                </label>
                <input
                  type="range"
                  min="0.05"
                  max="1"
                  step="0.05"
                  value={backgroundOpacity}
                  onChange={(e) =>
                    setBackgroundOpacity(parseFloat(e.target.value))
                  }
                  style={{ flex: 1 }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    minWidth: 30,
                  }}
                >
                  {Math.round(backgroundOpacity * 100)}%
                </span>
              </div>

              <div
                style={{
                  marginTop: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <label
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                    minWidth: 50,
                  }}
                >
                  Speed
                </label>
                <input
                  type="range"
                  min="0.2"
                  max="3"
                  step="0.1"
                  value={backgroundSpeed}
                  onChange={(e) =>
                    setBackgroundSpeed(parseFloat(e.target.value))
                  }
                  style={{ flex: 1 }}
                />
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--text-secondary)",
                    minWidth: 30,
                  }}
                >
                  {backgroundSpeed.toFixed(1)}×
                </span>
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Size
                </label>
                <div style={{ display: "flex", gap: 4 }}>
                  {(["small", "medium", "large"] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setBackgroundSize(s)}
                      style={{
                        padding: "4px 10px",
                        border:
                          backgroundSize === s
                            ? "2px solid var(--accent)"
                            : "1px solid var(--hover-bg)",
                        borderRadius: 6,
                        background:
                          backgroundSize === s
                            ? "var(--accent)"
                            : "var(--bg-secondary)",
                        color:
                          backgroundSize === s
                            ? "white"
                            : "var(--text-primary)",
                        cursor: "pointer",
                        fontSize: 12,
                        fontFamily: "inherit",
                        textTransform: "capitalize",
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Color
                </label>
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  {(
                    [
                      ["theme", "Theme", "Uses terminal foreground color"],
                      ["rainbow", "🌈 Rainbow", "Cycles through all colors"],
                      [
                        "multicolor",
                        "🎨 Original",
                        "Copilot's purple/cyan/green colors",
                      ],
                      ["custom", "Custom", "Pick your own color"],
                    ] as const
                  ).map(([mode, label, title]) => (
                    <button
                      key={mode}
                      onClick={() => setBackgroundColorMode(mode)}
                      style={{
                        padding: "4px 10px",
                        border:
                          backgroundColorMode === mode
                            ? "2px solid var(--accent)"
                            : "1px solid var(--hover-bg)",
                        borderRadius: 6,
                        background:
                          backgroundColorMode === mode
                            ? "var(--accent)"
                            : "var(--bg-secondary)",
                        color:
                          backgroundColorMode === mode
                            ? "white"
                            : "var(--text-primary)",
                        cursor: "pointer",
                        fontSize: 12,
                        fontFamily: "inherit",
                      }}
                      title={title}
                    >
                      {label}
                    </button>
                  ))}
                  {backgroundColorMode === "custom" && (
                    <input
                      type="color"
                      value={backgroundCustomColor}
                      onChange={(e) => setBackgroundCustomColor(e.target.value)}
                      style={{
                        width: 32,
                        height: 28,
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </section>

        {/* ── Default Shell ────────────────────────────── */}
        <section>
          <h3
            style={{
              fontSize: 13,
              margin: "0 0 8px",
              color: "var(--text-primary)",
            }}
          >
            Default Shell
          </h3>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              margin: "0 0 8px",
            }}
          >
            New terminal tabs will use this shell. Applies to next tab opened.
          </p>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            <button
              onClick={() => setDefaultShell("")}
              style={{
                padding: "6px 12px",
                border: !defaultShell
                  ? "2px solid var(--accent)"
                  : "1px solid var(--hover-bg)",
                borderRadius: 6,
                background: !defaultShell
                  ? "var(--accent)"
                  : "var(--bg-secondary)",
                color: !defaultShell ? "white" : "var(--text-primary)",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
              }}
            >
              System Default
            </button>
            {availableShells.map((shell) => (
              <button
                key={shell.path}
                onClick={() => setDefaultShell(shell.path)}
                style={{
                  padding: "6px 12px",
                  border:
                    defaultShell === shell.path
                      ? "2px solid var(--accent)"
                      : "1px solid var(--hover-bg)",
                  borderRadius: 6,
                  background:
                    defaultShell === shell.path
                      ? "var(--accent)"
                      : "var(--bg-secondary)",
                  color:
                    defaultShell === shell.path
                      ? "white"
                      : "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "inherit",
                }}
                title={shell.path}
              >
                {shell.name}
              </button>
            ))}
          </div>
        </section>

        {/* ── Copilot Swarm ─────────────────────────── */}
        <section>
          <h3
            style={{
              fontSize: 13,
              margin: "0 0 8px",
              color: "var(--text-primary)",
            }}
          >
            Copilot Swarm
          </h3>
          <p
            style={{
              fontSize: 11,
              color: "var(--text-secondary)",
              margin: "0 0 12px",
            }}
          >
            Enable a local HTTP broker so Copilot CLI agents running in terminal
            tabs can discover, message, and coordinate with each other. The
            broker binds to 127.0.0.1 only — no external network access.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={handleSwarmToggle}
              style={{
                padding: "6px 16px",
                border: swarmEnabled
                  ? "2px solid var(--accent)"
                  : "1px solid var(--hover-bg)",
                borderRadius: 6,
                background: swarmEnabled
                  ? "var(--accent)"
                  : "var(--bg-secondary)",
                color: swarmEnabled ? "white" : "var(--text-primary)",
                cursor: "pointer",
                fontSize: 12,
                fontFamily: "inherit",
                fontWeight: swarmEnabled ? 600 : 400,
              }}
            >
              {swarmEnabled ? "● Enabled" : "○ Disabled"}
            </button>
            {swarmState && swarmEnabled && swarmState.url && (
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                Broker: {swarmState.url} · {swarmState.colleague_count}{" "}
                colleague{swarmState.colleague_count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          {/* L3: PII / sensitive-data warning */}
          <p
            style={{
              fontSize: 10,
              color: "var(--text-tertiary, #888)",
              margin: "8px 0 0",
              fontStyle: "italic",
            }}
          >
            ⚠ Messages exchanged between swarm agents may contain prompts with
            sensitive data. The broker runs locally and does not transmit data
            externally, but exercise caution when using agent prompts that
            reference personal or confidential information.
          </p>
        </section>

        {/* ── Shell Integration ────────────────────────── */}
        <ShellIntegrationPanel />

        {/* ── Info ─────────────────────────────────────── */}
        <section>
          <h3
            style={{
              fontSize: 13,
              margin: "0 0 8px",
              color: "var(--text-primary)",
            }}
          >
            About
          </h3>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-secondary)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <span>
              Theme:{" "}
              {themes.find((t) => t.id === activeThemeId)?.name ||
                activeThemeId}
            </span>
            <span>
              Background:{" "}
              {EFFECTS.find((e) => e.id === backgroundEffect)?.label || "None"}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
