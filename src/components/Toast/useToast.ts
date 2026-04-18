/**
 * useToast — Hook for managing toast state.
 *
 * Returns [message, showToast, dismissToast].
 * Uses a "single replace" pattern: each new toast supersedes the previous.
 *
 * @module useToast
 */
import { useState, useCallback, useRef } from "react";
import type { ToastMessage } from "./Toast";

/** Hook that manages toast state. Returns [message, showToast, dismissToast]. */
export function useToast(): [
  ToastMessage | null,
  (text: string) => void,
  () => void,
] {
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const counterRef = useRef(0);

  const showToast = useCallback((text: string) => {
    counterRef.current += 1;
    setMessage({ key: counterRef.current, text });
  }, []);

  const dismissToast = useCallback(() => {
    setMessage(null);
  }, []);

  return [message, showToast, dismissToast];
}
