/**
 * Ellipse drawing tool.
 *
 * Click+drag → dashed preview → on release if >10×10, create ellipse expression.
 *
 * @module
 */

import { AreaShapeTool } from './AreaShapeTool';

/** Tool handler for drawing ellipses on the canvas. */
export class EllipseTool extends AreaShapeTool {
  constructor() {
    super('ellipse');
  }
}
