/**
 * Text drawing tool.
 *
 * Click → creates empty text expression → immediately starts inline editing.
 * The text tool now uses the unified text editor (same as double-click editing).
 * If the user commits empty text, the expression is deleted automatically.
 *
 * @module
 */

import { nanoid } from "nanoid";
import type { VisualExpression } from "../../protocol";
import type { ToolHandler, DrawPreview } from "./BaseTool";
import type { CanvasStoreApi } from "../store/canvasStore";

/** Default text properties. */
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = "sans-serif";
const DEFAULT_TEXT_ALIGN = "left" as const;

/** Default text expression size. */
const TEXT_WIDTH = 200;
const TEXT_HEIGHT = 50;

/** Human author for locally-drawn expressions. */
const LOCAL_AUTHOR = {
  type: "human" as const,
  id: "local-user",
  name: "You",
};

/**
 * Tool handler for creating text expressions on the canvas.
 *
 * Creates a temporary text expression on click and immediately starts
 * inline editing via the unified TextEditor. The separate TextInputOverlay
 * is no longer needed.
 */
export class TextTool implements ToolHandler {
  private readonly store: CanvasStoreApi;
  private inputPosition: { x: number; y: number } | null = null;
  private startEditingFn: ((id: string) => void) | null = null;

  constructor(store: CanvasStoreApi) {
    this.store = store;
  }

  /**
   * Register the inline editor's startEditing callback.
   *
   * Called once by Canvas.tsx to wire up the text tool with the
   * unified inline editor.
   */
  setStartEditing(fn: (id: string) => void): void {
    this.startEditingFn = fn;
  }

  onPointerDown(_worldX: number, _worldY: number, _event: PointerEvent): void {
    // If already waiting for input, cancel first
    if (this.inputPosition) {
      this.onCancel();
    }
  }

  onPointerMove(_worldX: number, _worldY: number, _event: PointerEvent): void {
    // Text tool has no drag preview
  }

  onPointerUp(worldX: number, worldY: number, _event: PointerEvent): void {
    // Create an empty text expression at the click position
    const id = this.createTextExpression(worldX, worldY);
    this.inputPosition = { x: worldX, y: worldY };

    // Immediately start editing via the unified inline editor
    if (this.startEditingFn) {
      this.startEditingFn(id);
    }
  }

  onCancel(): void {
    this.inputPosition = null;
  }

  getPreview(): DrawPreview | null {
    // Text tool has no drag preview
    return null;
  }

  /** Get the world position where text input should appear (legacy compat). */
  getInputPosition(): { x: number; y: number } | null {
    return this.inputPosition;
  }

  /**
   * Commit the text content and create the expression.
   *
   * @deprecated Use the unified inline editor instead.
   * Kept for backward compatibility with tests.
   */
  commitText(text: string): void {
    if (!this.inputPosition || !text.trim()) {
      this.inputPosition = null;
      return;
    }

    const now = Date.now();
    const id = nanoid();

    const expression: VisualExpression = {
      id,
      kind: "text",
      position: { x: this.inputPosition.x, y: this.inputPosition.y },
      size: { width: TEXT_WIDTH, height: TEXT_HEIGHT },
      angle: 0,
      style: { ...this.store.getState().lastUsedStyle },
      meta: {
        author: LOCAL_AUTHOR,
        createdAt: now,
        updatedAt: now,
        tags: [],
        locked: false,
      },
      data: {
        kind: "text",
        text,
        fontSize: DEFAULT_FONT_SIZE,
        fontFamily: DEFAULT_FONT_FAMILY,
        textAlign: DEFAULT_TEXT_ALIGN,
      },
    };

    const store = this.store.getState();
    store.addExpression(expression);
    store.setSelectedIds(new Set([id]));

    this.inputPosition = null;
  }

  /**
   * Create an empty text expression at the given position.
   *
   * Returns the expression ID so the caller can start editing.
   */
  private createTextExpression(worldX: number, worldY: number): string {
    const now = Date.now();
    const id = nanoid();
    const { camera } = this.store.getState();

    // Scale size and font inversely by zoom so text appears consistent on screen
    const zoom = camera.zoom;
    const w = TEXT_WIDTH / zoom;
    const h = TEXT_HEIGHT / zoom;
    const fontSize = Math.round(DEFAULT_FONT_SIZE / zoom);

    const expression: VisualExpression = {
      id,
      kind: "text",
      position: { x: worldX, y: worldY },
      size: { width: w, height: h },
      angle: 0,
      style: { ...this.store.getState().lastUsedStyle },
      meta: {
        author: LOCAL_AUTHOR,
        createdAt: now,
        updatedAt: now,
        tags: [],
        locked: false,
      },
      data: {
        kind: "text",
        text: "",
        fontSize,
        fontFamily: DEFAULT_FONT_FAMILY,
        textAlign: DEFAULT_TEXT_ALIGN,
      },
    };

    const store = this.store.getState();
    store.addExpression(expression);
    store.setSelectedIds(new Set([id]));

    return id;
  }
}
