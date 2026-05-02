/**
 * draw.io XML Serializer — VisualExpression ↔ mxGraphModel.
 *
 * Provides bidirectional serialization between InfiniCanvas VisualExpressions
 * and draw.io's mxGraphModel XML format.
 *
 * Export: VisualExpression[] → mxGraphModel XML string
 * Import: mxGraphModel XML string → VisualExpression[]
 *
 * @module
 */

import { XMLParser } from "fast-xml-parser";
import type { VisualExpression } from "../schema/expressions";
import type { ExpressionStyle } from "../schema/metadata";
import { DEFAULT_EXPRESSION_STYLE } from "../schema/metadata";
import type {
  RectangleData,
  EllipseData,
  DiamondData,
  LineData,
  ArrowData,
  ArrowheadType,
  RoutingMode,
  TextData,
  StickyNoteData,
  StencilData,
} from "../schema/primitives";
import { escapeXml, unescapeXml } from "./xmlUtils";

// ── XML helpers ───────────────────────────────────────────

/** Render an XML attribute if the value is defined. */
function attr(name: string, value: string | number | undefined): string {
  if (value === undefined) return "";
  return ` ${name}="${typeof value === "string" ? escapeXml(value) : value}"`;
}

// ── Connector mapping tables ──────────────────────────────

/** Map InfiniCanvas RoutingMode → draw.io edgeStyle value. */
const ROUTING_TO_EDGE_STYLE: Record<string, string | undefined> = {
  straight: undefined, // straight is the draw.io default — omit edgeStyle
  orthogonal: "orthogonalEdgeStyle",
  curved: "curvedEdgeStyle",
  elbow: "elbowEdgeStyle",
  entityRelation: "entityRelationEdgeStyle",
  isometric: "isometricEdgeStyle",
  // orthogonalCurved is handled specially: orthogonalEdgeStyle + curved=1
};

/** Map draw.io edgeStyle value → InfiniCanvas RoutingMode. */
const EDGE_STYLE_TO_ROUTING: Record<string, RoutingMode> = {
  orthogonalEdgeStyle: "orthogonal",
  curvedEdgeStyle: "curved",
  elbowEdgeStyle: "elbow",
  entityRelationEdgeStyle: "entityRelation",
  isometricEdgeStyle: "isometric",
};

/**
 * Normalize an ArrowheadType (string | boolean) to a draw.io arrow name.
 *
 * Handles legacy InfiniCanvas values:
 * - `true` → `'classic'`, `false` → `'none'`
 * - `'triangle'` → `'classic'`, `'circle'` → `'oval'`, `'chevron'` → `'open'`
 */
function normalizeArrowhead(value: ArrowheadType | boolean): string {
  if (typeof value === "boolean") return value ? "classic" : "none";
  switch (value) {
    case "triangle":
      return "classic";
    case "circle":
      return "oval";
    case "chevron":
      return "open";
    default:
      return value;
  }
}

/** Set of all known draw.io arrowhead names for import validation. */
const KNOWN_ARROWHEADS = new Set<string>([
  "none",
  "classic",
  "classicThin",
  "open",
  "openThin",
  "block",
  "blockThin",
  "oval",
  "diamond",
  "diamondThin",
  "ERone",
  "ERmany",
  "ERmandOne",
  "ERoneToMany",
  "ERzeroToOne",
  "ERzeroToMany",
  "openAsync",
  "dash",
  "cross",
  "box",
  "halfCircle",
  "doubleBlock",
]);

// ── Style conversion ──────────────────────────────────────

