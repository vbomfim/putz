/**
 * Import canvas state from JSON.
 *
 * Parses a JSON string, validates structure and individual expressions
 * using Zod schemas from the protocol package. Returns a discriminated
 * result type for safe error handling. [CLEAN-CODE] [SOLID]
 *
 * @module
 */

import { visualExpressionSchema } from '../../protocol';
import type { VisualExpression } from '../../protocol';

/** Successful import result. */
export interface ImportSuccess {
  success: true;
  data: {
    expressions: VisualExpression[];
    expressionOrder: string[];
  };
}

/** Failed import result with error message. */
export interface ImportError {
  success: false;
  error: string;
}

/** Discriminated union for import results. */
export type ImportResult = ImportSuccess | ImportError;

/**
 * Import and validate canvas state from a JSON string.
 *
 * Validates:
 * 1. JSON syntax
 * 2. Top-level structure (version, expressions, expressionOrder)
 * 3. Each individual expression against Zod schema
 *
 * @param jsonString - Raw JSON string to parse and validate
 * @returns ImportResult — either success with data or error with message
 */
export function importFromJson(jsonString: string): ImportResult {
  if (!jsonString || jsonString.trim() === '') {
    return { success: false, error: 'Invalid JSON: empty input' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return { success: false, error: 'Invalid JSON: failed to parse' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { success: false, error: 'Invalid format: expected an object' };
  }

  const record = parsed as Record<string, unknown>;

  // Validate version field
  if (typeof record.version !== 'string') {
    return { success: false, error: 'Missing or invalid "version" field' };
  }

  // Validate expressions field
  if (typeof record.expressions !== 'object' || record.expressions === null || Array.isArray(record.expressions)) {
    return { success: false, error: 'Missing or invalid "expressions" field' };
  }

  // Validate expressionOrder field
  if (!Array.isArray(record.expressionOrder)) {
    return { success: false, error: 'Missing or invalid "expressionOrder" field' };
  }

  const expressionsRecord = record.expressions as Record<string, unknown>;
  const expressionOrder = record.expressionOrder as string[];

  // Validate each expression against Zod schema
  const validExpressions: VisualExpression[] = [];
  for (const [id, exprData] of Object.entries(expressionsRecord)) {
    const result = visualExpressionSchema.safeParse(exprData);
    if (!result.success) {
      const issues = result.error.issues.map((i) => i.message).join(', ');
      return {
        success: false,
        error: `Invalid expression "${id}": ${issues}`,
      };
    }
    validExpressions.push(result.data as VisualExpression);
  }

  return {
    success: true,
    data: {
      expressions: validExpressions,
      expressionOrder,
    },
  };
}
