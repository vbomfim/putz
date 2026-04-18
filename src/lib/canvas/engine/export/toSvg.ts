/**
 * Export canvas to SVG string.
 *
 * Builds an SVG document from expressions using native SVG elements.
 * Supports rectangle, ellipse, diamond, line, arrow, and text primitives.
 * Composites and freehand are rendered as placeholder rectangles. [CLEAN-CODE]
 *
 * @module
 */

import type { VisualExpression } from '../../protocol';
import type { Theme } from '../store/uiStore';

/** Padding around exported SVG in world units. */
const SVG_PADDING = 20;

/** Background colors per theme. */
const BACKGROUND_COLORS: Record<Theme, string> = {
  light: '#ffffff',
  dark: '#1e1e1e',
};

/**
 * Build an SVG string from canvas expressions.
 *
 * Maps supported primitive kinds to native SVG elements.
 * Unsupported kinds are rendered as outlined rectangles.
 *
 * @param expressions - All expressions keyed by ID
 * @param expressionOrder - Z-order of expression IDs
 * @param theme - Current theme (affects background color)
 * @returns SVG markup string ready for download
 */
export function buildSvgString(
  expressions: Record<string, VisualExpression>,
  expressionOrder: string[],
  theme: Theme,
): string {
  // Compute bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of expressionOrder) {
    const expr = expressions[id];
    if (!expr) continue;
    const left = expr.position.x;
    const top = expr.position.y;
    const right = expr.position.x + expr.size.width;
    const bottom = expr.position.y + expr.size.height;
    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }

  // Default to 100x100 if empty
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }

  const vbX = minX - SVG_PADDING;
  const vbY = minY - SVG_PADDING;
  const vbW = maxX - minX + SVG_PADDING * 2;
  const vbH = maxY - minY + SVG_PADDING * 2;

  const bgColor = BACKGROUND_COLORS[theme];
  const elements: string[] = [];

  // Background rect
  elements.push(
    `<rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${bgColor}" />`,
  );

  // Render each expression
  for (const id of expressionOrder) {
    const expr = expressions[id];
    if (!expr) continue;
    elements.push(renderExpressionToSvg(expr));
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${vbW}" height="${vbH}">`,
    ...elements,
    '</svg>',
  ].join('\n');
}

/**
 * Render a single expression to an SVG element string.
 *
 * Maps expression kind to the appropriate SVG element.
 * Applies stroke/fill styles from the expression's style property.
 */
function renderExpressionToSvg(expr: VisualExpression): string {
  const { x, y } = expr.position;
  const { width, height } = expr.size;
  const stroke = expr.style.strokeColor;
  const fill = expr.style.backgroundColor === 'transparent' ? 'none' : expr.style.backgroundColor;
  const strokeWidth = expr.style.strokeWidth;

  switch (expr.kind) {
    case 'rectangle':
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" />`;

    case 'ellipse': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const rx = width / 2;
      const ry = height / 2;
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" />`;
    }

    case 'diamond': {
      const cx = x + width / 2;
      const cy = y + height / 2;
      const points = [
        `${cx},${y}`,
        `${x + width},${cy}`,
        `${cx},${y + height}`,
        `${x},${cy}`,
      ].join(' ');
      return `<polygon points="${points}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" />`;
    }

    case 'line': {
      const data = expr.data as { kind: 'line'; points: number[][] };
      if (data.points.length >= 2) {
        const [x1, y1] = data.points[0]!;
        const [x2, y2] = data.points[data.points.length - 1]!;
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
      }
      return '';
    }

    case 'arrow': {
      const data = expr.data as { kind: 'arrow'; points: number[][] };
      if (data.points.length >= 2) {
        const pathPoints = data.points.map(([px, py]) => `${px},${py}`).join(' ');
        return `<polyline points="${pathPoints}" stroke="${stroke}" fill="none" stroke-width="${strokeWidth}" marker-end="url(#arrowhead)" />`;
      }
      return '';
    }

    case 'text': {
      const data = expr.data as unknown as { kind: 'text'; content: string };
      const fontSize = expr.style.fontSize ?? 16;
      return `<text x="${x}" y="${y + fontSize}" font-size="${fontSize}" fill="${stroke}">${escapeXml(data.content)}</text>`;
    }

    case 'sticky-note':
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" stroke="${stroke}" fill="${fill || '#FFEB3B'}" stroke-width="${strokeWidth}" rx="4" />`;

    default:
      // Fallback for unsupported kinds (composites, freehand, image)
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" stroke="${stroke}" fill="${fill}" stroke-width="${strokeWidth}" stroke-dasharray="4" />`;
  }
}

/** Escape special XML characters for safe embedding. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Trigger download of SVG content as a file.
 *
 * @param svgContent - SVG markup string
 * @param filename - Name for the downloaded file
 */
export function downloadSvg(svgContent: string, filename: string): void {
  const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
