/**
 * Protocol operations for InfiniCanvas.
 *
 * Operations represent discrete changes to the canvas state.
 * They are the atomic units of collaboration — every mutation
 * is expressed as an operation with author, timestamp, and payload.
 *
 * @module
 */

import type { AuthorInfo, ExpressionStyle } from './metadata';
import type { ExpressionData, ExpressionKind } from './expressions';

/** All supported operation types. */
export type OperationType =
  | 'create'
  | 'update'
  | 'delete'
  | 'move'
  | 'transform'
  | 'group'
  | 'ungroup'
  | 'annotate'
  | 'morph'
  | 'lock'
  | 'unlock'
  | 'style'
  | 'reorder'
  | 'snapshot'
  | 'query';

// ── Operation Payloads ─────────────────────────────────────

export interface CreatePayload {
  type: 'create';
  expressionId: string;
  kind: ExpressionKind;
  position: { x: number; y: number };
  size: { width: number; height: number };
  data: ExpressionData;
  /** Optional style — consumers fall back to defaults when absent. */
  style?: ExpressionStyle;
  /** Optional rotation angle in degrees — defaults to 0 when absent. */
  angle?: number;
}

export interface UpdatePayload {
  type: 'update';
  expressionId: string;
  /** Changed fields — only includes fields that were actually modified. */
  changes: {
    position?: { x: number; y: number };
    size?: { width: number; height: number };
    angle?: number;
    style?: Partial<ExpressionStyle>;
    data?: ExpressionData;
  };
}

export interface DeletePayload {
  type: 'delete';
  expressionIds: string[];
}

export interface MovePayload {
  type: 'move';
  expressionId: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface TransformPayload {
  type: 'transform';
  expressionId: string;
  angle?: number;
  scale?: { x: number; y: number };
  size?: { width: number; height: number };
}

export interface GroupPayload {
  type: 'group';
  expressionIds: string[];
  groupId: string;
}

export interface UngroupPayload {
  type: 'ungroup';
  groupId: string;
}

export interface AnnotatePayload {
  type: 'annotate';
  targetExpressionId: string;
  annotationId: string;
  annotationKind: 'comment' | 'callout' | 'highlight' | 'marker';
}

export interface MorphPayload {
  type: 'morph';
  expressionId: string;
  fromKind: ExpressionKind;
  toKind: ExpressionKind;
  newData: ExpressionData;
}

export interface LockPayload {
  type: 'lock';
  expressionIds: string[];
}

export interface UnlockPayload {
  type: 'unlock';
  expressionIds: string[];
}

export interface StylePayload {
  type: 'style';
  expressionIds: string[];
  style: Partial<ExpressionStyle>;
}

export interface ReorderPayload {
  type: 'reorder';
  expressionId: string;
  /** New z-index or layer order position. */
  newIndex: number;
}

export interface SnapshotPayload {
  type: 'snapshot';
  /** Label for this snapshot. */
  label: string;
  /** IDs of expressions included in the snapshot (empty = all). */
  expressionIds: string[];
}

export interface QueryPayload {
  type: 'query';
  /** Filter kind. */
  kind?: ExpressionKind;
  /** Filter by tags. */
  tags?: string[];
  /** Bounding box filter. */
  bounds?: { x: number; y: number; width: number; height: number };
}

/** Discriminated union of all operation payloads. */
export type OperationPayload =
  | CreatePayload
  | UpdatePayload
  | DeletePayload
  | MovePayload
  | TransformPayload
  | GroupPayload
  | UngroupPayload
  | AnnotatePayload
  | MorphPayload
  | LockPayload
  | UnlockPayload
  | StylePayload
  | ReorderPayload
  | SnapshotPayload
  | QueryPayload;

/** A protocol operation — the atomic unit of canvas mutation. */
export interface ProtocolOperation {
  /** Unique identifier for this operation. */
  id: string;
  /** The type of operation. */
  type: OperationType;
  /** Who performed this operation. */
  author: AuthorInfo;
  /** Unix timestamp (ms) when the operation occurred. */
  timestamp: number;
  /** The operation-specific payload. */
  payload: OperationPayload;
}
