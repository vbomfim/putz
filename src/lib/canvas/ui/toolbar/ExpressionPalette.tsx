/**
 * ExpressionPalette — quick-insert panel for composite expressions.
 *
 * Provides a toggleable panel with template buttons for inserting
 * pre-built composite expressions (flowchart, mind map, kanban, etc.)
 * at the viewport center.
 *
 * Each template creates a valid VisualExpression with placeholder data
 * ready for editing.
 *
 * @module
 */

import { useState, useCallback } from "react";
import { nanoid } from "nanoid";
import {
  GitBranch,
  MessageSquare,
  BrainCircuit,
  Link2,
  Columns3,
  Table2,
  Map,
  Code2,
  Presentation,
  Plus,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  VisualExpression,
  ExpressionKind,
  ExpressionData,
} from "../../protocol";
import { DEFAULT_EXPRESSION_STYLE } from "../../protocol";

/** Props for ExpressionPalette. */
export interface ExpressionPaletteProps {
  /** Callback when a template expression is created. */
  onInsert: (expression: VisualExpression) => void;
}

/** Template definition for a composite expression type. */
interface ExpressionTemplate {
  kind: ExpressionKind;
  label: string;
  icon: LucideIcon;
  createData: () => ExpressionData;
  defaultSize: { width: number; height: number };
}

// ── Template factories ─────────────────────────────────────

/** All available expression templates. */
const TEMPLATES: ExpressionTemplate[] = [
  {
    kind: "flowchart",
    label: "Flowchart",
    icon: GitBranch,
    defaultSize: { width: 500, height: 400 },
    createData: () => ({
      kind: "flowchart" as const,
      title: "New Flowchart",
      nodes: [
        { id: nanoid(8), label: "Start", shape: "ellipse" as const },
        { id: nanoid(8), label: "Process", shape: "rect" as const },
        { id: nanoid(8), label: "Decision", shape: "diamond" as const },
        { id: nanoid(8), label: "End", shape: "ellipse" as const },
      ],
      edges: [],
      direction: "TB" as const,
    }),
  },
  {
    kind: "sequence-diagram",
    label: "Sequence Diagram",
    icon: MessageSquare,
    defaultSize: { width: 500, height: 400 },
    createData: () => {
      const p1 = nanoid(8);
      const p2 = nanoid(8);
      return {
        kind: "sequence-diagram" as const,
        title: "New Sequence Diagram",
        participants: [
          { id: p1, name: "Client" },
          { id: p2, name: "Server" },
        ],
        messages: [
          { from: p1, to: p2, label: "Request", type: "sync" as const },
          { from: p2, to: p1, label: "Response", type: "reply" as const },
        ],
      };
    },
  },
  {
    kind: "mind-map",
    label: "Mind Map",
    icon: BrainCircuit,
    defaultSize: { width: 600, height: 400 },
    createData: () => ({
      kind: "mind-map" as const,
      centralTopic: "Central Topic",
      branches: [
        {
          id: nanoid(8),
          label: "Branch 1",
          children: [
            { id: nanoid(8), label: "Sub-topic 1.1", children: [] },
            { id: nanoid(8), label: "Sub-topic 1.2", children: [] },
          ],
        },
        {
          id: nanoid(8),
          label: "Branch 2",
          children: [{ id: nanoid(8), label: "Sub-topic 2.1", children: [] }],
        },
      ],
    }),
  },
  {
    kind: "reasoning-chain",
    label: "Reasoning Chain",
    icon: Link2,
    defaultSize: { width: 400, height: 500 },
    createData: () => ({
      kind: "reasoning-chain" as const,
      question: "What is the question?",
      steps: [
        { title: "Step 1", content: "Analyze the problem..." },
        { title: "Step 2", content: "Consider alternatives..." },
        { title: "Step 3", content: "Evaluate trade-offs..." },
      ],
      finalAnswer: "The conclusion is...",
    }),
  },
  {
    kind: "kanban",
    label: "Kanban",
    icon: Columns3,
    defaultSize: { width: 600, height: 400 },
    createData: () => ({
      kind: "kanban" as const,
      title: "New Kanban Board",
      columns: [
        {
          id: nanoid(8),
          title: "To Do",
          cards: [
            { id: nanoid(8), title: "Task 1", description: "Description" },
            { id: nanoid(8), title: "Task 2", description: "Description" },
          ],
        },
        {
          id: nanoid(8),
          title: "In Progress",
          cards: [
            { id: nanoid(8), title: "Task 3", description: "Description" },
          ],
        },
        {
          id: nanoid(8),
          title: "Done",
          cards: [],
        },
      ],
    }),
  },
  {
    kind: "table",
    label: "Table",
    icon: Table2,
    defaultSize: { width: 400, height: 250 },
    createData: () => ({
      kind: "table" as const,
      headers: ["Column 1", "Column 2", "Column 3"],
      rows: [
        ["Row 1, Cell 1", "Row 1, Cell 2", "Row 1, Cell 3"],
        ["Row 2, Cell 1", "Row 2, Cell 2", "Row 2, Cell 3"],
      ],
    }),
  },
  {
    kind: "roadmap",
    label: "Roadmap",
    icon: Map,
    defaultSize: { width: 600, height: 300 },
    createData: () => ({
      kind: "roadmap" as const,
      title: "New Roadmap",
      orientation: "horizontal" as const,
      phases: [
        {
          id: nanoid(8),
          name: "Phase 1",
          items: [
            { id: nanoid(8), title: "Milestone 1", status: "planned" as const },
            { id: nanoid(8), title: "Milestone 2", status: "planned" as const },
          ],
        },
        {
          id: nanoid(8),
          name: "Phase 2",
          items: [
            { id: nanoid(8), title: "Milestone 3", status: "planned" as const },
          ],
        },
      ],
    }),
  },
  {
    kind: "code-block",
    label: "Code Block",
    icon: Code2,
    defaultSize: { width: 400, height: 250 },
    createData: () => ({
      kind: "code-block" as const,
      language: "typescript",
      code: '// Write your code here\nfunction hello(): void {\n  console.log("Hello, world!");\n}\n',
    }),
  },
  {
    kind: "slide",
    label: "Slide",
    icon: Presentation,
    defaultSize: { width: 500, height: 350 },
    createData: () => ({
      kind: "slide" as const,
      title: "Slide Title",
      bullets: ["Point 1", "Point 2", "Point 3"],
      layout: "bullets" as const,
    }),
  },
];

