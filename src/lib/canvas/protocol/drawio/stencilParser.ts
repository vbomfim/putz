/**
 * draw.io XML Stencil → SVG Converter.
 *
 * Converts draw.io stencil library XML files into SVG strings that
 * InfiniCanvas can render. Supports path commands, shape elements,
 * paint operations (fill/stroke/fillstroke), state commands, and
 * connection points.
 *
 * **Known limitation:** `fast-xml-parser` groups sibling elements by tag
 * name, which means interleaved `<save/>`/`<restore/>` blocks that wrap
 * different drawing commands may not restore state at the correct point
 * in the rendering sequence.  In practice, most draw.io stencils do not
 * use deeply interleaved save/restore.  Switching to `preserveOrder: true`
 * would fix this but requires a significant refactor of the node iteration
 * logic (tracked as a future enhancement).
 *
 * @see https://github.com/jgraph/drawio/tree/dev/src/main/webapp/stencils
 * @module
 */

import { XMLParser } from "fast-xml-parser";
import { escapeXml } from "./xmlUtils";

// ── Public types ──────────────────────────────────────────

/** A connection point on a draw.io shape (0–1 ratio coordinates). */
export interface ConnectionPoint {
  /** Horizontal position (0 = left, 1 = right). */
  x: number;
  /** Vertical position (0 = top, 1 = bottom). */
  y: number;
  /** Named identifier (e.g., "N", "E", "S", "W"). */
  name: string;
}

/** A single parsed draw.io shape with its generated SVG. */
export interface DrawioShape {
  /** Shape name from the XML `name` attribute. */
  name: string;
  /** Intrinsic width from the XML `w` attribute. */
  width: number;
  /** Intrinsic height from the XML `h` attribute. */
  height: number;
  /** Aspect ratio mode: "fixed" preserves ratio, "variable" allows stretching. */
  aspect: "fixed" | "variable";
  /** Generated SVG string ready for rendering. */
  svg: string;
  /** Named connection points for wiring. */
  connections: ConnectionPoint[];
}

/** A parsed draw.io stencil library containing multiple shapes. */
export interface DrawioStencilLibrary {
  /** Library name from the root `<shapes>` element. */
  name: string;
  /** All shapes found in the library. */
  shapes: DrawioShape[];
}

// ── XML parser setup ──────────────────────────────────────

/** Maximum input size for stencil library XML (10 MB). */
const MAX_INPUT_SIZE = 10_000_000;

/** Maximum number of shapes allowed in a single library. */
const MAX_SHAPE_COUNT = 2_000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: false,
  isArray: (tagName) => tagName === "shape" || tagName === "constraint",
});

// ── Internal types (parsed XML nodes) ─────────────────────

/** Any parsed XML node — attributes are `@_`-prefixed strings. */
interface XmlNode {
  [key: string]: unknown;
}

// ── Graphics state ────────────────────────────────────────

/** Mutable graphics state applied during SVG generation. */
interface GfxState {
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
}

/** Create a default (currentColor) graphics state. */
function defaultGfxState(): GfxState {
  return {
    strokeColor: "currentColor",
    fillColor: "currentColor",
    strokeWidth: 1,
  };
}

/** Deep-clone a graphics state for save/restore. */
function cloneGfxState(state: GfxState): GfxState {
  return { ...state };
}

// ── Path command conversion ───────────────────────────────

/**
 * Build an SVG path `d` string from a parsed `<path>` node.
 *
 * fast-xml-parser groups sibling elements by tag name, so we lose
 * the original interleaving.  For stencil paths this is acceptable
 * because draw.io stencils typically declare paths in a natural
 * order: one or more moves, followed by draws, closed at the end.
 *
 * We iterate tag groups in the order they appear in the parsed object
 * (V8 preserves insertion order for string keys).
 */