/** Build a draw.io style string from a VisualExpression. */
function buildStyleString(expr: VisualExpression): string {
  const parts: string[] = [];

  // Shape prefix
  switch (expr.kind) {
    case "ellipse":
      parts.push("ellipse");
      break;
    case "diamond":
      parts.push("rhombus");
      break;
    case "text":
      parts.push("text");
      break;
    case "sticky-note":
      parts.push("shape=note");
      break;
    case "stencil": {
      const stencilData = expr.data as StencilData;
      parts.push(`shape=mxgraph.${stencilData.stencilId}`);
      break;
    }
    case "line":
      parts.push("endArrow=none");
      break;
    default:
      // rectangle and others use default shape
      break;
  }

  const { style } = expr;

  // Fill color — only use 'none' when background is explicitly transparent
  if (style.backgroundColor === "transparent") {
    parts.push("fillColor=none");
  } else {
    parts.push(`fillColor=${style.backgroundColor}`);
  }

  // Stroke
  parts.push(`strokeColor=${style.strokeColor}`);

  if (style.strokeWidth !== DEFAULT_EXPRESSION_STYLE.strokeWidth) {
    parts.push(`strokeWidth=${style.strokeWidth}`);
  }

  // Opacity (InfiniCanvas 0-1 → draw.io 0-100)
  if (style.opacity < 1) {
    parts.push(`opacity=${Math.round(style.opacity * 100)}`);
  }

  // Dashed/dotted with distinct dash patterns for round-trip fidelity
  if (style.strokeStyle === "dashed") {
    parts.push("dashed=1");
    parts.push("dashPattern=8 5");
  } else if (style.strokeStyle === "dotted") {
    parts.push("dashed=1");
    parts.push("dashPattern=1 3");
  }

  // Rounded for rectangles
  if (expr.kind === "rectangle") {
    parts.push("rounded=1");
  }

  // Arrow/connector-specific style properties
  if (expr.kind === "arrow") {
    const arrowData = expr.data as ArrowData;

    // Routing → edgeStyle
    if (arrowData.routing) {
      if (arrowData.routing === "orthogonalCurved") {
        parts.push("edgeStyle=orthogonalEdgeStyle");
        parts.push("curved=1");
      } else {
        const edgeStyle = ROUTING_TO_EDGE_STYLE[arrowData.routing];
        if (edgeStyle) {
          parts.push(`edgeStyle=${edgeStyle}`);
        }
      }
    }

    // Arrowhead types
    if (arrowData.startArrowhead !== undefined) {
      parts.push(`startArrow=${normalizeArrowhead(arrowData.startArrowhead)}`);
    }
    if (arrowData.endArrowhead !== undefined) {
      parts.push(`endArrow=${normalizeArrowhead(arrowData.endArrowhead)}`);
    }

    // Fill flags
    if (arrowData.startFill !== undefined) {
      parts.push(`startFill=${arrowData.startFill ? 1 : 0}`);
    }
    if (arrowData.endFill !== undefined) {
      parts.push(`endFill=${arrowData.endFill ? 1 : 0}`);
    }

    // Curved (only when not already emitted by orthogonalCurved routing)
    if (arrowData.curved && arrowData.routing !== "orthogonalCurved") {
      parts.push("curved=1");
    }

    // Rounded on arrows
    if (arrowData.rounded) {
      parts.push("rounded=1");
    }

    // Jetty size
    if (arrowData.jettySize !== undefined) {
      parts.push(`jettySize=${arrowData.jettySize}`);
    }

    // Binding connection-point ports → exit/entry coordinates
    if (arrowData.startBinding) {
      if (arrowData.startBinding.portX !== undefined) {
        parts.push(`exitX=${arrowData.startBinding.portX}`);
      }
      if (arrowData.startBinding.portY !== undefined) {
        parts.push(`exitY=${arrowData.startBinding.portY}`);
      }
    }
    if (arrowData.endBinding) {
      if (arrowData.endBinding.portX !== undefined) {
        parts.push(`entryX=${arrowData.endBinding.portX}`);
      }
      if (arrowData.endBinding.portY !== undefined) {
        parts.push(`entryY=${arrowData.endBinding.portY}`);
      }
    }
  }

  // Text-related data properties
  if (expr.kind === "text") {
    const textData = expr.data as TextData;
    parts.push(`fontSize=${textData.fontSize}`);
    parts.push(`fontFamily=${textData.fontFamily}`);
    parts.push(`align=${textData.textAlign}`);
  } else {
    // Font from style (non-text shapes)
    if (style.fontSize !== undefined) {
      parts.push(`fontSize=${style.fontSize}`);
    }
    if (
      style.fontFamily !== undefined &&
      style.fontFamily !== DEFAULT_EXPRESSION_STYLE.fontFamily
    ) {
      parts.push(`fontFamily=${style.fontFamily}`);
    }
  }

  // Sticky note gets its color from data.color
  if (expr.kind === "sticky-note") {
    const noteData = expr.data as StickyNoteData;
    // Override fillColor with note's color
    const fillIdx = parts.findIndex((p) => p.startsWith("fillColor="));
    if (fillIdx >= 0) {
      parts[fillIdx] = `fillColor=${noteData.color}`;
    } else {
      parts.push(`fillColor=${noteData.color}`);
    }
  }

  parts.push("whiteSpace=wrap");
  parts.push("html=1");

  // Rotation angle (only when non-zero)
  if (expr.angle !== 0) {
    parts.push(`rotation=${expr.angle}`);
  }

  return parts.join(";") + ";";
}

/** Extract the text value for an mxCell's value attribute. */
function getValueText(expr: VisualExpression): string {
  const data = expr.data;
  switch (data.kind) {
    case "rectangle":
    case "ellipse":
    case "diamond":
      return (data as RectangleData | EllipseData | DiamondData).label ?? "";
    case "text":
      return (data as TextData).text;
    case "sticky-note":
      return (data as StickyNoteData).text;
    case "arrow":
      return (data as ArrowData).label ?? "";
    case "stencil":
      return (data as StencilData).label ?? "";
    default:
      return "";
  }
}

// ── Export ─────────────────────────────────────────────────

/** Serialize a single vertex expression to an mxCell XML string. */
function vertexToMxCell(expr: VisualExpression): string {
  const value = getValueText(expr);
  const style = buildStyleString(expr);
  const { x, y } = expr.position;
  const { width, height } = expr.size;

  return (
    `    <mxCell${attr("id", expr.id)}${attr("value", value)} style="${escapeXml(style)}" vertex="1" parent="1">\n` +
    `      <mxGeometry x="${x}" y="${y}" width="${width}" height="${height}" as="geometry"/>\n` +
    `    </mxCell>`
  );
}

/** Serialize an edge expression (arrow/line) to an mxCell XML string. */
function edgeToMxCell(expr: VisualExpression): string {
  const data = expr.data as ArrowData | LineData;
  const value = expr.kind === "arrow" ? ((data as ArrowData).label ?? "") : "";
  const style = buildStyleString(expr);

  // Source/target bindings
  let sourceAttr = "";
  let targetAttr = "";
  if (expr.kind === "arrow") {
    const arrowData = data as ArrowData;
    if (arrowData.startBinding) {
      sourceAttr = attr("source", arrowData.startBinding.expressionId);
    }
    if (arrowData.endBinding) {
      targetAttr = attr("target", arrowData.endBinding.expressionId);
    }
  }

  // Waypoints (all points except first and last for arrows, all for lines)
  const points = data.points;
  let geometryContent: string;

  if (points.length > 2) {
    // Intermediate points are waypoints
    const waypoints = points.slice(1, -1);
    const waypointXml = waypoints
      .map(([px, py]) => `          <mxPoint x="${px}" y="${py}"/>`)
      .join("\n");
    geometryContent =
      `      <mxGeometry relative="1" as="geometry">\n` +
      `        <Array as="points">\n${waypointXml}\n        </Array>\n` +
      `      </mxGeometry>`;
  } else {
    geometryContent = `      <mxGeometry relative="1" as="geometry"/>`;
  }

  return `    <mxCell${attr("id", expr.id)}${attr("value", value)} style="${escapeXml(style)}" edge="1" parent="1"${sourceAttr}${targetAttr}>\n${geometryContent}\n    </mxCell>`;
}

/**
 * Export VisualExpressions to draw.io mxGraphModel XML.
 *
 * @param expressions - Array of VisualExpressions to serialize
 * @returns Valid mxGraphModel XML string
 */
