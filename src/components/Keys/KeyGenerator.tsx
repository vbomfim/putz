/**
 * KeyGenerator — form for generating new SSH key pairs.
 *
 * Provides fields for:
 * - Key name (required)
 * - Algorithm selection (Ed25519 / RSA-4096)
 * - Optional passphrase
 *
 * On submit, calls the key_generate IPC command and notifies the parent.
 */
import { useState, useCallback } from "react";
import type { KeyAlgorithm, GenerateKeyInput } from "./types";
import { KEY_ALGORITHM_LABELS } from "./types";
import { keyGenerate } from "./keysApi";

interface KeyGeneratorProps {
  /** Called after successful key generation with the new key's public key. */
  onGenerated: () => void;
  /** Called when the user cancels. */
  onCancel: () => void;
  /** Whether a generation is in progress. */
  isGenerating?: boolean;
}

export function KeyGenerator({
  onGenerated,
  onCancel,
  isGenerating: externalGenerating,
}: KeyGeneratorProps) {
  const [name, setName] = useState("");
  const [algorithm, setAlgorithm] = useState<KeyAlgorithm>("ed25519");
  const [passphrase, setPassphrase] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generating = externalGenerating || isGenerating;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim()) {
        setError("Key name is required");
        return;
      }

      try {
        setIsGenerating(true);
        setError(null);

        const input: GenerateKeyInput = {
          name: name.trim(),
          algorithm,
          ...(passphrase ? { passphrase } : {}),
        };

        await keyGenerate(input);
        onGenerated();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsGenerating(false);
      }
    },
    [name, algorithm, passphrase, onGenerated],
  );

  const algorithms: KeyAlgorithm[] = ["ed25519", "rsa-4096"];

  return (
    <div
      className="key-generator-overlay"
      data-testid="key-generator"
      role="dialog"
      aria-modal="true"
      aria-labelledby="key-generator-title"
    >
      <form className="key-generator" onSubmit={handleSubmit}>
        <h3 id="key-generator-title" className="key-generator-title">
          Generate SSH Key
        </h3>

        {error && (
          <div
            className="key-generator-error"
            data-testid="key-generator-error"
          >
            {error}
          </div>
        )}

        <div className="key-generator-field">
          <label htmlFor="key-name">Name</label>
          <input
            id="key-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production Server"
            disabled={generating}
            data-testid="key-name-input"
            autoFocus
          />
        </div>

        <div className="key-generator-field">
          <label htmlFor="key-algorithm">Algorithm</label>
          <select
            id="key-algorithm"
            value={algorithm}
            onChange={(e) => setAlgorithm(e.target.value as KeyAlgorithm)}
            disabled={generating}
            data-testid="key-algorithm-select"
          >
            {algorithms.map((alg) => (
              <option key={alg} value={alg}>
                {KEY_ALGORITHM_LABELS[alg]}
              </option>
            ))}
          </select>
        </div>

        <div className="key-generator-field">
          <label htmlFor="key-passphrase">Passphrase (optional)</label>
          <input
            id="key-passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Leave empty for no passphrase"
            disabled={generating}
            data-testid="key-passphrase-input"
          />
        </div>

        <div className="key-generator-actions">
          <button
            type="button"
            onClick={onCancel}
            disabled={generating}
            data-testid="key-generator-cancel"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={generating || !name.trim()}
            data-testid="key-generator-submit"
            className="primary"
          >
            {generating ? "Generating…" : "Generate"}
          </button>
        </div>
      </form>
    </div>
  );
}
