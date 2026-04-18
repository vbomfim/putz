/**
 * Rectangle drawing tool.
 *
 * Click+drag → dashed preview → on release if >10×10, create rectangle expression.
 *
 * @module
 */

import { AreaShapeTool } from './AreaShapeTool';

/** Tool handler for drawing rectangles on the canvas. */
export class RectangleTool extends AreaShapeTool {
  constructor() {
    super('rectangle');
  }
}
