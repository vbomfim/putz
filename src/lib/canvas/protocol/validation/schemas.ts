/**
 * Zod validation schemas for InfiniCanvas Protocol.
 *
 * These schemas mirror the TypeScript types and are used at runtime
 * to validate incoming data from agents, clients, and the gateway.
 *
 * @module
 */

import { z } from 'zod';


// ── Depth limiting for recursive schemas ───────────────────

/** Maximum recursion depth for mind map branches. */
const MAX_MIND_MAP_DEPTH = 10;

/** Maximum recursion depth for decision tree options. */
const MAX_DECISION_DEPTH = 8;

/**
 * Measures the maximum nesting depth of a recursive structure with `children` arrays.
 * A leaf node (no children or empty children) has depth 1.
 */
function measureChildrenDepth(node: unknown, depth = 1): number {
  if (typeof node !== 'object' || node === null) return depth;
  const record = node as Record<string, unknown>;
  const children = record.children;
  if (!Array.isArray(children) || children.length === 0) return depth;
  return Math.max(...children.map((child) => measureChildrenDepth(child, depth + 1)));
}

/**
 * Wraps a Zod schema with a maximum depth check for recursive `children` arrays.
 * Rejects inputs where nesting depth exceeds `maxDepth` levels. [S7-3]
 */
