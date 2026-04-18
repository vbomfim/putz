/**
 * HistoryManager — snapshot-based undo/redo system.
 *
 * Maintains two stacks (undo and redo) of deep-cloned canvas snapshots.
 * Each snapshot captures `expressions` and `expressionOrder` before a
 * content mutation occurs.
 *
 * Design decisions [CLEAN-CODE] [SRP]:
 * - Pure class with no framework dependency (testable in isolation)
 * - Deep clones on push/pop to prevent reference aliasing
 * - Configurable max stack size (default 100) [YAGNI exception: ticket requirement]
 *
 * @module
 */

import type { VisualExpression } from '../../protocol';

/** Immutable snapshot of canvas content state. */
export interface CanvasSnapshot {
  /** All expressions on the canvas, keyed by ID. */
  expressions: Record<string, VisualExpression>;
  /** Ordered list of expression IDs representing z-order (back to front). */
  expressionOrder: string[];
}

/** Default maximum number of snapshots in the undo stack. */
const DEFAULT_MAX_SIZE = 100;

/**
 * Deep-clone a CanvasSnapshot to prevent reference aliasing.
 *
 * Uses structuredClone for a reliable deep copy that handles
 * nested objects, arrays, and all VisualExpression fields.
 */
function cloneSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  return structuredClone(snapshot);
}

/**
 * Snapshot-based undo/redo history manager.
 *
 * Usage:
 * 1. Before each content mutation, call `pushSnapshot(currentState)`
 * 2. To undo, call `undo(currentState)` — returns previous state or null
 * 3. To redo, call `redo(currentState)` — returns next state or null
 *
 * Invariants:
 * - Undo stack never exceeds `maxSize` entries
 * - Pushing a new snapshot clears the redo stack (history diverges)
 * - All snapshots are deep-cloned on entry and exit
 */
export class HistoryManager {
  private undoStack: CanvasSnapshot[] = [];
  private redoStack: CanvasSnapshot[] = [];
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * Push a snapshot onto the undo stack.
   * Clears the redo stack (new action diverges history). [AC4]
   * Evicts oldest snapshot if stack exceeds maxSize. [AC5]
   */
  pushSnapshot(snapshot: CanvasSnapshot): void {
    this.undoStack.push(cloneSnapshot(snapshot));
    this.redoStack = [];

    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }
  }

  /**
   * Undo: pop from undo stack, push current state to redo stack.
   * Returns the previous snapshot, or null if nothing to undo. [AC6]
   */
  undo(currentState: CanvasSnapshot): CanvasSnapshot | null {
    const previous = this.undoStack.pop();
    if (!previous) {
      return null;
    }

    this.redoStack.push(cloneSnapshot(currentState));
    return cloneSnapshot(previous);
  }

  /**
   * Redo: pop from redo stack, push current state to undo stack.
   * Returns the next snapshot, or null if nothing to redo. [AC7]
   */
  redo(currentState: CanvasSnapshot): CanvasSnapshot | null {
    const next = this.redoStack.pop();
    if (!next) {
      return null;
    }

    this.undoStack.push(cloneSnapshot(currentState));
    return cloneSnapshot(next);
  }

  /** Whether undo is available. [AC9] */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether redo is available. [AC9] */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Reset all history stacks. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }
}