export function expressionsToDrawio(expressions: VisualExpression[]): string {
  const cells = expressions.map((expr) => {
    if (expr.kind === "arrow" || expr.kind === "line") {
      return edgeToMxCell(expr);
    }
    return vertexToMxCell(expr);
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<mxGraphModel>",
    "  <root>",
    '    <mxCell id="0"/>',
    '    <mxCell id="1" parent="0"/>',
    ...cells,
    "  </root>",
    "</mxGraphModel>",
  ].join("\n");
}

// ── Import ────────────────────────────────────────────────

/** Infrastructure cell IDs that should be skipped during import. */
const INFRASTRUCTURE_IDS = new Set(["0", "1"]);

/**
 * Map draw.io Cisco (and related) stencil IDs to our catalog IDs.
 * draw.io ships `mxgraph.cisco.routers.router`, `mxgraph.cisco.switches.workgroup_switch`, …
 * Our catalog ships `cisco-pro-router`, `cisco-pro-switch`, …
 */
const STENCIL_ID_ALIASES: Record<string, string> = {
  "cisco.routers.router": "cisco-pro-router",
  "cisco.routers.router_firewall": "cisco-pro-firewall",
  "cisco.switches.workgroup_switch": "cisco-pro-switch",
  "cisco.switches.layer_3_switch": "cisco-pro-l3-switch",
  "cisco.switches.multilayer_switch": "cisco-pro-l3-switch",
  "cisco.switches.atm_switch": "cisco-pro-switch",
  "cisco.switches.nexus_7000": "cisco-pro-nexus",
  "cisco.switches.nexus_5000": "cisco-pro-nexus",
  "cisco.switches.nexus_2000": "cisco-pro-nexus",
  "cisco.switches.nexus_1000": "cisco-pro-nexus",
  "cisco.security.firewall": "cisco-pro-firewall",
  "cisco.security.asa_5500": "cisco-pro-asa",
  "cisco.wireless.wireless_router": "cisco-pro-wireless-ap",
  "cisco.wireless.access_point": "cisco-pro-wireless-ap",
  "cisco.wireless.wlan_controller": "cisco-pro-wlc",
  "cisco.wireless.wi-fi_tag": "cisco-pro-wireless-ap",
  "cisco.wireless.wifi_tag": "cisco-pro-wireless-ap",
  "cisco.servers.standard_host": "cisco-pro-ucs",
  "cisco.servers.ucs": "cisco-pro-ucs",
  "cisco.computers_and_peripherals.pc": "desktop-computer",
  "cisco.computers_and_peripherals.laptop": "laptop",
  "cisco.computers_and_peripherals.workstation": "desktop-computer",
  "cisco.storage.disk_array": "storage-array",
  "cisco.storage.storage_server": "server",
  "cisco.voip.ip_phone": "cisco-pro-ip-phone",
  "cisco.modems_and_phones.ip_phone": "cisco-pro-ip-phone",
};

/** Resolve a draw.io stencil ID (without the `mxgraph.` prefix) to our catalog ID. */
function resolveStencilId(rawId: string): string {
  return STENCIL_ID_ALIASES[rawId] ?? rawId;
}

/**
 * Strip HTML tags and decode common entities from a label value.
 * draw.io stores rich-text labels with `html=1` and embedded HTML (tables, fonts, …).
 * We can't render arbitrary HTML, so reduce to readable plain text with line breaks.
 *
 * Only call this when the cell's style has `html=1`. For plain-text labels,
 * angle brackets are literal characters and must be preserved.
 */
function stripHtmlLabel(html: string): string {
  if (!html || !html.includes("<")) return html;
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<\/td>\s*<td[^>]*>/gi, "  ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Check if a string contains actual HTML tags (not just stray `<` characters). */
function looksLikeHtml(value: string): boolean {
  // Match either `<tagname...>` or `</tagname>` — real HTML starts with a letter
  // after the opening angle bracket. Plain expressions like `x < y` fail this.
  return /<\/?[a-zA-Z][^>]*>/.test(value);
}

/** Decode common HTML entities inside a cell value. */
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Parse an HTML fragment containing a `<table>` into structured headers + rows.
 * Returns null if no table is found or the table has no rows.
 * Uses a tolerant regex-based parser — draw.io tables are simple (tr/td, sometimes
 * wrapped in <b>/<font>) and don't need a full HTML parser.
 */
function parseHtmlTable(
  html: string,
): {
  title?: string;
  headers: string[];
  rows: (string | { text: string; backgroundColor?: string })[][];
} | null {
  const tableMatch = html.match(/<table\b[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch || !tableMatch[1]) return null;
  const body = tableMatch[1];

  const cellText = (cellHtml: string): string =>
    decodeEntities(
      cellHtml
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );

  /** Extract background color from a td/th — checks both CSS and bgcolor attribute. */
  const cellBgColor = (tdAttrs: string): string | undefined => {
    // CSS: style="background-color: #xxx"
    const cssMatch = tdAttrs.match(/background-color\s*:\s*([^;"]+)/i);
    if (cssMatch) return cssMatch[1]?.trim();
    // HTML attribute: bgcolor="#xxx" or bgcolor='#xxx'
    const attrMatch = tdAttrs.match(/bgcolor\s*=\s*['"]?([^'"\s;>]+)/i);
    if (attrMatch) return attrMatch[1]?.trim();
    return undefined;
  };

  /** Extract border color from a td/th style — for colored square cells. */
  const cellBorderColor = (tdAttrs: string): string | undefined => {
    const m = tdAttrs.match(/border\s*:\s*\d+px\s+solid\s+([^;"']+)/i);
    return m?.[1]?.trim();
  };

  const rowMatches = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rowMatches.length === 0) return null;

  interface RawCell {
    text: string;
    backgroundColor?: string;
    borderColor?: string;
  }
  const allRows: RawCell[][] = rowMatches.map((m) =>
    [...(m[1] ?? "").matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)].map(
      (c) => ({
        text: cellText(c[2] ?? ""),
        backgroundColor: cellBgColor(c[1] ?? ""),
        borderColor: cellBorderColor(c[1] ?? ""),
      }),
    ),
  );
  if (allRows.length === 0) return null;

  // Detect title row: row 0 has 1 cell, row 1 has more → row 0 is a title
  let title: string | undefined;
  let headerIdx = 0;
  if (
    allRows.length > 1 &&
    (allRows[0]?.length ?? 0) === 1 &&
    (allRows[1]?.length ?? 0) > 1
  ) {
    title = allRows[0]![0]!.text;
    headerIdx = 1;
  }

  // Check if "header" row has any colored cells — if so, it's data not headers.
  // Generate column headers like "Col 1", "Col 2"... and treat all rows as data.
  const headerRow = allRows[headerIdx] ?? [];
  const headerHasColors = headerRow.some(
    (c) => c.backgroundColor || c.borderColor,
  );
  let headers: string[];
  let dataStartIdx: number;

  if (headerHasColors) {
    // No real header row — generate generic column names
    const colCount = Math.max(
      ...allRows.slice(title ? 1 : 0).map((r) => r.length),
    );
    headers = Array.from({ length: colCount }, (_, i) => `Col ${i + 1}`);
    dataStartIdx = title ? 1 : 0;
  } else {
    headers = headerRow.map((c) => c.text);
    dataStartIdx = headerIdx + 1;
  }

  const rows: (
    | string
    | { text: string; backgroundColor?: string; borderColor?: string }
  )[][] = allRows.slice(dataStartIdx).map((row) => {
    return row.map((cell) => {
      if (cell.borderColor || cell.backgroundColor) {
        return {
          text: cell.text,
          backgroundColor: cell.backgroundColor,
          borderColor: cell.borderColor,
        };
      }
      return cell.text;
    });
  });

  // Pad short rows
  const width = headers.length;
  const normalized = rows.map((r) => {
    const copy = r.slice(0, width);
    while (copy.length < width) copy.push("");
    return copy;
  });

  if (headers.length === 0 || normalized.length === 0) return null;
  return { title, headers, rows: normalized };
}

/** Apply HTML stripping only if the style marks this label as HTML content AND it actually contains tags. */
function normalizeLabel(value: string, styleMap: Map<string, string>): string {
  if (styleMap.get("html") !== "1") return value;
  if (!looksLikeHtml(value)) return value;
  return stripHtmlLabel(value);
}

/** Parse a draw.io semicolon-delimited style string into a map. */
function parseStyleString(style: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!style) return map;

  const tokens = style.split(";").filter(Boolean);
  for (const token of tokens) {
    const eqIdx = token.indexOf("=");
    if (eqIdx >= 0) {
      map.set(token.slice(0, eqIdx), token.slice(eqIdx + 1));
    } else {
      // Shape identifier token (e.g., "ellipse", "rhombus", "text")
      map.set("__shape__", token);
    }
  }
  return map;
}

/** Determine the expression kind from a draw.io style map. */
function resolveKindFromStyle(
  styleMap: Map<string, string>,
  isEdge: boolean,
  hasBinding = false,
): VisualExpression["kind"] {
  if (isEdge) {
    // Edges with source/target bindings are always arrows so bindings persist;
    // a plain `line` primitive has no notion of source/target references.
    if (hasBinding) return "arrow";
    const endArrow = styleMap.get("endArrow");
    if (endArrow === "none") {
      // Check for other arrow-specific properties that distinguish from a plain line
      const hasStartArrow =
        styleMap.has("startArrow") && styleMap.get("startArrow") !== "none";
      const hasEdgeStyle = styleMap.has("edgeStyle");
      const hasStartFill = styleMap.has("startFill");
      const hasEndFill = styleMap.has("endFill");
      if (hasStartArrow || hasEdgeStyle || hasStartFill || hasEndFill) {
        return "arrow";
      }
      return "line";
    }
    return "arrow";
  }

  const shapeValue = styleMap.get("shape");
  const shapeIdent = styleMap.get("__shape__");

  if (shapeValue === "note") return "sticky-note";
  if (shapeValue?.startsWith("mxgraph.")) return "stencil";
  if (shapeIdent === "ellipse") return "ellipse";
  if (shapeIdent === "rhombus") return "diamond";
  if (shapeIdent === "text") return "text";

  return "rectangle"; // default vertex
}

/** Convert a draw.io style map to an ExpressionStyle. */
function styleMapToExpressionStyle(
  styleMap: Map<string, string>,
  kind: VisualExpression["kind"],
): ExpressionStyle {
  const style: ExpressionStyle = { ...DEFAULT_EXPRESSION_STYLE };
  // draw.io files never use sketchy/hachure rendering — default to solid so
  // imported diagrams look like they do in draw.io (clean strokes, solid fills).
  style.fillStyle = "solid";
  style.roughness = 0;

  const fillColor = styleMap.get("fillColor");
  if (fillColor !== undefined) {
    style.backgroundColor = fillColor === "none" ? "transparent" : fillColor;
  }

  const strokeColor = styleMap.get("strokeColor");
  if (strokeColor !== undefined && strokeColor !== "none") {
    style.strokeColor = strokeColor;
  }

  // Stencils: draw.io's fillColor is the icon's body color (what the user
  // actually sees in draw.io). Our renderer uses strokeColor to color the
  // SVG via currentColor replacement. When fillColor is a non-trivial color,
  // use it as the icon's primary color so icons render with their intended
  // color instead of being invisible (e.g. strokeColor=#ffffff on white bg).
  if (
    kind === "stencil" &&
    fillColor &&
    fillColor !== "none" &&
    fillColor !== "#ffffff"
  ) {
    style.strokeColor = fillColor;
    // The hachure/solid background behind the icon is distracting for real
    // diagrams — disable it so just the colored icon shows.
    style.backgroundColor = "transparent";
  }

  const strokeWidth = styleMap.get("strokeWidth");
  if (strokeWidth !== undefined) {
    style.strokeWidth = Number(strokeWidth);
  }

  const opacity = styleMap.get("opacity");
  if (opacity !== undefined) {
    style.opacity = Number(opacity) / 100;
  }

  const dashed = styleMap.get("dashed");
  if (dashed === "1") {
    // Distinguish dotted vs dashed via dashPattern
    const dashPattern = styleMap.get("dashPattern") ?? "";
    const segments = dashPattern.split(/\s+/).filter(Boolean).map(Number);
    const hasShortSegments = segments.length >= 2 && (segments[0] ?? 0) <= 3;
    style.strokeStyle = hasShortSegments ? "dotted" : "dashed";
  }

  const fontSize = styleMap.get("fontSize");
  if (fontSize !== undefined) {
    style.fontSize = Number(fontSize);
  }

  const fontFamily = styleMap.get("fontFamily");
  if (fontFamily !== undefined) {
    style.fontFamily = fontFamily;
  }

  return style;
}

/** Parsed mxCell from fast-xml-parser. */
interface ParsedMxCell {
  "@_id"?: string;
  "@_value"?: string;
  "@_style"?: string;
  "@_vertex"?: string;
  "@_edge"?: string;
  "@_parent"?: string;
  "@_source"?: string;
  "@_target"?: string;
  mxGeometry?: ParsedGeometry;
}

/** Parsed mxGeometry from fast-xml-parser. */
interface ParsedGeometry {
  "@_x"?: string;
  "@_y"?: string;
  "@_width"?: string;
  "@_height"?: string;
  "@_relative"?: string;
  "@_as"?: string;
  Array?: ParsedArray;
  mxPoint?: ParsedPoint | ParsedPoint[];
}

/** Parsed Array element (waypoints). */
interface ParsedArray {
  "@_as"?: string;
  mxPoint?: ParsedPoint | ParsedPoint[];
}

/** Parsed mxPoint element. */
interface ParsedPoint {
  "@_x"?: string;
  "@_y"?: string;
  "@_as"?: string;
}

/** Maximum input size for XML import (10 MB). */
const MAX_INPUT_SIZE = 10_000_000;

/** Maximum number of expressions to import. */
const MAX_EXPRESSION_COUNT = 5_000;

/** Sanitize a numeric value: replace NaN/Infinity with a fallback. */
function sanitizeNum(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Clamp a dimension value: non-negative and finite. */
function clampDimension(value: number): number {
  const n = sanitizeNum(value, 0);
  return n < 0 ? 0 : n;
}

/** Extract geometry (position/size) from a parsed mxGeometry element. */
function extractGeometry(geo: ParsedGeometry | undefined): {
  position: { x: number; y: number };
  size: { width: number; height: number };
} {
  if (!geo) {
    return {
      position: { x: 0, y: 0 },
      size: { width: 100, height: 100 },
    };
  }

  return {
    position: {
      x: sanitizeNum(Number(geo["@_x"] ?? 0), 0),
      y: sanitizeNum(Number(geo["@_y"] ?? 0), 0),
    },
    size: {
      width: clampDimension(Number(geo["@_width"] ?? 100)),
      height: clampDimension(Number(geo["@_height"] ?? 100)),
    },
  };
}

/** Extract waypoints from parsed geometry. */
function extractWaypoints(geo: ParsedGeometry | undefined): [number, number][] {
  if (!geo) return [];

  const points: [number, number][] = [];

  // Check for Array of points (waypoints)
  if (geo.Array) {
    const arrayPoints = geo.Array.mxPoint;
    if (arrayPoints) {
      const pointList = Array.isArray(arrayPoints)
        ? arrayPoints
        : [arrayPoints];
      for (const p of pointList) {
        points.push([Number(p["@_x"] ?? 0), Number(p["@_y"] ?? 0)]);
      }
    }
  }

  return points;
}

/** Build expression data from parsed mxCell attributes. */
function buildExpressionData(
  kind: VisualExpression["kind"],
  value: string,
  styleMap: Map<string, string>,
  cell: ParsedMxCell,
  geo: ParsedGeometry | undefined,
): VisualExpression["data"] {
  switch (kind) {
    case "rectangle":
      return {
        kind: "rectangle",
        label: normalizeLabel(value, styleMap) || undefined,
      } as RectangleData;
    case "ellipse":
      return {
        kind: "ellipse",
        label: normalizeLabel(value, styleMap) || undefined,
      } as EllipseData;
    case "diamond":
      return {
        kind: "diamond",
        label: normalizeLabel(value, styleMap) || undefined,
      } as DiamondData;
    case "text": {
      const fontSize = Number(styleMap.get("fontSize") ?? 16);
      const fontFamily = styleMap.get("fontFamily") ?? "sans-serif";
      const textAlign = (styleMap.get("align") ?? "left") as
        | "left"
        | "center"
        | "right";
      return {
        kind: "text",
        text: normalizeLabel(value, styleMap),
        fontSize,
        fontFamily,
        textAlign,
      } as TextData;
    }
    case "sticky-note": {
      const fillColor = styleMap.get("fillColor") ?? "#FFEB3B";
      return {
        kind: "sticky-note",
        text: normalizeLabel(value, styleMap),
        color: fillColor,
      } as StickyNoteData;
    }
    case "stencil": {
      const shapeValue = styleMap.get("shape") ?? "";
      const rawId = shapeValue.startsWith("mxgraph.")
        ? shapeValue.slice("mxgraph.".length)
        : shapeValue;
      const stencilId = resolveStencilId(rawId);
      return {
        kind: "stencil",
        stencilId,
        category: "imported",
        label: normalizeLabel(value, styleMap) || undefined,
      } as StencilData;
    }
    case "arrow": {
      const waypoints = extractWaypoints(geo);
      // Build points: source → waypoints → target (use [0,0] for unspecified endpoints)
      const allPoints: [number, number][] = [[0, 0], ...waypoints, [0, 0]];

      // Extract sourcePoint/targetPoint from geometry (same as line)
      if (geo?.mxPoint) {
        const geoPoints = Array.isArray(geo.mxPoint)
          ? geo.mxPoint
          : [geo.mxPoint];
        const sourcePoint = geoPoints.find((p) => p["@_as"] === "sourcePoint");
        const targetPoint = geoPoints.find((p) => p["@_as"] === "targetPoint");
        if (sourcePoint) {
          allPoints[0] = [
            Number(sourcePoint["@_x"] ?? 0),
            Number(sourcePoint["@_y"] ?? 0),
          ];
        }
        if (targetPoint) {
          allPoints[allPoints.length - 1] = [
            Number(targetPoint["@_x"] ?? 0),
            Number(targetPoint["@_y"] ?? 0),
          ];
        }
      }

      const arrowData: ArrowData = {
        kind: "arrow",
        points: allPoints,
        label: normalizeLabel(value, styleMap) || undefined,
      };

      // ── Routing mode from edgeStyle ──
      const edgeStyle = styleMap.get("edgeStyle");
      const curvedFlag = styleMap.get("curved");
      if (edgeStyle) {
        if (edgeStyle === "orthogonalEdgeStyle" && curvedFlag === "1") {
          arrowData.routing = "orthogonalCurved";
        } else {
          const routing = EDGE_STYLE_TO_ROUTING[edgeStyle];
          if (routing) {
            arrowData.routing = routing;
          }
        }
      }

      // ── Arrowhead types ──
      const startArrow = styleMap.get("startArrow");
      if (startArrow && KNOWN_ARROWHEADS.has(startArrow)) {
        arrowData.startArrowhead = startArrow as ArrowheadType;
      }
      const endArrow = styleMap.get("endArrow");
      if (endArrow && KNOWN_ARROWHEADS.has(endArrow)) {
        arrowData.endArrowhead = endArrow as ArrowheadType;
      }

      // ── Fill flags ──
      const startFillStr = styleMap.get("startFill");
      if (startFillStr !== undefined) {
        arrowData.startFill = startFillStr === "1";
      }
      const endFillStr = styleMap.get("endFill");
      if (endFillStr !== undefined) {
        arrowData.endFill = endFillStr === "1";
      }

      // ── Curved flag (standalone, not consumed by orthogonalCurved) ──
      if (curvedFlag === "1" && arrowData.routing !== "orthogonalCurved") {
        arrowData.curved = true;
      }

      // ── Rounded flag ──
      const roundedStr = styleMap.get("rounded");
      if (roundedStr === "1") {
        arrowData.rounded = true;
      }

      // ── Jetty size ──
      const jettySizeStr = styleMap.get("jettySize");
      if (jettySizeStr !== undefined) {
        arrowData.jettySize =
          jettySizeStr === "auto" ? "auto" : Number(jettySizeStr);
      }

      // ── Source/target bindings ──
      const source = cell["@_source"];
      if (source) {
        arrowData.startBinding = { expressionId: source, anchor: "auto" };
      }
      const target = cell["@_target"];
      if (target) {
        arrowData.endBinding = { expressionId: target, anchor: "auto" };
      }

      // ── Connection-point ports from exit/entry coordinates ──
      const exitX = styleMap.get("exitX");
      const exitY = styleMap.get("exitY");
      if (
        (exitX !== undefined || exitY !== undefined) &&
        arrowData.startBinding
      ) {
        if (exitX !== undefined) arrowData.startBinding.portX = Number(exitX);
        if (exitY !== undefined) arrowData.startBinding.portY = Number(exitY);
      }
      const entryX = styleMap.get("entryX");
      const entryY = styleMap.get("entryY");
      if (
        (entryX !== undefined || entryY !== undefined) &&
        arrowData.endBinding
      ) {
        if (entryX !== undefined) arrowData.endBinding.portX = Number(entryX);
        if (entryY !== undefined) arrowData.endBinding.portY = Number(entryY);
      }

      return arrowData;
    }
    case "line": {
      const lineWaypoints = extractWaypoints(geo);
      const linePoints: [number, number][] = [[0, 0], ...lineWaypoints, [0, 0]];

      // Check for sourcePoint/targetPoint in geometry
      if (geo?.mxPoint) {
        const geoPoints = Array.isArray(geo.mxPoint)
          ? geo.mxPoint
          : [geo.mxPoint];
        const sourcePoint = geoPoints.find((p) => p["@_as"] === "sourcePoint");
        const targetPoint = geoPoints.find((p) => p["@_as"] === "targetPoint");
        if (sourcePoint) {
          linePoints[0] = [
            Number(sourcePoint["@_x"] ?? 0),
            Number(sourcePoint["@_y"] ?? 0),
          ];
        }
        if (targetPoint) {
          linePoints[linePoints.length - 1] = [
            Number(targetPoint["@_x"] ?? 0),
            Number(targetPoint["@_y"] ?? 0),
          ];
        }
      }

      return { kind: "line", points: linePoints } as LineData;
    }
    default:
      return { kind: "rectangle", label: value || undefined } as RectangleData;
  }
}

// ── Parsed XML types (shared by drawioToExpressions & drawioToPages) ──

type ParsedMxGraphModel = { root?: { mxCell?: ParsedMxCell[] } };
type ParsedDiagram = {
  "@_id"?: string;
  "@_name"?: string;
  mxGraphModel?: ParsedMxGraphModel;
  "#text"?: string;
};
type ParsedRoot = {
  mxfile?: { diagram?: ParsedDiagram[] };
  mxGraphModel?: ParsedMxGraphModel;
  diagram?: ParsedDiagram[];
};

/** A single page (diagram tab) from a multi-page .drawio file. */
export interface DrawioPage {
  id: string;
  name: string;
  expressions: VisualExpression[];
}

/** Create a shared XML parser instance with consistent options. */
function createDrawioParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: false,
    isArray: (tagName) =>
      tagName === "mxCell" || tagName === "mxPoint" || tagName === "diagram",
  });
}

/**
 * Convert an array of parsed mxCells into VisualExpressions.
 * This is the shared cell-parsing logic (Pass 1 + Pass 2) used by both
 * drawioToExpressions and drawioToPages.
 */
function cellsToExpressions(cells: ParsedMxCell[]): VisualExpression[] {
  if (cells.length > MAX_EXPRESSION_COUNT) {
    throw new Error(
      `draw.io file contains ${cells.length} cells, exceeding the limit of ${MAX_EXPRESSION_COUNT}. ` +
        `Reduce the diagram size or split into smaller files.`,
    );
  }

  const expressions: VisualExpression[] = [];
  const now = Date.now();

  // ── Pass 1: index cells by id (for source/target lookup & parent/child relations) ──
  const cellById = new Map<string, ParsedMxCell>();
  for (const cell of cells) {
    const id = cell["@_id"];
    if (id) cellById.set(id, cell);
  }

  // ── Pass 1b: collect edge-label children — mxCells with style "edgeLabel" whose
  //    parent is an edge. These are floating labels on the edge (interface names,
  //    port identifiers). We merge them into the edge's label and skip emitting
  //    them as standalone rectangles.
  const edgeLabelsByParent = new Map<string, string[]>();
  const skipCells = new WeakSet<ParsedMxCell>();
  for (const cell of cells) {
    const parentId = cell["@_parent"];
    const style = cell["@_style"] ?? "";
    if (
      parentId &&
      cell["@_vertex"] === "1" &&
      /(^|;)\s*edgeLabel\s*(;|$)/.test(style) &&
      cellById.get(parentId)?.["@_edge"] === "1"
    ) {
      const childStyleMap = parseStyleString(style);
      const raw = unescapeXml(cell["@_value"] ?? "");
      const labelText = normalizeLabel(raw, childStyleMap);
      if (labelText) {
        const existing = edgeLabelsByParent.get(parentId) ?? [];
        existing.push(labelText);
        edgeLabelsByParent.set(parentId, existing);
      }
      skipCells.add(cell);
    }
  }

  // ── Pass 2: build expressions ──
  for (const cell of cells) {
    const id = cell["@_id"] ?? "";
    if (INFRASTRUCTURE_IDS.has(id)) continue;
    if (skipCells.has(cell)) continue;
    if (!cell["@_vertex"] && !cell["@_edge"]) continue;

    const styleStr = cell["@_style"] ?? "";
    const styleMap = parseStyleString(styleStr);
    const isEdge = cell["@_edge"] === "1";
    const hasBinding = Boolean(cell["@_source"] || cell["@_target"]);
    const kind = resolveKindFromStyle(styleMap, isEdge, hasBinding);
    const value = unescapeXml(cell["@_value"] ?? "");

    const geo = cell.mxGeometry;
    let { position, size } = isEdge
      ? { position: { x: 0, y: 0 }, size: { width: 0, height: 0 } }
      : extractGeometry(geo);

    let expressionStyle = styleMapToExpressionStyle(styleMap, kind);
    let data = buildExpressionData(kind, value, styleMap, cell, geo);
    let effectiveKind: VisualExpression["kind"] = kind;

    // ── HTML tables: detect and promote to a proper `table` expression ──
    if (
      !isEdge &&
      (kind === "text" || kind === "rectangle") &&
      /<table\b/i.test(value)
    ) {
      const tableParsed = parseHtmlTable(value);
      if (tableParsed) {
        effectiveKind = "table";
        data = {
          kind: "table",
          title: tableParsed.title,
          headers: tableParsed.headers,
          rows: tableParsed.rows,
        };
        expressionStyle = styleMapToExpressionStyle(styleMap, "table");

        // Estimate minimum width needed for the table content
        const CELL_PAD = 8;
        const TABLE_PAD = 8;
        const SWATCH_COL = 34;
        const FONT_PX = 11;
        const CHAR_WIDTH = FONT_PX * 0.58; // approximate average char width
        const colCount = Math.max(
          tableParsed.headers.length,
          ...tableParsed.rows.map((r) => r.length),
          1,
        );

        // Check if first column is all swatches
        const firstColSwatch =
          tableParsed.rows.length > 0 &&
          tableParsed.rows.every((row) => {
            const cell = row[0];
            return (
              cell !== undefined &&
              typeof cell === "object" &&
              cell.backgroundColor &&
              !cell.text.trim()
            );
          });

        let minWidth = TABLE_PAD * 2;
        for (let ci = 0; ci < colCount; ci++) {
          if (ci === 0 && firstColSwatch) {
            minWidth += SWATCH_COL;
          } else {
            let maxLen = 0;
            for (const row of tableParsed.rows) {
              const cell = row[ci];
              const text = typeof cell === "string" ? cell : (cell?.text ?? "");
              if (text.length > maxLen) maxLen = text.length;
            }
            // Also check header
            if (tableParsed.headers[ci]) {
              maxLen = Math.max(maxLen, tableParsed.headers[ci]!.length);
            }
            minWidth += maxLen * CHAR_WIDTH + CELL_PAD * 2;
          }
        }
        if (size.width < minWidth) size = { ...size, width: minWidth };

        // Also ensure height fits all rows
        const ROW_H = 28;
        const rowCount =
          tableParsed.rows.length +
          (tableParsed.title ? 1 : 0) +
          (tableParsed.headers.length > 0 ? 1 : 0);
        const minHeight = TABLE_PAD * 2 + rowCount * ROW_H;
        if (size.height < minHeight) size = { ...size, height: minHeight };
      }
    }

    // ── For edges: resolve source/target endpoints to shape centers ──
    if (
      isEdge &&
      (kind === "arrow" || kind === "line") &&
      "points" in (data as object)
    ) {
      const pts = (data as ArrowData | LineData).points;
      const hasExplicitSource =
        geo?.mxPoint &&
        (Array.isArray(geo.mxPoint) ? geo.mxPoint : [geo.mxPoint]).some(
          (p) => p["@_as"] === "sourcePoint",
        );
      const hasExplicitTarget =
        geo?.mxPoint &&
        (Array.isArray(geo.mxPoint) ? geo.mxPoint : [geo.mxPoint]).some(
          (p) => p["@_as"] === "targetPoint",
        );

      const srcId = cell["@_source"];
      if (!hasExplicitSource && srcId) {
        const srcCell = cellById.get(srcId);
        if (srcCell?.mxGeometry) {
          const g = extractGeometry(srcCell.mxGeometry);
          pts[0] = [
            g.position.x + g.size.width / 2,
            g.position.y + g.size.height / 2,
          ];
        }
      }
      const tgtId = cell["@_target"];
      if (!hasExplicitTarget && tgtId) {
        const tgtCell = cellById.get(tgtId);
        if (tgtCell?.mxGeometry) {
          const g = extractGeometry(tgtCell.mxGeometry);
          pts[pts.length - 1] = [
            g.position.x + g.size.width / 2,
            g.position.y + g.size.height / 2,
          ];
        }
      }
    }

    // ── Merge collected edge-label children into the arrow's label ──
    if (isEdge && kind === "arrow") {
      const extraLabels = edgeLabelsByParent.get(id);
      if (extraLabels && extraLabels.length > 0) {
        const arrowData = data as ArrowData;
        const merged = [arrowData.label, ...extraLabels]
          .filter(Boolean)
          .join("\n");
        arrowData.label = merged || undefined;
      }
    }

    // ── Edges need a non-zero bounding box to pass schema validation. ──
    if (
      isEdge &&
      (kind === "arrow" || kind === "line") &&
      "points" in (data as object)
    ) {
      const pts = (data as ArrowData | LineData).points;
      if (pts.length > 0) {
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);
        position = { x: minX, y: minY };
        size = {
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        };
      }
    }

    // Parse rotation angle from style
    const rotationStr = styleMap.get("rotation");
    const angle =
      rotationStr !== undefined ? sanitizeNum(Number(rotationStr), 0) : 0;

    const expr: VisualExpression = {
      id,
      kind: effectiveKind,
      position,
      size,
      angle,
      style: expressionStyle,
      meta: {
        author: {
          type: "agent",
          id: "drawio-import",
          name: "draw.io Import",
          provider: "infinicanvas",
        },
        createdAt: now,
        updatedAt: now,
        tags: ["drawio-import"],
        locked: false,
      },
      data,
    };

    expressions.push(expr);
  }

  return expressions;
}

/**
 * Detect compressed diagrams and throw a helpful error.
 */
function checkCompressedDiagrams(diagrams: ParsedDiagram[]): void {
  for (const d of diagrams) {
    const text = typeof d === "string" ? d : d?.["#text"];
    if (
      typeof text === "string" &&
      text.trim().length > 0 &&
      !text.includes("<")
    ) {
      throw new Error(
        "This draw.io file is compressed. In draw.io, open Extras → Edit Diagram and " +
          'export with "Uncompressed XML" (or disable "Compressed" in File → Properties), ' +
          "then import the uncompressed .drawio / .xml file.",
      );
    }
  }
}

/**
 * Parse XML and return the parsed root.
 */
function parseDrawioXml(xml: string): ParsedRoot | null {
  if (xml.length > MAX_INPUT_SIZE) {
    throw new Error(
      `draw.io XML input too large: ${xml.length} bytes exceeds ${MAX_INPUT_SIZE} byte limit`,
    );
  }
  try {
    return createDrawioParser().parse(xml) as ParsedRoot;
  } catch {
    return null;
  }
}

/**
 * Import draw.io mxGraphModel XML to VisualExpressions.
 * Returns expressions from the first diagram page (backwards-compatible).
 *
 * @param xml - mxGraphModel XML string to parse
 * @returns Array of VisualExpressions
 */
export function drawioToExpressions(xml: string): VisualExpression[] {
  const parsed = parseDrawioXml(xml);
  if (!parsed) return [];

  // Form 3: bare <mxGraphModel>
  if (parsed.mxGraphModel) {
    const cells = parsed.mxGraphModel.root?.mxCell;
    if (!cells) return [];
    return cellsToExpressions(cells);
  }

  // Form 1 & 2: <mxfile><diagram>… or <diagram>…
  const diagrams = parsed.mxfile?.diagram ?? parsed.diagram ?? [];
  for (const d of diagrams) {
    if (d?.mxGraphModel) {
      const cells = d.mxGraphModel.root?.mxCell;
      if (cells) return cellsToExpressions(cells);
    }
  }

  // Check for compressed diagrams
  checkCompressedDiagrams(diagrams);
  return [];
}

/**
 * Parse ALL diagram pages from a .drawio file.
 *
 * Handles three XML forms:
 *   1) <mxfile><diagram>…</diagram><diagram>…</diagram></mxfile>
 *   2) <diagram><mxGraphModel>…</mxGraphModel></diagram>
 *   3) <mxGraphModel>…</mxGraphModel> (bare — returns single page)
 *
 * @param xml - .drawio XML string
 * @returns Array of DrawioPage objects
 */
export function drawioToPages(xml: string): DrawioPage[] {
  const parsed = parseDrawioXml(xml);
  if (!parsed) return [];

  // Form 3: bare <mxGraphModel> → single page
  if (parsed.mxGraphModel) {
    const cells = parsed.mxGraphModel.root?.mxCell;
    if (!cells) return [];
    return [
      { id: "1", name: "Page 1", expressions: cellsToExpressions(cells) },
    ];
  }

  // Form 1 & 2: iterate all <diagram> elements
  const diagrams = parsed.mxfile?.diagram ?? parsed.diagram ?? [];
  const pages: DrawioPage[] = [];
  for (let i = 0; i < diagrams.length; i++) {
    const d = diagrams[i];
    if (!d?.mxGraphModel) continue;
    const cells = d.mxGraphModel.root?.mxCell;
    if (!cells) continue;
    pages.push({
      id: d["@_id"] ?? String(i + 1),
      name: d["@_name"] ?? `Page ${i + 1}`,
      expressions: cellsToExpressions(cells),
    });
  }

  if (pages.length === 0) {
    checkCompressedDiagrams(diagrams);
  }

  return pages;
}

/**
 * Serialize multiple pages to .drawio XML with <mxfile> wrapper.
 *
 * @param pages - Array of DrawioPage objects
 * @returns Valid .drawio XML string
 */
export function pagesToDrawio(pages: DrawioPage[]): string {
  const diagramXml = pages.map((page) => {
    const cells = page.expressions.map((expr) => {
      if (expr.kind === "arrow" || expr.kind === "line") {
        return edgeToMxCell(expr);
      }
      return vertexToMxCell(expr);
    });

    return [
      `  <diagram id="${escapeXml(page.id)}" name="${escapeXml(page.name)}">`,
      "    <mxGraphModel>",
      "      <root>",
      '        <mxCell id="0"/>',
      '        <mxCell id="1" parent="0"/>',
      ...cells.map((c) => "    " + c),
      "      </root>",
      "    </mxGraphModel>",
      "  </diagram>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<mxfile>",
    ...diagramXml,
    "</mxfile>",
  ].join("\n");
}