export function withMaxDepth<T>(schema: z.ZodType<T>, maxDepth: number) {
  return schema.superRefine((data: T, ctx: z.RefinementCtx) => {
    const depth = measureChildrenDepth(data);
    if (depth > maxDepth) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Recursive structure exceeds maximum depth of ${maxDepth}`,
        path: ['children'],
      });
    }
  });
}

// ── Metadata Schemas ───────────────────────────────────────

export const humanAuthorSchema = z.object({
  type: z.literal('human'),
  id: z.string().min(1),
  name: z.string().min(1).max(500),
});

export const agentAuthorSchema = z.object({
  type: z.literal('agent'),
  id: z.string().min(1),
  name: z.string().min(1).max(500),
  provider: z.string().min(1).max(500),
});

export const authorInfoSchema = z.discriminatedUnion('type', [
  humanAuthorSchema,
  agentAuthorSchema,
]);

const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

export const expressionStyleSchema = z.object({
  strokeColor: z.string().regex(hexColorPattern, 'Must be a hex color (e.g. #000000)'),
  backgroundColor: z.union([
    z.string().regex(hexColorPattern, 'Must be a hex color'),
    z.literal('transparent'),
  ]),
  fillStyle: z.enum(['solid', 'hachure', 'cross-hatch', 'none']),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).default('solid'),
  strokeWidth: z.number().positive().max(100),
  roughness: z.number().min(0),
  opacity: z.number().min(0).max(1),
  fontSize: z.number().positive().optional(),
  fontFamily: z.string().min(1).max(500).optional(),
});

// ── Primitive Data Schemas ─────────────────────────────────

export const rectangleDataSchema = z.object({
  kind: z.literal('rectangle'),
  label: z.string().max(500).optional(),
});

export const ellipseDataSchema = z.object({
  kind: z.literal('ellipse'),
  label: z.string().max(500).optional(),
});

export const diamondDataSchema = z.object({
  kind: z.literal('diamond'),
  label: z.string().max(500).optional(),
});

const point2dSchema = z.tuple([z.number(), z.number()]);

export const lineDataSchema = z.object({
  kind: z.literal('line'),
  points: z.array(point2dSchema).min(2),
});

const arrowBindingSchema = z.object({
  expressionId: z.string().min(1),
  anchor: z.enum(['center', 'top', 'right', 'bottom', 'left',
    'top-left', 'top-right', 'bottom-left', 'bottom-right', 'auto']),
  ratio: z.number().min(0).max(1).optional(),
  portX: z.number().min(0).max(1).optional(),
  portY: z.number().min(0).max(1).optional(),
});

const arrowheadTypeSchema = z.enum([
  // Legacy (backward compat)
  'none', 'triangle', 'chevron', 'circle',
  // Standard
  'classic', 'classicThin', 'open', 'openThin',
  'block', 'blockThin', 'oval', 'diamond', 'diamondThin',
  // ER Diagram
  'ERone', 'ERmany', 'ERmandOne', 'ERoneToMany', 'ERzeroToOne', 'ERzeroToMany',
  // UML
  'openAsync', 'dash', 'cross',
  // Other
  'box', 'halfCircle', 'doubleBlock',
]);

const routingModeSchema = z.enum([
  'straight', 'orthogonal', 'curved', 'elbow',
  'entityRelation', 'isometric', 'orthogonalCurved',
]);

export const arrowDataSchema = z.object({
  kind: z.literal('arrow'),
  points: z.array(point2dSchema).min(2),
  startArrowhead: z.union([z.boolean(), arrowheadTypeSchema]).optional(),
  endArrowhead: z.union([z.boolean(), arrowheadTypeSchema]).optional(),
  startFill: z.boolean().optional(),
  endFill: z.boolean().optional(),
  startBinding: arrowBindingSchema.optional(),
  endBinding: arrowBindingSchema.optional(),
  label: z.string().max(500).optional(),
  routing: routingModeSchema.optional(),
  curved: z.boolean().optional(),
  rounded: z.boolean().optional(),
  jettySize: z.union([z.number().nonnegative(), z.literal('auto')]).optional(),
  midpointOffset: z.number().min(0).max(1).optional(),
});

const point3dSchema = z.tuple([z.number(), z.number(), z.number()]);

export const freehandDataSchema = z.object({
  kind: z.literal('freehand'),
  points: z.array(point3dSchema).min(1),
});

export const textDataSchema = z.object({
  kind: z.literal('text'),
  text: z.string().max(10_000),
  fontSize: z.number().positive(),
  fontFamily: z.string().min(1).max(500),
  textAlign: z.enum(['left', 'center', 'right']),
});

export const stickyNoteDataSchema = z.object({
  kind: z.literal('sticky-note'),
  text: z.string().max(10_000),
  color: z.string().min(1).max(500),
});

export const imageDataSchema = z.object({
  kind: z.literal('image'),
  src: z.string().min(1).max(2_000_000).refine(
    (s) => /^(https?:\/\/|data:image\/)/.test(s),
    'Must be http(s) URL or data:image/ URI',
  ),
  alt: z.string().max(500).optional(),
});

export const stencilDataSchema = z.object({
  kind: z.literal('stencil'),
  stencilId: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  label: z.string().max(200).optional(),
  labelPosition: z.enum(['below', 'top-left', 'top-center', 'center']).optional(),
  labelFontSize: z.number().positive().optional(),
});

export const containerDataSchema = z.object({
  kind: z.literal('container'),
  title: z.string().max(500),
  headerHeight: z.number().positive(),
  padding: z.number().nonnegative(),
  collapsed: z.boolean(),
});

// ── Composite Data Schemas ─────────────────────────────────

const flowNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().max(500),
  shape: z.enum(['rect', 'diamond', 'ellipse', 'parallelogram', 'cylinder']),
});

const flowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(500).optional(),
});

export const flowchartDataSchema = z.object({
  kind: z.literal('flowchart'),
  title: z.string().max(500),
  nodes: z.array(flowNodeSchema).min(1),
  edges: z.array(flowEdgeSchema),
  direction: z.enum(['TB', 'LR', 'BT', 'RL']),
});

const participantSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(500),
});

const messageSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(500),
  type: z.enum(['sync', 'async', 'reply']),
});

export const sequenceDiagramDataSchema = z.object({
  kind: z.literal('sequence-diagram'),
  title: z.string().max(500),
  participants: z.array(participantSchema).min(2),
  messages: z.array(messageSchema),
});

const wireframeComponentSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['button', 'input', 'text', 'image', 'container', 'nav', 'list']),
  label: z.string().max(500),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});

export const wireframeDataSchema = z.object({
  kind: z.literal('wireframe'),
  title: z.string().max(500),
  screenSize: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  components: z.array(wireframeComponentSchema),
});

const reasoningStepSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(10_000),
});

export const reasoningChainDataSchema = z.object({
  kind: z.literal('reasoning-chain'),
  question: z.string().min(1).max(10_000),
  steps: z.array(reasoningStepSchema).min(1),
  finalAnswer: z.string().min(1).max(10_000),
});

const roadmapItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500),
  status: z.enum(['planned', 'in-progress', 'done']),
});

const roadmapPhaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(500),
  items: z.array(roadmapItemSchema),
});

export const roadmapDataSchema = z.object({
  kind: z.literal('roadmap'),
  title: z.string().max(500),
  orientation: z.enum(['horizontal', 'vertical']),
  phases: z.array(roadmapPhaseSchema).min(1),
});

const mindMapBranchSchema: z.ZodType<{
  id: string;
  label: string;
  children: unknown[];
}> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(500),
    children: z.array(mindMapBranchSchema),
  }),
);

export const mindMapDataSchema = z.object({
  kind: z.literal('mind-map'),
  centralTopic: z.string().min(1).max(500),
  branches: z.array(mindMapBranchSchema),
});

const kanbanCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500),
  description: z.string().max(10_000).optional(),
});

const kanbanColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(500),
  cards: z.array(kanbanCardSchema),
});

export const kanbanDataSchema = z.object({
  kind: z.literal('kanban'),
  title: z.string().max(500),
  columns: z.array(kanbanColumnSchema).min(1),
});

const decisionOptionSchema: z.ZodType<{
  label: string;
  outcome?: string;
  children: unknown[];
}> = z.lazy(() =>
  z.object({
    label: z.string().min(1).max(500),
    outcome: z.string().max(10_000).optional(),
    children: z.array(decisionOptionSchema),
  }),
);

export const decisionTreeDataSchema = z.object({
  kind: z.literal('decision-tree'),
  question: z.string().min(1).max(10_000),
  options: z.array(decisionOptionSchema).min(1),
});

const collabObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(500),
  type: z.string().min(1).max(500),
});

const collabLinkSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().max(500),
  direction: z.enum(['unidirectional', 'bidirectional']),
});

export const collaborationDiagramDataSchema = z.object({
  kind: z.literal('collaboration-diagram'),
  title: z.string().max(500),
  objects: z.array(collabObjectSchema),
  links: z.array(collabLinkSchema),
});

export const slideDataSchema = z.object({
  kind: z.literal('slide'),
  title: z.string().max(500),
  bullets: z.array(z.string().max(10_000)),
  layout: z.enum(['title', 'bullets', 'split']),
});

export const codeBlockDataSchema = z.object({
  kind: z.literal('code-block'),
  language: z.string().min(1).max(500),
  code: z.string().max(100_000),
});

export const tableDataSchema = z.object({
  kind: z.literal('table'),
  headers: z.array(z.string().max(500)).min(1),
  rows: z.array(z.array(z.string().max(10_000))),
});

// ── Annotation Data Schemas ────────────────────────────────

export const commentDataSchema = z.object({
  kind: z.literal('comment'),
  text: z.string().min(1).max(10_000),
  targetExpressionId: z.string().min(1),
  resolved: z.boolean(),
});

export const calloutDataSchema = z.object({
  kind: z.literal('callout'),
  text: z.string().min(1).max(10_000),
  targetExpressionId: z.string().min(1),
  position: z.enum(['top', 'right', 'bottom', 'left']),
});

export const highlightDataSchema = z.object({
  kind: z.literal('highlight'),
  targetExpressionIds: z.array(z.string().min(1)).min(1),
  color: z.string().min(1).max(500),
});

export const markerDataSchema = z.object({
  kind: z.literal('marker'),
  label: z.string().min(1).max(500),
  icon: z.string().max(500).optional(),
});

// ── Expression Data Union ──────────────────────────────────

export const expressionDataSchema = z.discriminatedUnion('kind', [
  // Primitives
  rectangleDataSchema,
  ellipseDataSchema,
  diamondDataSchema,
  lineDataSchema,
  arrowDataSchema,
  freehandDataSchema,
  textDataSchema,
  stickyNoteDataSchema,
  imageDataSchema,
  stencilDataSchema,
  containerDataSchema,
  // Composites
  flowchartDataSchema,
  sequenceDiagramDataSchema,
  wireframeDataSchema,
  reasoningChainDataSchema,
  roadmapDataSchema,
  mindMapDataSchema,
  kanbanDataSchema,
  decisionTreeDataSchema,
  collaborationDiagramDataSchema,
  slideDataSchema,
  codeBlockDataSchema,
  tableDataSchema,
  // Annotations
  commentDataSchema,
  calloutDataSchema,
  highlightDataSchema,
  markerDataSchema,
]);

// ── Visual Expression Schema ───────────────────────────────

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const sizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});

const expressionMetaSchema = z.object({
  author: authorInfoSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  sourceOperation: z.string().optional(),
  tags: z.array(z.string().max(500)),
  locked: z.boolean(),
});

export const visualExpressionSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  position: positionSchema,
  size: sizeSchema,
  angle: z.number(),
  style: expressionStyleSchema,
  meta: expressionMetaSchema,
  parentId: z.string().optional(),
  children: z.array(z.string()).optional(),
  layerId: z.string().optional(),
  data: expressionDataSchema,
}).refine(
  (expr) => expr.kind === (expr.data as { kind: string }).kind,
  { message: 'Expression kind must match data.kind', path: ['kind'] },
).superRefine((expr, ctx) => {
  // Depth-limit recursive schemas [S7-3]
  const data = expr.data as Record<string, unknown>;
  if (data.kind === 'mind-map' && Array.isArray(data.branches)) {
    for (let i = 0; i < (data.branches as unknown[]).length; i++) {
      if (measureChildrenDepth((data.branches as unknown[])[i]) > MAX_MIND_MAP_DEPTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Mind map branch exceeds maximum depth of ${MAX_MIND_MAP_DEPTH}`,
          path: ['data', 'branches', i],
        });
      }
    }
  }
  if (data.kind === 'decision-tree' && Array.isArray(data.options)) {
    for (let i = 0; i < (data.options as unknown[]).length; i++) {
      if (measureChildrenDepth((data.options as unknown[])[i]) > MAX_DECISION_DEPTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Decision tree exceeds maximum depth of ${MAX_DECISION_DEPTH}`,
          path: ['data', 'options', i],
        });
      }
    }
  }
});

// ── Operation Schemas ──────────────────────────────────────

const expressionKindSchema = z.string().min(1);

export const createPayloadSchema = z.object({
  type: z.literal('create'),
  expressionId: z.string().min(1),
  kind: expressionKindSchema,
  position: positionSchema,
  size: sizeSchema,
  data: expressionDataSchema,
  style: expressionStyleSchema.optional(),
  angle: z.number().optional(),
});

export const updatePayloadSchema = z.object({
  type: z.literal('update'),
  expressionId: z.string().min(1),
  changes: z.object({
    position: positionSchema.optional(),
    size: sizeSchema.optional(),
    angle: z.number().optional(),
    style: expressionStyleSchema.partial().optional(),
    data: expressionDataSchema.optional(),
  }),
});

export const deletePayloadSchema = z.object({
  type: z.literal('delete'),
  expressionIds: z.array(z.string().min(1)).min(1),
});

export const movePayloadSchema = z.object({
  type: z.literal('move'),
  expressionId: z.string().min(1),
  from: positionSchema,
  to: positionSchema,
});

export const transformPayloadSchema = z.object({
  type: z.literal('transform'),
  expressionId: z.string().min(1),
  angle: z.number().optional(),
  scale: z.object({ x: z.number(), y: z.number() }).optional(),
  size: sizeSchema.optional(),
});

export const groupPayloadSchema = z.object({
  type: z.literal('group'),
  expressionIds: z.array(z.string().min(1)).min(2),
  groupId: z.string().min(1),
});

export const ungroupPayloadSchema = z.object({
  type: z.literal('ungroup'),
  groupId: z.string().min(1),
});

export const annotatePayloadSchema = z.object({
  type: z.literal('annotate'),
  targetExpressionId: z.string().min(1),
  annotationId: z.string().min(1),
  annotationKind: z.enum(['comment', 'callout', 'highlight', 'marker']),
});

export const morphPayloadSchema = z.object({
  type: z.literal('morph'),
  expressionId: z.string().min(1),
  fromKind: expressionKindSchema,
  toKind: expressionKindSchema,
  newData: expressionDataSchema,
});

export const lockPayloadSchema = z.object({
  type: z.literal('lock'),
  expressionIds: z.array(z.string().min(1)).min(1),
});

export const unlockPayloadSchema = z.object({
  type: z.literal('unlock'),
  expressionIds: z.array(z.string().min(1)).min(1),
});

export const stylePayloadSchema = z.object({
  type: z.literal('style'),
  expressionIds: z.array(z.string().min(1)).min(1),
  style: expressionStyleSchema.partial(),
});

export const reorderPayloadSchema = z.object({
  type: z.literal('reorder'),
  expressionId: z.string().min(1),
  newIndex: z.number().int().nonnegative(),
});

export const snapshotPayloadSchema = z.object({
  type: z.literal('snapshot'),
  label: z.string().min(1).max(500),
  expressionIds: z.array(z.string()),
});

export const queryPayloadSchema = z.object({
  type: z.literal('query'),
  kind: expressionKindSchema.optional(),
  tags: z.array(z.string()).optional(),
  bounds: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
});

export const operationPayloadSchema = z.discriminatedUnion('type', [
  createPayloadSchema,
  updatePayloadSchema,
  deletePayloadSchema,
  movePayloadSchema,
  transformPayloadSchema,
  groupPayloadSchema,
  ungroupPayloadSchema,
  annotatePayloadSchema,
  morphPayloadSchema,
  lockPayloadSchema,
  unlockPayloadSchema,
  stylePayloadSchema,
  reorderPayloadSchema,
  snapshotPayloadSchema,
  queryPayloadSchema,
]);

export const protocolOperationSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'create', 'update', 'delete', 'move', 'transform',
    'group', 'ungroup', 'annotate', 'morph',
    'lock', 'unlock', 'style', 'reorder',
    'snapshot', 'query',
  ]),
  author: authorInfoSchema,
  timestamp: z.number().int().nonnegative(),
  payload: operationPayloadSchema,
});
