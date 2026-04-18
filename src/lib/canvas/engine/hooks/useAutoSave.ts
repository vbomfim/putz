/**
 * Auto-save hook — subscribes to Zustand store changes and
 * debounces saves to localStorage.
 *
 * Subscribes to expressions, expressionOrder, and camera.
 * Debounces saves by 2000ms after the last change. [AC1]
 * Does NOT persist undo/redo history, selection, or operationLog. [AC9]
 *
 * @module
 */

import { useCanvasStore } from '../store/canvasStore';
import { saveCanvasState } from '../persistence/localStorage';
import type { PersistedCanvasState } from '../persistence/localStorage';

/** Debounce delay in milliseconds for auto-save. [AC1] */
export const DEBOUNCE_MS = 2000;

/**
 * Subscribe to Zustand store changes and auto-save with debounce.
 *
 * Listens for changes to expressions, expressionOrder, and camera.
 * Changes to selection, activeTool, operationLog, and undo state
 * are ignored. [AC9]
 *
 * Returns an unsubscribe function that stops the subscription
 * and clears any pending debounce timer.
 *
 * This is a vanilla (non-React) subscriber so it can be used
 * outside of React components (e.g., store initialization). [SOLID: SRP]
 *
 * @returns Unsubscribe function to stop auto-save
 */
export function subscribeAutoSave(): () => void {
  let timerId: ReturnType<typeof setTimeout> | null = null;

  /** Track previous values to detect actual changes. [CLEAN-CODE] */
  let prevExpressions = useCanvasStore.getState().expressions;
  let prevOrder = useCanvasStore.getState().expressionOrder;
  let prevCamera = useCanvasStore.getState().camera;

  /** Select only the persistable fields from the store. [AC9] */
  function selectPersistedState(): PersistedCanvasState {
    const state = useCanvasStore.getState();
    return {
      expressions: state.expressions,
      expressionOrder: state.expressionOrder,
      camera: state.camera,
    };
  }

  /** Debounced save — resets timer on each call. [AC1] */
  function debouncedSave(): void {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      saveCanvasState(selectPersistedState());
    }, DEBOUNCE_MS);
  }

  // Zustand v5 subscribe(listener) — fires on every state change.
  // We manually check if the persisted fields actually changed.
  const unsubscribe = useCanvasStore.subscribe((state) => {
    const changed =
      state.expressions !== prevExpressions ||
      state.expressionOrder !== prevOrder ||
      state.camera !== prevCamera;

    if (changed) {
      prevExpressions = state.expressions;
      prevOrder = state.expressionOrder;
      prevCamera = state.camera;
      debouncedSave();
    }
  });

  return () => {
    // Clear pending debounce timer [CLEAN-CODE]
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    unsubscribe();
  };
}
