/**
 * Morph Engine — transforms expressions between compatible kinds.
 *
 * Preserves semantic content while changing the visual representation.
 * Each morph function maps data fields from the source kind to the
 * target kind, generating new IDs where needed.
 *
 * Supported morphs:
 * - flowchart ↔ table (nodes → rows, edges as connections column)
 * - roadmap ↔ kanban (phases → columns, items → cards)
 * - mind-map ↔ table (flatten branches → rows with parent column)
 * - reasoning-chain ↔ flowchart (steps → nodes, sequential edges)
 *
 * @module
 */

import { nanoid } from "nanoid";
import type {
  VisualExpression,
  ExpressionKind,
  ExpressionData,
  FlowchartData,
  FlowNode,
  FlowEdge,
  TableData,
  TableCell,
  RoadmapData,
  KanbanData,
  MindMapData,
  MindMapBranch,
  ReasoningChainData,
} from "../../protocol";

// ── Morph registry ─────────────────────────────────────────

/** Bidirectional morph pairs — each entry represents a supported transformation. */
const MORPH_PAIRS: ReadonlyArray<[ExpressionKind, ExpressionKind]> = [
  ["flowchart", "table"],
  ["table", "flowchart"],
  ["roadmap", "kanban"],
  ["kanban", "roadmap"],
  ["mind-map", "table"],
  ["table", "mind-map"],
  ["reasoning-chain", "flowchart"],
  ["flowchart", "reasoning-chain"],
];

/** Map from source kind → list of valid target kinds. */
const MORPH_TARGET_MAP = new Map<ExpressionKind, ExpressionKind[]>();

for (const [from, to] of MORPH_PAIRS) {
  const targets = MORPH_TARGET_MAP.get(from) ?? [];
  targets.push(to);
  MORPH_TARGET_MAP.set(from, targets);
}

/** Morph function signature: converts source data to target data. */
type MorphFn = (data: ExpressionData) => ExpressionData;

/** Registry of morph functions keyed by "fromKind→toKind". */
const morphFunctions = new Map<string, MorphFn>();

/** Register a morph function for a specific kind pair. */
function registerMorph(
  from: ExpressionKind,
  to: ExpressionKind,
  fn: MorphFn,
): void {
  morphFunctions.set(`${from}→${to}`, fn);
}

// ── Public API ─────────────────────────────────────────────

/**
 * Check whether a morph from one kind to another is supported.
 *
 * @param fromKind - Source expression kind
 * @param toKind - Target expression kind
 * @returns true if the transformation is supported
 */
export function canMorph(
  fromKind: ExpressionKind,
  toKind: ExpressionKind,
): boolean {
  if (fromKind === toKind) return false;
  return morphFunctions.has(`${fromKind}→${toKind}`);
}

/**
 * Get all valid morph targets for a given expression kind.
 *
 * @param fromKind - Source expression kind
 * @returns Array of expression kinds that fromKind can morph into
 */
export function getMorphTargets(fromKind: ExpressionKind): ExpressionKind[] {
  return MORPH_TARGET_MAP.get(fromKind) ?? [];
}

/**
 * Transform an expression from its current kind to a target kind.
 *
 * Returns a new VisualExpression with the target kind and transformed
 * data, preserving identity (id), position, size, style, and metadata.
 * Returns null if the morph is not supported.
 *
 * @param expression - The source expression to morph
 * @param toKind - The target expression kind
 * @returns A new VisualExpression with transformed data, or null
 */
export function morphExpression(
  expression: VisualExpression,
  toKind: ExpressionKind,
): VisualExpression | null {
  if (!canMorph(expression.kind, toKind)) {
    return null;
  }

  const morphFn = morphFunctions.get(`${expression.kind}→${toKind}`);
  if (!morphFn) {
    return null;
  }

  const newData = morphFn(expression.data);

  return {
    ...structuredClone(expression),
    kind: toKind,
    data: newData,
    meta: {
      ...structuredClone(expression.meta),
      updatedAt: Date.now(),
    },
  };
}

// ── Morph implementations ──────────────────────────────────

// ── Flowchart → Table ──────────────────────────────────────

function flowchartToTable(data: ExpressionData): ExpressionData {
  const flow = data as FlowchartData;

  const headers = ["Node", "Shape", "Connections"];

  const rows = flow.nodes.map((node) => {
    const outgoing = flow.edges
      .filter((e) => e.from === node.id)
      .map((e) => {
        const target = flow.nodes.find((n) => n.id === e.to);
        const targetLabel = target?.label ?? e.to;
        return e.label ? `→ ${targetLabel} (${e.label})` : `→ ${targetLabel}`;
      })
      .join(", ");

    return [node.label, node.shape, outgoing];
  });

  const result: TableData = {
    kind: "table",
    headers,
    rows,
  };
  return result;
}

registerMorph("flowchart", "table", flowchartToTable);

