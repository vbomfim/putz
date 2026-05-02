/**
 * ExpressionBuilder — fluent API for constructing VisualExpressions.
 *
 * Provides a chainable interface that makes it easy to build valid
 * protocol expressions without remembering every field. Each builder
 * method returns `this` for chaining; call `.build()` to produce
 * the final `VisualExpression`.
 *
 * @example
 * ```ts
 * const builder = new ExpressionBuilder(authorInfo);
 * const rect = builder.rectangle(10, 20, 300, 150).label("Hello").build();
 * ```
 *
 * @module
 */

import { nanoid } from "nanoid";
import type { AuthorInfo, ExpressionStyle } from "../schema/metadata";
import { DEFAULT_EXPRESSION_STYLE } from "../schema/metadata";
import type { VisualExpression, ExpressionData } from "../schema/expressions";
import type { FlowNode, FlowEdge, ReasoningStep } from "../schema/composites";

/**
 * Internal builder that accumulates properties and produces
 * a `VisualExpression` on `.build()`.
 */
class ExpressionDraft {
  private readonly id: string;
  private readonly author: AuthorInfo;
  private position = { x: 0, y: 0 };
  private size = { width: 100, height: 100 };
  private angle = 0;
  private expressionStyle: ExpressionStyle = { ...DEFAULT_EXPRESSION_STYLE };
  private tags: string[] = [];
  private locked = false;
  private parentId?: string;
  private children?: string[];
  private data: ExpressionData;

  constructor(author: AuthorInfo, data: ExpressionData) {
    this.id = nanoid();
    this.author = author;
    this.data = data;
  }

  /** Set canvas position and size from x, y, width, height. */
  setGeometry(x: number, y: number, width: number, height: number): this {
    this.position = { x, y };
    this.size = { width, height };
    return this;
  }

  /** Override the default style (merges with defaults). */
  setStyle(overrides: Partial<ExpressionStyle>): this {
    this.expressionStyle = { ...this.expressionStyle, ...overrides };
    return this;
  }

  /** Set rotation angle in degrees. */
  setAngle(degrees: number): this {
    this.angle = degrees;
    return this;
  }

  /** Add tags to the expression. */
  setTags(tags: string[]): this {
    this.tags = tags;
    return this;
  }

  /** Mark expression as locked. */
  setLocked(locked: boolean): this {
    this.locked = locked;
    return this;
  }

  /** Set parent expression ID. */
  setParentId(parentId: string): this {
    this.parentId = parentId;
    return this;
  }

  /** Set child expression IDs. */
  setChildren(children: string[]): this {
    this.children = children;
    return this;
  }

  /** Replace the data payload. */
  setData(data: ExpressionData): this {
    this.data = data;
    return this;
  }

  /** Build the final VisualExpression. */
  build(): VisualExpression {
    const now = Date.now();
    return {
      id: this.id,
      kind: this.data.kind,
      position: this.position,
      size: this.size,
      angle: this.angle,
      style: this.expressionStyle,
      meta: {
        author: this.author,
        createdAt: now,
        updatedAt: now,
        tags: this.tags,
        locked: this.locked,
      },
      parentId: this.parentId,
      children: this.children,
      data: this.data,
    };
  }
}

// ── Chainable sub-builders for specific expression kinds ───

/** Builder for primitive shapes (rectangle, ellipse, diamond). */
export class ShapeBuilder {
  private readonly draft: ExpressionDraft;
  private labelValue?: string;
  private readonly kind: "rectangle" | "ellipse" | "diamond";

  constructor(
    author: AuthorInfo,
    kind: "rectangle" | "ellipse" | "diamond",
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    this.kind = kind;
    this.draft = new ExpressionDraft(author, { kind, label: undefined });
    this.draft.setGeometry(x, y, width, height);
  }

  /** Set the shape label. */
  label(text: string): this {
    this.labelValue = text;
    return this;
  }

  /** Override visual style. */
  style(overrides: Partial<ExpressionStyle>): this {
    this.draft.setStyle(overrides);
    return this;
  }

  /** Set tags. */
  tags(tags: string[]): this {
    this.draft.setTags(tags);
    return this;
  }

  /** Build the VisualExpression. */
  build(): VisualExpression {
    this.draft.setData({ kind: this.kind, label: this.labelValue });
    return this.draft.build();
  }
}

/** Builder for flowchart expressions. */
export class FlowchartBuilder {
  private readonly draft: ExpressionDraft;
  private readonly title: string;
  private readonly nodes: FlowNode[] = [];
  private readonly edges: FlowEdge[] = [];
  private dir: "TB" | "LR" | "BT" | "RL" = "TB";

  constructor(author: AuthorInfo, title: string) {
    this.title = title;
    this.draft = new ExpressionDraft(author, {
      kind: "flowchart",
      title,
      nodes: [],
      edges: [],
      direction: "TB",
    });
  }

  /** Add a node to the flowchart. */
  node(id: string, label: string, shape: FlowNode["shape"] = "rect"): this {
    this.nodes.push({ id, label, shape });
    return this;
  }

  /** Add an edge between two nodes. */
  edge(from: string, to: string, label?: string): this {
    this.edges.push({ from, to, label });
    return this;
  }

  /** Set the layout direction. */
  direction(dir: "TB" | "LR" | "BT" | "RL"): this {
    this.dir = dir;
    return this;
  }

  /** Override visual style. */
  style(overrides: Partial<ExpressionStyle>): this {
    this.draft.setStyle(overrides);
    return this;
  }

