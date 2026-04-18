/**
 * SettingsPanel — modal panel for API key configuration.
 *
 * Provides fields for Gateway URL and API Key, stored as JSON
 * in localStorage. Shows a warning about local storage. [CLEAN-CODE]
 *
 * @module
 */

import { useState, useCallback } from 'react';
import { X } from 'lucide-react';

/** localStorage key for settings. */
export const SETTINGS_STORAGE_KEY = 'infinicanvas:settings';

/** Custom event dispatched on same-tab settings save. */
export const SETTINGS_CHANGED_EVENT = 'infinicanvas:settings-changed';

/** Settings shape stored in localStorage. */
export interface AppSettings {
  gatewayUrl: string;
  apiKey: string;
}

/** Default settings values. */
const DEFAULT_SETTINGS: AppSettings = {
  gatewayUrl: '',
  apiKey: '',
};

/**
 * Load settings from localStorage.
 *
 * Returns default settings if localStorage is unavailable,
 * empty, or contains invalid JSON. [CLEAN-CODE]
 */
function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(raw);
    return {
      gatewayUrl: typeof parsed.gatewayUrl === 'string' ? parsed.gatewayUrl : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Save settings to localStorage.
 */
function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    // Dispatch custom event for same-tab listeners (storage event only fires cross-tab)
    window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT));
  } catch {
    // localStorage unavailable — silently continue
  }
}

/** Props for SettingsPanel component. */
interface SettingsPanelProps {
  onClose: () => void;
}

/**
 * Settings panel — modal for API key and gateway configuration.
 *
 * Fields: Gateway URL, Gateway API Key.
 * Stored in localStorage as JSON. Warns user about local storage.
 */
export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const handleChange = useCallback(
    (field: keyof AppSettings, value: string) => {
      setSettings((prev) => {
        const updated = { ...prev, [field]: value };
        saveSettings(updated);
        return updated;
      });
    },
    [],
  );

  return (
    <div
      data-testid="settings-panel"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        zIndex: 100,
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-toolbar, #ffffff)',
          borderRadius: 12,
          padding: '24px',
          maxWidth: 420,
          width: '90%',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text-primary, #333333)',
              fontFamily: 'system-ui, -apple-system, sans-serif',
            }}
          >
            Settings
          </h2>
          <button
            type="button"
            data-testid="settings-close"
            aria-label="Close settings"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              backgroundColor: 'transparent',
              color: 'var(--text-primary, #333333)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Gateway URL */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="settings-gateway-url"
            style={labelStyle}
          >
            Gateway URL
          </label>
          <input
            id="settings-gateway-url"
            data-testid="settings-gateway-url"
            type="url"
            placeholder="ws://localhost:3001"
            value={settings.gatewayUrl}
            onChange={(e) => handleChange('gatewayUrl', e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* API Key */}
        <div style={{ marginBottom: 16 }}>
          <label
            htmlFor="settings-api-key"
            style={labelStyle}
          >
            Gateway API Key
          </label>
          <input
            id="settings-api-key"
            data-testid="settings-api-key"
            type="password"
            placeholder="Enter API key"
            value={settings.apiKey}
            onChange={(e) => handleChange('apiKey', e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Warning */}
        <p
          style={{
            fontSize: 12,
            color: '#b58105',
            backgroundColor: '#fef9e7',
            padding: '8px 12px',
            borderRadius: 6,
            margin: 0,
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          ⚠ API keys are stored in your browser&apos;s local storage
        </p>
      </div>
    </div>
  );
}

/** Shared label style. */
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 4,
  color: 'var(--text-primary, #333333)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

/** Shared input style. */
const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  fontSize: 14,
  border: '1px solid var(--border, #e0e0e0)',
  borderRadius: 6,
  backgroundColor: 'var(--bg-canvas, #ffffff)',
  color: 'var(--text-primary, #333333)',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  outline: 'none',
  boxSizing: 'border-box',
};