function buildPathD(node: XmlNode): string {
  const parts: string[] = [];

  for (const [tag, value] of Object.entries(node)) {
    if (tag.startsWith("@_")) continue; // skip attributes
    const items = Array.isArray(value)
      ? (value as XmlNode[])
      : [value as XmlNode];

    for (const item of items) {
      switch (tag) {
        case "move":
          parts.push(`M ${attr(item, "x")} ${attr(item, "y")}`);
          break;
        case "line":
          parts.push(`L ${attr(item, "x")} ${attr(item, "y")}`);
          break;
        case "curve":
          parts.push(
            `C ${attr(item, "x1")} ${attr(item, "y1")}, ` +
              `${attr(item, "x2")} ${attr(item, "y2")}, ` +
              `${attr(item, "x3")} ${attr(item, "y3")}`,
          );
          break;
        case "quad":
          parts.push(
            `Q ${attr(item, "x1")} ${attr(item, "y1")}, ` +
              `${attr(item, "x2")} ${attr(item, "y2")}`,
          );
          break;
        case "arc":
          parts.push(
            `A ${attr(item, "rx")} ${attr(item, "ry")} ` +
              `${attr(item, "x-rotation")} ${attr(item, "large-arc-flag")} ` +
              `${attr(item, "sweep-flag")} ${attr(item, "x")} ${attr(item, "y")}`,
          );
          break;
        case "close":
          parts.push("Z");
          break;
        // Ignore unknown tags inside <path>
      }
    }
  }

  return parts.join(" ");
}

/**
 * Read an attribute from a parsed node, XML-escaped for safe interpolation
 * into SVG attribute strings. Returns '0' when the attribute is missing.
 */
function attr(node: XmlNode, name: string): string {
  const val = node[`@_${name}`];
  return val !== undefined ? escapeXml(String(val)) : "0";
}

// ── SVG element builders ──────────────────────────────────

/** Build SVG attribute string for fill/stroke based on paint operation and state. */
function paintAttrs(
  op: "fill" | "stroke" | "fillstroke",
  state: GfxState,
): string {
  const parts: string[] = [];

  if (op === "fill" || op === "fillstroke") {
    // Default currentColor fills become a light gray so stencils render as
    // professional line-art rather than solid black blobs. Explicit colors
    // from <fillcolor color="..."/> are preserved as-is (multi-color stencils).
    const fill =
      state.fillColor === "currentColor" ? "#888888" : state.fillColor;
    parts.push(`fill="${fill}"`);
  } else {
    parts.push('fill="none"');
  }

  if (op === "stroke" || op === "fillstroke") {
    parts.push(`stroke="${state.strokeColor}"`);
    if (state.strokeWidth !== 1) {
      parts.push(`stroke-width="${state.strokeWidth}"`);
    }
  } else {
    parts.push('stroke="none"');
  }

  return parts.join(" ");
}

/**
 * Inject paint attributes into an SVG element string.
 *
 * Handles both self-closing (`<rect ... />`) and paired tags
 * (`<text ...>content</text>`) by targeting the first `/>` or `>`.
 */
function injectAttributes(el: string, attrs: string): string {
  // Self-closing: <rect ... /> → <rect ... attrs />
  if (el.includes("/>")) {
    return el.replace("/>", ` ${attrs}/>`);
  }
  // Paired tag: <text ...>content</text> → <text ... attrs>content</text>
  return el.replace(">", ` ${attrs}>`);
}

/**
 * Process a section (`<background>` or `<foreground>`) and produce SVG elements.
 *
 * Iterates child elements in order, accumulating shape/path primitives
 * and emitting them when a paint operation (fill/stroke/fillstroke) is encountered.
 */
