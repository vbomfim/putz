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
import "../Vault/VaultTab.css";

interface Theme {
  id: string;
  name: string;
  isBuiltin: boolean;
  colors: Record<string, string>;
}

const EFFECTS: { id: BackgroundEffect; label: string; desc: string }[] = [
  { id: "none", label: "None", desc: "Clean background" },
  { id: "matrix", label: "Matrix", desc: "Green digital rain" },
  { id: "starfield", label: "Starfield", desc: "3D star warp" },
  { id: "rain", label: "Rain", desc: "Falling digits" },
  { id: "network", label: "Network", desc: "Connected particles" },
];

export function SettingsTab() {
  const backgroundEffect = useSettingsStore((s) => s.backgroundEffect);
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity);
  const setBackgroundEffect = useSettingsStore((s) => s.setBackgroundEffect);
  const setBackgroundOpacity = useSettingsStore((s) => s.setBackgroundOpacity);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const setActiveTheme = useThemeStore((s) => s.setActiveTheme);
  const [themes, setThemes] = useState<Theme[]>([]);

  useEffect(() => {
    invoke<Theme[]>("theme_list").then(setThemes).catch(() => {});
  }, []);

  const handleThemeSelect = useCallback((theme: Theme) => {
    setActiveTheme(theme.id, theme.colors as unknown as Parameters<typeof setActiveTheme>[1]);
  }, [setActiveTheme]);

  const handleEffectChange = useCallback((effect: string) => {
    setBackgroundEffect(effect);
  }, [setBackgroundEffect]);

  return (
    <div className="vault-tab" style={{ padding: 0 }}>
      <div className="vault-tab__header">
        <span style={{ fontSize: 12, fontWeight: 600 }}>⚙️ Settings</span>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 24 }}>

        {/* ── Theme ───────────────────────────────────── */}
        <section>
          <h3 style={{ fontSize: 13, margin: "0 0 8px", color: "var(--text-primary)" }}>Color Theme</h3>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {themes.map((theme) => (
              <button
                key={theme.id}
                onClick={() => handleThemeSelect(theme)}
                style={{
                  padding: "6px 12px",
                  border: activeThemeId === theme.id ? "2px solid var(--accent)" : "1px solid var(--hover-bg)",
                  borderRadius: 6,
                  background: activeThemeId === theme.id ? "var(--accent)" : "var(--bg-secondary)",
                  color: activeThemeId === theme.id ? "white" : "var(--text-primary)",
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
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Loading themes…</span>
          )}
        </section>

        {/* ── Terminal Background ──────────────────────── */}
        <section>
          <h3 style={{ fontSize: 13, margin: "0 0 8px", color: "var(--text-primary)" }}>Terminal Background</h3>
          <p style={{ fontSize: 11, color: "var(--text-secondary)", margin: "0 0 12px" }}>
            Hostname watermark always shows when connected via SSH. Animated effects are optional.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)" }}>Animation Effect</label>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {EFFECTS.map((fx) => (
                <button
                  key={fx.id}
                  onClick={() => handleEffectChange(fx.id)}
                  style={{
                    padding: "6px 12px",
                    border: backgroundEffect === fx.id ? "2px solid var(--accent)" : "1px solid var(--hover-bg)",
                    borderRadius: 6,
                    background: backgroundEffect === fx.id ? "var(--accent)" : "var(--bg-secondary)",
                    color: backgroundEffect === fx.id ? "white" : "var(--text-primary)",
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
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>Opacity</label>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={backgroundOpacity}
                onChange={(e) => setBackgroundOpacity(parseFloat(e.target.value))}
                style={{ flex: 1 }}
              />
              <span style={{ fontSize: 11, color: "var(--text-secondary)", minWidth: 30 }}>
                {Math.round(backgroundOpacity * 100)}%
              </span>
            </div>
          )}
        </section>

        {/* ── Info ─────────────────────────────────────── */}
        <section>
          <h3 style={{ fontSize: 13, margin: "0 0 8px", color: "var(--text-primary)" }}>About</h3>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 4 }}>
            <span>Theme: {themes.find((t) => t.id === activeThemeId)?.name || activeThemeId}</span>
            <span>Background: {EFFECTS.find((e) => e.id === backgroundEffect)?.label || "None"}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