// ── Table → Flowchart ──────────────────────────────────────

/** Valid flow node shapes for shape column parsing. */
const VALID_SHAPES = new Set<FlowNode["shape"]>([
  "rect",
  "diamond",
  "ellipse",
  "parallelogram",
  "cylinder",
]);

function isValidShape(s: string): s is FlowNode["shape"] {
  return VALID_SHAPES.has(s as FlowNode["shape"]);
}

/** Extract plain text from a table cell (string or TableCell object). */
function cellText(cell: string | TableCell | undefined): string {
  if (!cell) return "";
  return typeof cell === "string" ? cell : cell.text;
}

function tableToFlowchart(data: ExpressionData): ExpressionData {
  const table = data as TableData;

  const nodeColIdx = 0;
  const shapeColIdx =
    table.headers.indexOf("Shape") >= 0 ? table.headers.indexOf("Shape") : 1;
  const connColIdx =
    table.headers.indexOf("Connections") >= 0
      ? table.headers.indexOf("Connections")
      : 2;

  const nodes: FlowNode[] = [];
  const nodeIdMap = new Map<string, string>();

  // Build nodes from rows
  for (const row of table.rows) {
    const label = cellText(row[nodeColIdx]);
    const shapeStr = cellText(row[shapeColIdx]) || "rect";
    const shape: FlowNode["shape"] = isValidShape(shapeStr) ? shapeStr : "rect";
    const id = nanoid(8);
    nodes.push({ id, label, shape });
    nodeIdMap.set(label, id);
  }

  // Build edges from connections column
  const edges: FlowEdge[] = [];
  for (const row of table.rows) {
    const label = cellText(row[nodeColIdx]);
    const fromId = nodeIdMap.get(label);
    if (!fromId) continue;

    const connections = cellText(row[connColIdx]);
    if (!connections) continue;

    // Parse "→ TargetLabel" or "→ TargetLabel (edgeLabel)" patterns
    const connParts = connections.split(",").map((s: string) => s.trim());
    for (const part of connParts) {
      const match = part.match(/^→\s*(.+?)(?:\s*\((.+)\))?$/);
      if (match) {
        const targetLabel = match[1]!.trim();
        const edgeLabel = match[2]?.trim();
        const toId = nodeIdMap.get(targetLabel);
        if (toId) {
          edges.push({ from: fromId, to: toId, label: edgeLabel });
        }
      }
    }
  }

  const result: FlowchartData = {
    kind: "flowchart",
    title: "Flowchart",
    nodes,
    edges,
    direction: "TB",
  };
  return result;
}

registerMorph("table", "flowchart", tableToFlowchart);

// ── Roadmap → Kanban ───────────────────────────────────────

function roadmapToKanban(data: ExpressionData): ExpressionData {
  const roadmap = data as RoadmapData;

  const result: KanbanData = {
    kind: "kanban",
    title: roadmap.title,
    columns: roadmap.phases.map((phase) => ({
      id: `col-${phase.id}`,
      title: phase.name,
      cards: phase.items.map((item) => ({
        id: `card-${item.id}`,
        title: item.title,
        description: `Status: ${item.status}`,
      })),
    })),
  };
  return result;
}

registerMorph("roadmap", "kanban", roadmapToKanban);

// ── Kanban → Roadmap ───────────────────────────────────────

/** Extract status from card description like "Status: done". */
function parseStatus(description?: string): "planned" | "in-progress" | "done" {
  if (!description) return "planned";
  const lower = description.toLowerCase();
  if (lower.includes("done")) return "done";
  if (lower.includes("in-progress") || lower.includes("in progress"))
    return "in-progress";
  return "planned";
}

function kanbanToRoadmap(data: ExpressionData): ExpressionData {
  const kanban = data as KanbanData;

  const result: RoadmapData = {
    kind: "roadmap",
    title: kanban.title,
    orientation: "horizontal",
    phases: kanban.columns.map((col) => ({
      id: nanoid(8),
      name: col.title,
      items: col.cards.map((card) => ({
        id: nanoid(8),
        title: card.title,
        status: parseStatus(card.description),
      })),
    })),
  };
  return result;
}

registerMorph("kanban", "roadmap", kanbanToRoadmap);

// ── Mind Map → Table ───────────────────────────────────────

/** Recursively flatten a mind map branch tree into rows. */
function flattenBranches(
  branches: MindMapBranch[],
  parentLabel: string,
  rows: string[][],
): void {
  for (const branch of branches) {
    rows.push([branch.label, parentLabel]);
    flattenBranches(branch.children, branch.label, rows);
  }
}

function mindMapToTable(data: ExpressionData): ExpressionData {
  const mindMap = data as MindMapData;

  const rows: string[][] = [];
  flattenBranches(mindMap.branches, mindMap.centralTopic, rows);

  const result: TableData = {
    kind: "table",
    headers: ["Topic", "Parent"],
    rows,
  };
  return result;
}