function processSection(section: XmlNode, state: GfxState): string[] {
  const svgElements: string[] = [];
  // Pending primitives waiting for a paint operation
  let pending: string[] = [];
  const stateStack: GfxState[] = [];

  for (const [tag, value] of Object.entries(section)) {
    if (tag.startsWith("@_")) continue;
    const items = Array.isArray(value)
      ? (value as XmlNode[])
      : [value as XmlNode];

    for (const item of items) {
      switch (tag) {
        // ── Path ───────────────────────────────────
        case "path": {
          const d = buildPathD(item);
          if (d) {
            pending.push(`<path d="${d}"/>`);
          }
          break;
        }

        // ── Shape elements ─────────────────────────
        case "rect": {
          const x = attr(item, "x");
          const y = attr(item, "y");
          const w = attr(item, "w");
          const h = attr(item, "h");
          pending.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`);
          break;
        }
        case "roundrect": {
          const x = attr(item, "x");
          const y = attr(item, "y");
          const w = attr(item, "w");
          const h = attr(item, "h");
          const arcsize = Number(attr(item, "arcsize"));
          const minDim = Math.min(Number(w), Number(h));
          const rx = (arcsize * minDim) / 2;
          pending.push(
            `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`,
          );
          break;
        }
        case "ellipse": {
          const ex = Number(attr(item, "x"));
          const ey = Number(attr(item, "y"));
          const ew = Number(attr(item, "w"));
          const eh = Number(attr(item, "h"));
          const cx = ex + ew / 2;
          const cy = ey + eh / 2;
          pending.push(
            `<ellipse cx="${cx}" cy="${cy}" rx="${ew / 2}" ry="${eh / 2}"/>`,
          );
          break;
        }
        case "text": {
          const tx = attr(item, "x");
          const ty = attr(item, "y");
          const str = (item["@_str"] as string) ?? "";
          pending.push(`<text x="${tx}" y="${ty}">${escapeXml(str)}</text>`);
          break;
        }
        case "image": {
          // Skip images — placeholder per spec
          break;
        }

        // ── Paint operations ───────────────────────
        case "fill":
        case "stroke":
        case "fillstroke": {
          const pa = paintAttrs(tag, state);
          for (const el of pending) {
            svgElements.push(injectAttributes(el, pa));
          }
          pending = [];
          break;
        }

        // ── State commands ─────────────────────────
        case "strokewidth":
          state.strokeWidth = Number(attr(item, "width"));
          break;
        case "strokecolor":
          state.strokeColor = escapeXml(
            (item["@_color"] as string) ?? "currentColor",
          );
          break;
        case "fillcolor":
          state.fillColor = escapeXml(
            (item["@_color"] as string) ?? "currentColor",
          );
          break;
        case "save":
          stateStack.push(cloneGfxState(state));
          break;
        case "restore": {
          const restored = stateStack.pop();
          if (restored) {
            state.strokeColor = restored.strokeColor;
            state.fillColor = restored.fillColor;
            state.strokeWidth = restored.strokeWidth;
          }
          break;
        }

        // Unknown tags are silently ignored
      }
    }
  }

  // Any pending elements without a paint op get default stroke
  if (pending.length > 0) {
    const pa = paintAttrs("stroke", state);
    for (const el of pending) {
      svgElements.push(injectAttributes(el, pa));
    }
  }

  return svgElements;
}

// ── Connection points ─────────────────────────────────────

/** Parse `<connections>` element into ConnectionPoint array. */
function parseConnections(
  connectionsNode: XmlNode | undefined,
): ConnectionPoint[] {
  if (!connectionsNode) return [];

  const constraints = connectionsNode["constraint"];
  if (!constraints) return [];

  const items = Array.isArray(constraints)
    ? (constraints as XmlNode[])
    : [constraints as XmlNode];
  return items.map((c) => ({
    x: Number(attr(c, "x")),
    y: Number(attr(c, "y")),
    name: (c["@_name"] as string) ?? "",
  }));
}

// ── Core conversion ───────────────────────────────────────

/**
 * Convert a parsed draw.io shape node into an SVG string.
 *
 * @param shapeNode - Parsed XML object representing a `<shape>` element
 * @param width - viewBox width
 * @param height - viewBox height
 * @returns SVG string
 */
function convertShapeNodeToSvg(
  shapeNode: XmlNode,
  width: number,
  height: number,
): string {
  const state = defaultGfxState();
  const groups: string[] = [];

  // Process <background> section
  // Background shapes define the outline — use fill="none" so the expression's
  // backgroundColor controls fill at render time (avoids solid black blobs).
  const bg = shapeNode["background"] as XmlNode | undefined;
  if (bg) {
    const bgState = { ...state, fillColor: "none" };
    const bgElements = processSection(bg, bgState);
    if (bgElements.length > 0) {
      groups.push(
        `  <g class="background">\n    ${bgElements.join("\n    ")}\n  </g>`,
      );
    }
  }

  // Process <foreground> section
  const fg = shapeNode["foreground"] as XmlNode | undefined;
  if (fg) {
    const fgElements = processSection(fg, state);
    if (fgElements.length > 0) {
      groups.push(
        `  <g class="foreground">\n    ${fgElements.join("\n    ")}\n  </g>`,
      );
    }
  }

  const body = groups.length > 0 ? `\n${groups.join("\n")}\n` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none" stroke="currentColor">${body}</svg>`;
}

// ── Public API ────────────────────────────────────────────

/**
 * Re-wrap an existing SVG string with a new viewBox (width × height).
 *
 * Useful when you want to render a shape at different dimensions than
 * its intrinsic size.
 *
 * @param svgString - Previously generated SVG string
 * @param width - New viewBox width
 * @param height - New viewBox height
 * @returns SVG string with updated viewBox
 */
export function shapeToSvg(
  svgString: string,
  width: number,
  height: number,
): string {
  // Replace existing viewBox with new dimensions
  return svgString.replace(
    /viewBox="[^"]*"/,
    `viewBox="0 0 ${width} ${height}"`,
  );
}

/**
 * Parse a draw.io stencil library XML string into a structured library object.
 *
 * @param xml - Complete stencil library XML (root element `<shapes>`)
 * @returns Parsed library with shapes, SVGs, and connection points
 * @throws {Error} If XML is not a valid `<shapes>` stencil library
 */
export function parseStencilLibrary(xml: string): DrawioStencilLibrary {
  if (xml.length > MAX_INPUT_SIZE) {
    throw new Error(
      `Stencil library XML too large: ${xml.length} bytes exceeds ${MAX_INPUT_SIZE} byte limit`,
    );
  }

  let parsed: XmlNode;
  try {
    parsed = parser.parse(xml) as XmlNode;
  } catch (err) {
    throw new Error(`Failed to parse stencil XML: ${(err as Error).message}`);
  }

  const shapesRoot = parsed["shapes"] as XmlNode | undefined;
  if (!shapesRoot) {
    throw new Error("Invalid stencil library: missing <shapes> root element");
  }

  const libraryName = (shapesRoot["@_name"] as string) ?? "Unnamed";
  const shapeNodes = shapesRoot["shape"];

  if (!shapeNodes) {
    return { name: libraryName, shapes: [] };
  }

  const shapeList = Array.isArray(shapeNodes)
    ? (shapeNodes as XmlNode[])
    : [shapeNodes as XmlNode];

  if (shapeList.length > MAX_SHAPE_COUNT) {
    throw new Error(
      `Stencil library contains ${shapeList.length} shapes, exceeding the limit of ${MAX_SHAPE_COUNT}`,
    );
  }

  const shapes: DrawioShape[] = shapeList.map((node) => {
    const name = (node["@_name"] as string) ?? "Unnamed";
    const width = Number(node["@_w"] ?? 100);
    const height = Number(node["@_h"] ?? 100);
    const aspectRaw = (node["@_aspect"] as string) ?? "variable";
    const aspect: "fixed" | "variable" =
      aspectRaw === "fixed" ? "fixed" : "variable";
    const connections = parseConnections(
      node["connections"] as XmlNode | undefined,
    );

    // Guard against zero/negative dimensions for a valid viewBox
    const viewWidth = Math.max(1, width);
    const viewHeight = Math.max(1, height);
    const svg = convertShapeNodeToSvg(node, viewWidth, viewHeight);

    return { name, width, height, aspect, svg, connections };
  });

  return { name: libraryName, shapes };
}
