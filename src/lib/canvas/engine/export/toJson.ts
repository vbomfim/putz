/**
 * Export canvas state to JSON.
 *
 * Serializes expressions and expression order with a version stamp
 * for future schema evolution. [CLEAN-CODE] [YAGNI]
 *
 * @module
 */

import type { VisualExpression } from "../../protocol";

/** Shape of the exported canvas JSON file. */
export interface ExportedCanvasState {
  /** Schema version for future compatibility. */
  version: string;
  /** All expressions keyed by ID. */
  expressions: Record<string, VisualExpression>;
  /** Z-order of expression IDs (back to front). */
  expressionOrder: string[];
}

/** Current export format version. */
const EXPORT_VERSION = "1.0";

/**
 * Serialize canvas state to a formatted JSON string.
 *
 * @param expressions - All expressions keyed by ID
 * @param expressionOrder - Z-order of expression IDs
 * @returns Formatted JSON string ready for download
 */
export function exportToJson(
  expressions: Record<string, VisualExpression>,
  expressionOrder: string[],
): string {
  const payload: ExportedCanvasState = {
    version: EXPORT_VERSION,
    expressions,
    expressionOrder,
  };
  return JSON.stringify(payload, null, 2);
}
