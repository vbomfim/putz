/**
 * Shared XML utility functions for the draw.io module.
 *
 * Provides safe XML escaping/unescaping used by both the serializer
 * and the stencil parser.
 *
 * @module
 */

/**
 * Escape the five predefined XML entities for safe attribute values
 * and text content.
 *
 * Handles: `&`, `<`, `>`, `"`, `'`
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Unescape the five predefined XML entities.
 *
 * Required because `processEntities: false` in fast-xml-parser disables
 * ALL entity processing (including the 5 predefined XML entities).
 * We re-enable just the safe, predefined set here.
 */
export function unescapeXml(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}
