/**
 * Diamond drawing tool.
 *
 * Click+drag → dashed preview → on release if >10×10, create diamond expression.
 *
 * @module
 */

import { AreaShapeTool } from './AreaShapeTool';

/** Tool handler for drawing diamonds on the canvas. */
export class DiamondTool extends AreaShapeTool {
  constructor() {
    super('diamond');
  }
}
