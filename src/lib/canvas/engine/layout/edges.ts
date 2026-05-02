/**
 * Edge extraction from arrow bindings.
 *
 * Shared utility for tree and force layout algorithms.
 * Extracts directed edges from arrow expressions based on
 * their start/end bindings.
 *
 * @module
 */

import type { VisualExpression } from "../../protocol";
import type { LayoutEdge } from "./types";

/**
 * Extract directed edges from arrow expressions.
 *
 * Only arrows with both startBinding and endBinding that reference
 * shapes in `validIds` produce edges. Arrows with partial bindings
 * or referencing non-existent shapes are ignored.
 *
 * @param arrows - Arrow expressions with binding data
 * @param validIds - Set of shape IDs that are valid edge endpoints
 * @returns Array of directed edges (source → target)
 */
export function extractEdges(
  arrows: VisualExpression[],
  validIds: Set<string>,
): LayoutEdge[] {
  const edges: LayoutEdge[] = [];

  for (const arrow of arrows) {
    if (arrow.data.kind !== "arrow") continue;

    const data = arrow.data as {
      startBinding?: { expressionId: string };
      endBinding?: { expressionId: string };
    };

    if (!data.startBinding || !data.endBinding) continue;

    const source = data.startBinding.expressionId;
    const target = data.endBinding.expressionId;

    if (validIds.has(source) && validIds.has(target)) {
      edges.push({ source, target });
    }
  }

  return edges;
}
