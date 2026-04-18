/**
 * LocalStorage persistence for canvas state.
 *
 * Serializes/deserializes the minimal canvas state (expressions, order,
 * camera) to localStorage. Transient state (selection, undo history,
 * operationLog) is intentionally excluded. [YAGNI] [AC9]
 *
 * Error handling strategy:
 * - Corrupt JSON → console.warn, return null [AC5]
 * - Quota exceeded → console.error, continue [AC6]
 * - localStorage unavailable → catch, continue [AC7]
 *
 * @module
 */

import type { VisualExpression } from '../../protocol';
import { visualExpressionSchema } from '../../protocol';
import type { Camera } from '../types/index';

/** The localStorage key used for persisted canvas state. [AC8] */
export const STORAGE_KEY = 'infinicanvas:state';

/** Shape of the persisted state — only the fields worth saving. [AC9] */
export interface PersistedCanvasState {
  expressions: Record<string, VisualExpression>;
  expressionOrder: string[];
  camera: Camera;
}

/**
 * Serialize and save canvas state to localStorage.
 *
 * Only persists expressions, expressionOrder, and camera.
 * Undo/redo history, selection, and operationLog are excluded. [AC9]
 *
 * @param state - The canvas state subset to persist
 */
export function saveCanvasState(state: PersistedCanvasState): void {
  try {
    const json = JSON.stringify({
      expressions: state.expressions,
      expressionOrder: state.expressionOrder,
      camera: state.camera,
    });
    localStorage.setItem(STORAGE_KEY, json);
  } catch (error: unknown) {
    if (isDOMException(error, 'QuotaExceededError')) {
      console.error('[persistence] Storage quota exceeded — state not saved.', error);
    } else {
      console.error('[persistence] Failed to save canvas state.', error);
    }
  }
}

/**
 * Load and validate canvas state from localStorage.
 *
 * Returns null (and logs a warning) if:
 * - No saved state exists [AC3]
 * - Data is corrupt JSON [AC5]
 * - Data fails structural validation [AC5]
 * - localStorage is unavailable [AC7]
 *
 * @returns The persisted state, or null if unavailable/invalid
 */
export function loadCanvasState(): PersistedCanvasState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === '') {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (parseError: unknown) {
      console.warn('[persistence] Corrupt JSON in saved state — starting fresh.', parseError);
      return null;
    }

    if (!isValidPersistedState(parsed)) {
      console.warn(
        '[persistence] Invalid saved state structure — starting fresh.',
        parsed,
      );
      return null;
    }

    // Per-expression Zod validation [S7-2]
    const validated = validateExpressions(parsed);

    return validated;
  } catch {
    // localStorage unavailable [AC7]
    return null;
  }
}

/**
 * Structural validation for persisted state. [CLEAN-CODE]
 *
 * Checks that the parsed data has the required shape:
 * - expressions: object (Record)
 * - expressionOrder: array of strings
 * - camera: { x: number, y: number, zoom: number }
 */
function isValidPersistedState(data: unknown): data is PersistedCanvasState {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return false;
  }

  const record = data as Record<string, unknown>;

  if (
    typeof record.expressions !== 'object' ||
    record.expressions === null ||
    Array.isArray(record.expressions)
  ) {
    return false;
  }

  if (!Array.isArray(record.expressionOrder)) {
    return false;
  }

  if (!isValidCamera(record.camera)) {
    return false;
  }

  return true;
}

/** Validate camera shape: { x: number, y: number, zoom: number }. */
function isValidCamera(camera: unknown): camera is Camera {
  if (typeof camera !== 'object' || camera === null) {
    return false;
  }

  const cam = camera as Record<string, unknown>;
  return (
    typeof cam.x === 'number' &&
    typeof cam.y === 'number' &&
    typeof cam.zoom === 'number' &&
    Number.isFinite(cam.x) &&
    Number.isFinite(cam.y) &&
    Number.isFinite(cam.zoom)
  );
}

/** Type guard for DOMException with a specific name. */
function isDOMException(error: unknown, name: string): boolean {
  return error instanceof DOMException && error.name === name;
}

/**
 * Validate each expression in persisted state using Zod schema. [S7-2]
 *
 * Filters out invalid expressions and logs warnings for rejected ones.
 * Uses Zod-stripped output (result.data) to prevent prototype pollution.
 *
 * @returns A new PersistedCanvasState with only valid expressions
 */
function validateExpressions(state: PersistedCanvasState): PersistedCanvasState {
  const validExpressions: Record<string, VisualExpression> = {};
  const validIds = new Set<string>();

  for (const [id, expr] of Object.entries(state.expressions)) {
    const result = visualExpressionSchema.safeParse(expr);
    if (result.success) {
      const validated = result.data as VisualExpression;
      validExpressions[validated.id] = validated;
      validIds.add(validated.id);
    } else {
      console.warn(
        `[persistence] Invalid expression filtered out (id=${id}):`,
        result.error.issues,
      );
    }
  }

  return {
    expressions: validExpressions,
    expressionOrder: state.expressionOrder.filter((id) => validIds.has(id)),
    camera: state.camera,
  };
}