registerMorph("mind-map", "table", mindMapToTable);

// ── Table → Mind Map ───────────────────────────────────────

function tableToMindMap(data: ExpressionData): ExpressionData {
  const table = data as TableData;

  const topicIdx = 0;
  const parentIdx =
    table.headers.indexOf("Parent") >= 0 ? table.headers.indexOf("Parent") : 1;

  // Collect all parent values to find the root (a parent that is never a topic)
  const allTopics = new Set(table.rows.map((r) => cellText(r[topicIdx])));
  const allParents = new Set(table.rows.map((r) => cellText(r[parentIdx])));

  // Root is the parent that is NOT itself a topic
  let centralTopic = "Root";
  for (const parent of allParents) {
    if (!allTopics.has(parent)) {
      centralTopic = parent || "Root";
      break;
    }
  }

  // Build a map of parent → children topics
  const childrenMap = new Map<string, string[]>();
  for (const row of table.rows) {
    const topic = cellText(row[topicIdx]);
    const parent = cellText(row[parentIdx]);
    const children = childrenMap.get(parent) ?? [];
    children.push(topic);
    childrenMap.set(parent, children);
  }

  /** Recursively build branches from the children map. */
  function buildBranches(parent: string): MindMapBranch[] {
    const children = childrenMap.get(parent) ?? [];
    return children.map((label) => ({
      id: nanoid(8),
      label,
      children: buildBranches(label),
    }));
  }

  const result: MindMapData = {
    kind: "mind-map",
    centralTopic,
    branches: buildBranches(centralTopic),
  };
  return result;
}

registerMorph("table", "mind-map", tableToMindMap);

// ── Reasoning Chain → Flowchart ────────────────────────────

function reasoningChainToFlowchart(data: ExpressionData): ExpressionData {
  const rc = data as ReasoningChainData;

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // Question node (start)
  const questionId = nanoid(8);
  nodes.push({ id: questionId, label: rc.question, shape: "ellipse" });

  // Step nodes
  let prevId = questionId;
  for (const step of rc.steps) {
    const stepId = nanoid(8);
    nodes.push({ id: stepId, label: step.title, shape: "rect" });
    edges.push({ from: prevId, to: stepId });
    prevId = stepId;
  }

  // Final answer node (end)
  const answerId = nanoid(8);
  nodes.push({ id: answerId, label: rc.finalAnswer, shape: "ellipse" });
  edges.push({ from: prevId, to: answerId });

  const result: FlowchartData = {
    kind: "flowchart",
    title: "Reasoning Chain",
    nodes,
    edges,
    direction: "TB",
  };
  return result;
}

registerMorph("reasoning-chain", "flowchart", reasoningChainToFlowchart);

// ── Flowchart → Reasoning Chain ────────────────────────────

/**
 * Topologically traverse a flowchart to find a linear path from
 * a root node (no incoming edges) to a leaf node (no outgoing edges).
 * Falls back to node order if no clear path exists.
 */
function findLinearPath(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  if (nodes.length === 0) return [];

  const outgoing = new Map<string, string[]>();
  const incoming = new Set<string>();

  for (const edge of edges) {
    const targets = outgoing.get(edge.from) ?? [];
    targets.push(edge.to);
    outgoing.set(edge.from, targets);
    incoming.add(edge.to);
  }

  // Find root node (no incoming edges)
  let start = nodes[0];
  for (const node of nodes) {
    if (!incoming.has(node.id)) {
      start = node;
      break;
    }
  }

  // Walk the path linearly (first outgoing edge at each step)
  const visited = new Set<string>();
  const path: FlowNode[] = [];
  let current: FlowNode | undefined = start;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    path.push(current);
    const targets: string[] = outgoing.get(current.id) ?? [];
    const nextId: string | undefined = targets[0];
    current = nextId ? nodes.find((n) => n.id === nextId) : undefined;
  }

  return path;
}

function flowchartToReasoningChain(data: ExpressionData): ExpressionData {
  const flow = data as FlowchartData;

  const path = findLinearPath(flow.nodes, flow.edges);

  if (path.length === 0) {
    const result: ReasoningChainData = {
      kind: "reasoning-chain",
      question: "",
      steps: [],
      finalAnswer: "",
    };
    return result;
  }

  // First node is the question, last is the answer, middle are steps
  const question = path[0]!.label;
  const finalAnswer = path.length > 1 ? path[path.length - 1]!.label : "";
  const stepNodes = path.length > 2 ? path.slice(1, -1) : [];

  const result: ReasoningChainData = {
    kind: "reasoning-chain",
    question,
    steps: stepNodes.map((node) => ({
      title: node.label,
      content: node.label,
    })),
    finalAnswer,
  };
  return result;
}

registerMorph("flowchart", "reasoning-chain", flowchartToReasoningChain);
