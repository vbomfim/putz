/**
 * Composite element data types for InfiniCanvas Protocol.
 *
 * Composites represent structured, multi-element visual expressions
 * such as flowcharts, wireframes, and reasoning chains.
 *
 * @module
 */

// ── Flowchart ──────────────────────────────────────────────

export interface FlowNode {
  id: string;
  label: string;
  shape: 'rect' | 'diamond' | 'ellipse' | 'parallelogram' | 'cylinder';
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
}

export interface FlowchartData {
  kind: 'flowchart';
  title: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  direction: 'TB' | 'LR' | 'BT' | 'RL';
}

// ── Sequence Diagram ───────────────────────────────────────

export interface Participant {
  id: string;
  name: string;
}

export interface Message {
  from: string;
  to: string;
  label: string;
  type: 'sync' | 'async' | 'reply';
}

export interface SequenceDiagramData {
  kind: 'sequence-diagram';
  title: string;
  participants: Participant[];
  messages: Message[];
}

// ── Wireframe ──────────────────────────────────────────────

export interface WireframeComponent {
  id: string;
  type: 'button' | 'input' | 'text' | 'image' | 'container' | 'nav' | 'list';
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WireframeData {
  kind: 'wireframe';
  title: string;
  screenSize: { width: number; height: number };
  components: WireframeComponent[];
}

// ── Reasoning Chain ────────────────────────────────────────

export interface ReasoningStep {
  title: string;
  content: string;
}

export interface ReasoningChainData {
  kind: 'reasoning-chain';
  question: string;
  steps: ReasoningStep[];
  finalAnswer: string;
}

// ── Roadmap ────────────────────────────────────────────────

export interface RoadmapItem {
  id: string;
  title: string;
  status: 'planned' | 'in-progress' | 'done';
}

export interface RoadmapPhase {
  id: string;
  name: string;
  items: RoadmapItem[];
}

export interface RoadmapData {
  kind: 'roadmap';
  title: string;
  orientation: 'horizontal' | 'vertical';
  phases: RoadmapPhase[];
}

// ── Mind Map ───────────────────────────────────────────────

export interface MindMapBranch {
  id: string;
  label: string;
  children: MindMapBranch[];
}

export interface MindMapData {
  kind: 'mind-map';
  centralTopic: string;
  branches: MindMapBranch[];
}

// ── Kanban ─────────────────────────────────────────────────

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
}

export interface KanbanColumn {
  id: string;
  title: string;
  cards: KanbanCard[];
}

export interface KanbanData {
  kind: 'kanban';
  title: string;
  columns: KanbanColumn[];
}

// ── Decision Tree ──────────────────────────────────────────

export interface DecisionOption {
  label: string;
  outcome?: string;
  children: DecisionOption[];
}

export interface DecisionTreeData {
  kind: 'decision-tree';
  question: string;
  options: DecisionOption[];
}

// ── Collaboration Diagram ──────────────────────────────────

export interface CollabObject {
  id: string;
  name: string;
  type: string;
}

export interface CollabLink {
  from: string;
  to: string;
  label: string;
  direction: 'unidirectional' | 'bidirectional';
}

export interface CollaborationDiagramData {
  kind: 'collaboration-diagram';
  title: string;
  objects: CollabObject[];
  links: CollabLink[];
}

// ── Simple Composites ──────────────────────────────────────

export interface SlideData {
  kind: 'slide';
  title: string;
  bullets: string[];
  layout: 'title' | 'bullets' | 'split';
}

export interface CodeBlockData {
  kind: 'code-block';
  language: string;
  code: string;
}

export interface TableData {
  kind: 'table';
  headers: string[];
  rows: string[][];
}

// ── Composite Union ────────────────────────────────────────

/** Union of all composite expression data types. */
export type CompositeData =
  | FlowchartData
  | SequenceDiagramData
  | WireframeData
  | ReasoningChainData
  | RoadmapData
  | MindMapData
  | KanbanData
  | DecisionTreeData
  | CollaborationDiagramData
  | SlideData
  | CodeBlockData
  | TableData;
