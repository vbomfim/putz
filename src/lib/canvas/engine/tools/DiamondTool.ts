/**
 * Diamond drawing tool.
 *
 * Click+drag → dashed preview → on release if >10×10, create diamond expression.
 *
 * @module
 */

import { AreaShapeTool } from './AreaShapeTool';
import type { CanvasStoreApi } from '../store/canvasStore';

/** Tool handler for drawing diamonds on the canvas. */
export class DiamondTool extends AreaShapeTool {
  constructor(store: CanvasStoreApi) {
    super('diamond', store);
  }
}
