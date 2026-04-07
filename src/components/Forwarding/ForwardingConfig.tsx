/**
 * ForwardingConfig — form for configuring port forwarding rules.
 *
 * Used within the session editor to define forwarding rules that
 * activate when the SSH session connects. Also usable as a standalone
 * dialog for ad-hoc forwarding on active sessions.
 *
 * Features:
 * - Add/remove forwarding rules (local, remote, dynamic)
 * - Security warning for non-loopback bind addresses
 * - Validation of required fields per forwarding type
 *
 * @module ForwardingConfig
 */
import { useState, useCallback } from "react";
import type { ForwardingRuleInput, ForwardingType } from "./types";
import { FORWARDING_TYPE_LABELS, formatForwardingRule } from "./types";
import "./Forwarding.css";

interface ForwardingConfigProps {
  /** Current list of forwarding rules. */
  rules: ForwardingRuleInput[];
  /** Called when rules change. */
  onChange: (rules: ForwardingRuleInput[]) => void;
  /** Whether the form is read-only. */
  disabled?: boolean;
}

/** All forwarding type options. */
const FORWARDING_TYPES: ForwardingType[] = ["local", "remote", "dynamic"];

/** Validation errors keyed by field name. */
interface RuleErrors {
  localPort?: string;
  remoteHost?: string;
  remotePort?: string;
  bindAddress?: string;
}

export function ForwardingConfig({
  rules,
  onChange,
  disabled = false,
}: ForwardingConfigProps) {
  const [forwardingType, setForwardingType] =
    useState<ForwardingType>("local");
  const [localPort, setLocalPort] = useState("");
  const [remoteHost, setRemoteHost] = useState("");
  const [remotePort, setRemotePort] = useState("");
  const [bindAddress, setBindAddress] = useState("");
  const [errors, setErrors] = useState<RuleErrors>({});
  const [showWarning, setShowWarning] = useState(false);

  /** Validates the current form fields. */
  const validate = useCallback((): boolean => {
    const newErrors: RuleErrors = {};
    const port = parseInt(localPort, 10);

    if (!localPort || isNaN(port) || port < 1 || port > 65535) {
      newErrors.localPort = "Valid port (1–65535) required";
    }

    if (forwardingType !== "dynamic") {
      if (!remoteHost.trim()) {
        newErrors.remoteHost = "Remote host required";
      }
      const rp = parseInt(remotePort, 10);
      if (!remotePort || isNaN(rp) || rp < 1 || rp > 65535) {
        newErrors.remotePort = "Valid port (1–65535) required";
      }
    }

    if (bindAddress.trim()) {
      const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$|^::1?$|^[0-9a-fA-F:]+$/;
      if (!ipRegex.test(bindAddress.trim())) {
        newErrors.bindAddress = "Invalid IP address";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [forwardingType, localPort, remoteHost, remotePort, bindAddress]);

  /** Adds a new forwarding rule. */
  const handleAdd = useCallback(() => {
    if (!validate()) return;

    const addr = bindAddress.trim() || undefined;
    const isAllInterfaces = addr === "0.0.0.0" || addr === "::";

    if (isAllInterfaces && !showWarning) {
      setShowWarning(true);
      return;
    }

    const rule: ForwardingRuleInput = {
      forwardingType,
      localPort: parseInt(localPort, 10),
      remoteHost: forwardingType !== "dynamic" ? remoteHost.trim() : undefined,
      remotePort:
        forwardingType !== "dynamic"
          ? parseInt(remotePort, 10)
          : undefined,
      bindAddress: addr,
    };

    onChange([...rules, rule]);

    // Reset form
    setLocalPort("");
    setRemoteHost("");
    setRemotePort("");
    setBindAddress("");
    setErrors({});
    setShowWarning(false);
  }, [
    validate,
    forwardingType,
    localPort,
    remoteHost,
    remotePort,
    bindAddress,
    rules,
    onChange,
    showWarning,
  ]);

  /** Removes a rule by index. */
  const handleRemove = useCallback(
    (index: number) => {
      onChange(rules.filter((_, i) => i !== index));
    },
    [rules, onChange],
  );

  return (
    <div className="forwarding-config" data-testid="forwarding-config">
      <h4>Port Forwarding</h4>

      {/* Existing rules */}
      {rules.length > 0 && (
        <div className="forwarding-rules-list" data-testid="forwarding-rules-list">
          {rules.map((rule, index) => (
            <div key={index} className="forwarding-rule-item">
              <span className="forwarding-rule-type">
                {FORWARDING_TYPE_LABELS[rule.forwardingType]}
              </span>
              <span className="forwarding-rule-desc">
                {formatForwardingRule(rule)}
              </span>
              {!disabled && (
                <button
                  className="forwarding-rule-remove"
                  onClick={() => handleRemove(index)}
                  title="Remove rule"
                  data-testid={`remove-rule-${index}`}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new rule form */}
      {!disabled && (
        <div className="forwarding-add-form" data-testid="forwarding-add-form">
          <div className="forwarding-form-row">
            <label>
              Type
              <select
                value={forwardingType}
                onChange={(e) => {
                  setForwardingType(e.target.value as ForwardingType);
                  setErrors({});
                  setShowWarning(false);
                }}
                data-testid="forwarding-type-select"
              >
                {FORWARDING_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FORWARDING_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Local Port
              <input
                type="number"
                value={localPort}
                onChange={(e) => setLocalPort(e.target.value)}
                placeholder="8080"
                min={1}
                max={65535}
                data-testid="local-port-input"
              />
              {errors.localPort && (
                <span className="forwarding-error">{errors.localPort}</span>
              )}
            </label>
          </div>

          {forwardingType !== "dynamic" && (
            <div className="forwarding-form-row">
              <label>
                Remote Host
                <input
                  type="text"
                  value={remoteHost}
                  onChange={(e) => setRemoteHost(e.target.value)}
                  placeholder="db.internal"
                  data-testid="remote-host-input"
                />
                {errors.remoteHost && (
                  <span className="forwarding-error">{errors.remoteHost}</span>
                )}
              </label>

              <label>
                Remote Port
                <input
                  type="number"
                  value={remotePort}
                  onChange={(e) => setRemotePort(e.target.value)}
                  placeholder="5432"
                  min={1}
                  max={65535}
                  data-testid="remote-port-input"
                />
                {errors.remotePort && (
                  <span className="forwarding-error">{errors.remotePort}</span>
                )}
              </label>
            </div>
          )}

          <div className="forwarding-form-row">
            <label>
              Bind Address
              <input
                type="text"
                value={bindAddress}
                onChange={(e) => {
                  setBindAddress(e.target.value);
                  setShowWarning(false);
                }}
                placeholder="127.0.0.1 (default)"
                data-testid="bind-address-input"
              />
              {errors.bindAddress && (
                <span className="forwarding-error">{errors.bindAddress}</span>
              )}
            </label>

            <button
              className="forwarding-add-btn"
              onClick={handleAdd}
              data-testid="add-rule-btn"
            >
              Add Rule
            </button>
          </div>

          {showWarning && (
            <div
              className="forwarding-security-warning"
              data-testid="security-warning"
            >
              ⚠️ Binding to all interfaces ({bindAddress}) exposes the tunnel
              to the network. Click &ldquo;Add Rule&rdquo; again to confirm.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
