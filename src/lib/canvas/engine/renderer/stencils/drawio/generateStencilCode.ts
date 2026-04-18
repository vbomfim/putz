/**
 * Draw.io stencil code generation — pure functions.
 *
 * Converts parsed `DrawioStencilLibrary` data into TypeScript source
 * code: SVG export modules and catalog registration files.
 *
 * All functions are pure (no I/O) and deterministic, making them
 * easy to test in isolation from the download/write pipeline.
 *
 * @module
 */

import type { DrawioShape, DrawioStencilLibrary } from '../../../../protocol';

// ── Constants ────────────────────────────────────────────────

/** Default stencil icon size (matches ICON_SIZE in stencilCatalog). */
const DEFAULT_STENCIL_SIZE = 44;

// ── Name normalization ───────────────────────────────────────

/**
 * Normalize a raw string segment into a lowercase kebab-case token.
 *
 * Replaces non-alphanumeric characters with hyphens, collapses
 * consecutive hyphens, and trims leading/trailing hyphens.
 */
function toKebab(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Normalize a raw string segment into SCREAMING_SNAKE_CASE.
 *
 * Replaces non-alphanumeric characters with underscores, collapses
 * consecutive underscores, and trims leading/trailing underscores.
 */
function toScreamingSnake(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Generate a stencil catalog ID from library name and shape name.
 *
 * Format: `drawio-{library}-{shapename}` (lowercase, hyphens).
 *
 * @param libraryName - Library identifier (e.g., "aws", "gcp")
 * @param shapeName - Shape name from draw.io XML (may contain spaces/special chars)
 * @returns Normalized stencil ID
 * @throws {Error} If libraryName or shapeName is empty/whitespace-only
 */
export function normalizeStencilId(libraryName: string, shapeName: string): string {
  if (!libraryName.trim()) {
    throw new Error('normalizeStencilId: libraryName must not be empty');
  }
  if (!shapeName.trim()) {
    throw new Error('normalizeStencilId: shapeName must not be empty');
  }
  const lib = toKebab(libraryName);
  const shape = toKebab(shapeName);
  return `drawio-${lib}-${shape}`;
}

/**
 * Generate a TypeScript export constant name from library and shape.
 *
 * Format: `DRAWIO_{LIBRARY}_{SHAPENAME}_SVG` (SCREAMING_SNAKE_CASE).
 *
 * @param libraryName - Library identifier
 * @param shapeName - Shape name from draw.io XML
 * @returns Normalized export name
 * @throws {Error} If libraryName or shapeName is empty/whitespace-only
 */
export function normalizeExportName(libraryName: string, shapeName: string): string {
  if (!libraryName.trim()) {
    throw new Error('normalizeExportName: libraryName must not be empty');
  }
  if (!shapeName.trim()) {
    throw new Error('normalizeExportName: shapeName must not be empty');
  }
  const lib = toScreamingSnake(libraryName);
  const shape = toScreamingSnake(shapeName);
  return `DRAWIO_${lib}_${shape}_SVG`;
}

// ── Template literal safety ──────────────────────────────────

/**
 * Escape a string for safe embedding inside a JS template literal.
 *
 * Escapes backticks and `${` interpolation sequences.
 */
function escapeTemplateLiteral(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
}

// ── Export name deduplication ─────────────────────────────────

/**
 * Deduplicate an export name against a set of already-used names.
 *
 * If the name collides, appends an incrementing numeric suffix before `_SVG`.
 * The chosen name is added to `usedNames` before returning.
 */
function deduplicateExportName(
  exportName: string,
  usedNames: Set<string>,
): string {
  let result = exportName;
  if (usedNames.has(result)) {
    let counter = 2;
    const base = result.replace(/_SVG$/, '');
    while (usedNames.has(`${base}_${counter}_SVG`)) {
      counter++;
    }
    result = `${base}_${counter}_SVG`;
  }
  usedNames.add(result);
  return result;
}

/**
 * Deduplicate a stencil ID against a set of already-used IDs.
 *
 * If the ID collides, appends `-2`, `-3`, etc.
 * The chosen ID is added to `usedIds` before returning.
 */
function deduplicateStencilId(
  stencilId: string,
  usedIds: Set<string>,
): string {
  let result = stencilId;
  if (usedIds.has(result)) {
    let counter = 2;
    while (usedIds.has(`${stencilId}-${counter}`)) {
      counter++;
    }
    result = `${stencilId}-${counter}`;
  }
  usedIds.add(result);
  return result;
}

// ── String safety helpers ────────────────────────────────────

/**
 * Escape a string for safe embedding inside a JS single-quoted string literal.
 *
 * Handles backslashes, single quotes, newlines, and carriage returns.
 */
function escapeSingleQuotedString(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Strip newlines and carriage returns from a string for safe use in `//` comments.
 */
function sanitizeComment(raw: string): string {
  return raw.replace(/[\n\r]/g, ' ');
}

// ── SVG module generation ────────────────────────────────────

/**
 * Generate a TypeScript module with named SVG string exports.
 *
 * Each shape becomes a `export const DRAWIO_*_SVG = \`...\`;` statement.
 * Duplicate export names are disambiguated with numeric suffixes.
 *
 * @param libraryName - Library identifier (used in header + export names)
 * @param shapes - Parsed draw.io shapes to export
 * @returns TypeScript source code string, or empty string if no shapes
 */
export function generateSvgModule(
  libraryName: string,
  shapes: readonly DrawioShape[],
): string {
  if (shapes.length === 0) return '';

  const lines: string[] = [
    '// AUTO-GENERATED — DO NOT EDIT',
    `// Source: draw.io stencil library '${sanitizeComment(libraryName)}'`,
    '// Generated by: scripts/generate-drawio-stencils.ts',
    '',
  ];

  const usedNames = new Set<string>();

  for (const shape of shapes) {
    const exportName = deduplicateExportName(
      normalizeExportName(libraryName, shape.name),
      usedNames,
    );

    const escapedSvg = escapeTemplateLiteral(shape.svg);
    lines.push(`export const ${exportName} = \`${escapedSvg}\`;`);
    lines.push('');
  }

  return lines.join('\n');
}

// ── Catalog registration generation ──────────────────────────

/**
 * Build export-name → shape mapping for a library, handling deduplication.
 *
 * Returns entries in the same order as the input shapes array.
 */
function buildExportMap(
  libraryName: string,
  shapes: readonly DrawioShape[],
): Array<{ exportName: string; stencilId: string; label: string }> {
  const usedNames = new Set<string>();
  const usedIds = new Set<string>();
  const entries: Array<{ exportName: string; stencilId: string; label: string }> = [];

  for (const shape of shapes) {
    const exportName = deduplicateExportName(
      normalizeExportName(libraryName, shape.name),
      usedNames,
    );

    const stencilId = deduplicateStencilId(
      normalizeStencilId(libraryName, shape.name),
      usedIds,
    );

    entries.push({
      exportName,
      stencilId,
      label: shape.name,
    });
  }

  return entries;
}

/**
 * Generate a TypeScript module that registers draw.io stencils into `STENCIL_CATALOG`.
 *
 * Imports SVG constants from the per-library SVG modules and calls
 * `STENCIL_CATALOG.set()` for each shape.
 *
 * @param libraries - Parsed draw.io stencil libraries
 * @returns TypeScript source code string, or empty string if no shapes
 */
export function generateCatalogRegistration(
  libraries: readonly DrawioStencilLibrary[],
): string {
  // Filter out libraries with no shapes
  const nonEmpty = libraries.filter((lib) => lib.shapes.length > 0);
  if (nonEmpty.length === 0) return '';

  const lines: string[] = [
    '// AUTO-GENERATED — DO NOT EDIT',
    '// Generated by: scripts/generate-drawio-stencils.ts',
    '',
    "import { STENCIL_CATALOG } from '../stencilCatalog';",
  ];

  // Build export maps for each library
  const libraryMaps = nonEmpty.map((lib) => ({
    library: lib,
    exports: buildExportMap(lib.name, lib.shapes),
  }));

  // Generate import statements
  for (const { library, exports: libExports } of libraryMaps) {
    const libKebab = toKebab(library.name);
    const importNames = libExports.map((e) => e.exportName).join(',\n  ');
    lines.push(`import {\n  ${importNames},\n} from './svgs/${libKebab}';`);
  }

  lines.push('');

  // Generate registration calls
  for (const { library, exports: libExports } of libraryMaps) {
    const libKebab = toKebab(library.name);
    const category = `drawio-${libKebab}`;
    lines.push(`// Register ${sanitizeComment(library.name)} stencils`);

    for (const entry of libExports) {
      lines.push(`STENCIL_CATALOG.set('${entry.stencilId}', {`);
      lines.push(`  id: '${entry.stencilId}',`);
      lines.push(`  category: '${category}',`);
      lines.push(`  label: '${escapeSingleQuotedString(entry.label)}',`);
      lines.push(`  svgContent: ${entry.exportName},`);
      lines.push(`  defaultSize: { width: ${DEFAULT_STENCIL_SIZE}, height: ${DEFAULT_STENCIL_SIZE} },`);
      lines.push('});');
    }

    lines.push('');
  }

  return lines.join('\n');
}