/** Icon size for template buttons. */
const ICON_SIZE = 16;

/** Button size for template buttons. */
const BUTTON_HEIGHT = 32;

/**
 * Creates a full VisualExpression from a template.
 *
 * Generates a unique ID, positions at canvas center (0,0), and
 * applies default styling.
 */
function createExpressionFromTemplate(
  template: ExpressionTemplate,
): VisualExpression {
  return {
    id: nanoid(),
    kind: template.kind,
    position: { x: 0, y: 0 },
    size: template.defaultSize,
    angle: 0,
    style: { ...DEFAULT_EXPRESSION_STYLE },
    meta: {
      author: { type: "human", id: "local-user", name: "User" },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      locked: false,
    },
    data: template.createData(),
  };
}

/**
 * ExpressionPalette — toggleable panel for inserting composite expressions.
 *
 * Renders a "+" toggle button below the main toolbar. When expanded,
 * shows a vertical list of composite expression templates.
 */
export function ExpressionPalette({ onInsert }: ExpressionPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleInsert = useCallback(
    (template: ExpressionTemplate) => {
      const expression = createExpressionFromTemplate(template);
      onInsert(expression);
    },
    [onInsert],
  );

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 16,
        zIndex: 20,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Toggle button */}
      <button
        type="button"
        aria-label="Insert expression"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          border: "none",
          borderRadius: 10,
          cursor: "pointer",
          backgroundColor: isOpen ? "#4A90D9" : "#ffffff",
          color: isOpen ? "#ffffff" : "#333333",
          boxShadow: "0 2px 8px rgba(0, 0, 0, 0.12)",
          transition: "background-color 0.15s, color 0.15s, transform 0.15s",
          transform: isOpen ? "rotate(45deg)" : "rotate(0deg)",
        }}
      >
        <Plus size={20} />
      </button>

      {/* Palette panel */}
      {isOpen && (
        <div
          data-testid="palette-panel"
          role="toolbar"
          aria-label="Expression templates"
          style={{
            position: "absolute",
            bottom: 44,
            left: 0,
            backgroundColor: "#ffffff",
            borderRadius: 10,
            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.15)",
            border: "1px solid #e0e0e0",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 2,
            minWidth: 180,
          }}
        >
          {TEMPLATES.map((template) => {
            const Icon = template.icon;
            return (
              <button
                key={template.kind}
                type="button"
                aria-label={`Insert ${template.label}`}
                onClick={() => handleInsert(template)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  height: BUTTON_HEIGHT,
                  padding: "0 10px",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  backgroundColor: "transparent",
                  color: "#333",
                  fontSize: 13,
                  textAlign: "left",
                  fontFamily: "inherit",
                  transition: "background-color 0.1s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "#f0f4ff";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.backgroundColor =
                    "transparent";
                }}
              >
                <Icon size={ICON_SIZE} />
                <span>{template.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