  /** Build the VisualExpression. */
  build(): VisualExpression {
    this.draft.setData({
      kind: "flowchart",
      title: this.title,
      nodes: this.nodes,
      edges: this.edges,
      direction: this.dir,
    });
    return this.draft.build();
  }
}

/** Builder for reasoning chain expressions. */
export class ReasoningChainBuilder {
  private readonly draft: ExpressionDraft;
  private readonly question: string;
  private readonly steps: ReasoningStep[] = [];
  private finalAnswerValue = "";

  constructor(author: AuthorInfo, question: string) {
    this.question = question;
    this.draft = new ExpressionDraft(author, {
      kind: "reasoning-chain",
      question,
      steps: [],
      finalAnswer: "",
    });
  }

  /** Add a reasoning step. */
  step(title: string, content: string): this {
    this.steps.push({ title, content });
    return this;
  }

  /** Set the final answer / conclusion. */
  answer(text: string): this {
    this.finalAnswerValue = text;
    return this;
  }

  /** Override visual style. */
  style(overrides: Partial<ExpressionStyle>): this {
    this.draft.setStyle(overrides);
    return this;
  }

  /** Build the VisualExpression. */
  build(): VisualExpression {
    this.draft.setData({
      kind: "reasoning-chain",
      question: this.question,
      steps: this.steps,
      finalAnswer: this.finalAnswerValue,
    });
    return this.draft.build();
  }
}

/** Builder for text expressions. */
export class TextBuilder {
  private readonly draft: ExpressionDraft;
  private textValue: string;
  private fontSizeValue = 16;
  private fontFamilyValue = "sans-serif";
  private textAlignValue: "left" | "center" | "right" = "left";

  constructor(author: AuthorInfo, text: string, x: number, y: number) {
    this.textValue = text;
    this.draft = new ExpressionDraft(author, {
      kind: "text",
      text,
      fontSize: 16,
      fontFamily: "sans-serif",
      textAlign: "left",
    });
    this.draft.setGeometry(x, y, 200, 50);
  }

  /** Set font size. */
  fontSize(size: number): this {
    this.fontSizeValue = size;
    return this;
  }

  /** Set font family. */
  fontFamily(family: string): this {
    this.fontFamilyValue = family;
    return this;
  }

  /** Set text alignment. */
  align(alignment: "left" | "center" | "right"): this {
    this.textAlignValue = alignment;
    return this;
  }

  /** Override visual style. */
  style(overrides: Partial<ExpressionStyle>): this {
    this.draft.setStyle(overrides);
    return this;
  }

  /** Build the VisualExpression. */
  build(): VisualExpression {
    this.draft.setData({
      kind: "text",
      text: this.textValue,
      fontSize: this.fontSizeValue,
      fontFamily: this.fontFamilyValue,
      textAlign: this.textAlignValue,
    });
    return this.draft.build();
  }
}

/** Builder for sticky note expressions. */
export class StickyNoteBuilder {
  private readonly draft: ExpressionDraft;
  private textValue: string;
  private colorValue: string;

  constructor(author: AuthorInfo, text: string, color: string = "#FFEB3B") {
    this.textValue = text;
    this.colorValue = color;
    this.draft = new ExpressionDraft(author, {
      kind: "sticky-note",
      text,
      color,
    });
    this.draft.setGeometry(0, 0, 200, 200);
  }

  /** Set sticky note color. */
  color(c: string): this {
    this.colorValue = c;
    return this;
  }

  /** Override visual style. */
  style(overrides: Partial<ExpressionStyle>): this {
    this.draft.setStyle(overrides);
    return this;
  }

  /** Build the VisualExpression. */
  build(): VisualExpression {
    this.draft.setData({
      kind: "sticky-note",
      text: this.textValue,
      color: this.colorValue,
    });
    return this.draft.build();
  }
}

/**
 * Top-level builder for creating InfiniCanvas visual expressions.
 *
 * Each method returns a kind-specific chainable sub-builder.
 * Call `.build()` on the sub-builder to produce the final `VisualExpression`.
 */
export class ExpressionBuilder {
  private readonly author: AuthorInfo;

  constructor(author: AuthorInfo) {
    this.author = author;
  }

  /** Start building a rectangle expression. */
  rectangle(x: number, y: number, width: number, height: number): ShapeBuilder {
    return new ShapeBuilder(this.author, "rectangle", x, y, width, height);
  }

  /** Start building an ellipse expression. */
  ellipse(x: number, y: number, width: number, height: number): ShapeBuilder {
    return new ShapeBuilder(this.author, "ellipse", x, y, width, height);
  }

  /** Start building a diamond expression. */
  diamond(x: number, y: number, width: number, height: number): ShapeBuilder {
    return new ShapeBuilder(this.author, "diamond", x, y, width, height);
  }

  /** Start building a text expression. */
  text(text: string, x: number, y: number): TextBuilder {
    return new TextBuilder(this.author, text, x, y);
  }

  /** Start building a sticky note expression. */
  stickyNote(text: string, color?: string): StickyNoteBuilder {
    return new StickyNoteBuilder(this.author, text, color);
  }

  /** Start building a flowchart expression. */
  flowchart(title: string): FlowchartBuilder {
    return new FlowchartBuilder(this.author, title);
  }

  /** Start building a reasoning chain expression. */
  reasoningChain(question: string): ReasoningChainBuilder {
    return new ReasoningChainBuilder(this.author, question);
  }
}
