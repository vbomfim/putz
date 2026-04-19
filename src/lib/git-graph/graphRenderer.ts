/**
 * Graph rendering logic for the webview — SVG graph gutter synced with commit rows.
 * [PERFORMANCE] Uses precomputed lookup maps for O(1) access patterns.
 * [SECURITY] All user-controlled strings are escaped before HTML insertion.
 * [CLEAN-CODE][SRP] Owns graph visualisation only — no message handling or state.
 *
 * Phase 2: Full SVG overlay replaces the Phase 1 Unicode pipe rendering.
 * The SVG draws circles for nodes, lines for edges, and bezier curves for
 * merge edges inside a dedicated gutter column. Commit metadata is rendered in
 * a separate content column, with gutter hit areas preserving row interactions.
 */

import type { GraphData, GraphEdge } from './types';
import { escapeHtml, escapeAttr } from './security';

/** Width of each graph lane column in pixels. */
const LANE_WIDTH = 24;
/** Height of each commit row in pixels — must match CSS .commit-row height. */
const ROW_HEIGHT = 30;
/** Radius of normal node circles. */
const NODE_RADIUS = 5;
/** Radius of HEAD node circle. */
const HEAD_RADIUS = 6;
/** Radius of merge node squares (half side length). */
const MERGE_RADIUS = 5;
/** Maximum stroke width used on any SVG element (nodes or edges). */
const MAX_STROKE_WIDTH = 3;
/** Extra width reserved for branch labels in the gutter. */
const LABEL_AREA_WIDTH = 180;
/** Font size for lane labels. */
const LABEL_FONT_SIZE = 11;
/** Maximum characters before truncating a lane label. */
const LABEL_MAX_CHARS = 22;
/** SVG namespace. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Guard the renderer against malformed runtime payloads. */
function isFiniteColumn(column: number): boolean {
  return Number.isFinite(column);
}

/**
 * Compute the pixel width of the graph gutter from actual node/edge geometry.
 * [CLEAN-CODE][SRP] Centralises gutter sizing so the SVG width, clip wrapper,
 * gutter hit areas, and row/content column boundary always agree.
 *
 * Defensively scans all node and edge columns rather than trusting
 * `graph.columns` alone — if the extension reports an off-by-one column count,
 * the geometry would otherwise extend past the gutter boundary and bleed into
 * the commit text area.
 *
 * The returned width accounts for node radii and stroke widths at the boundary:
 *   rightmost lane center = maxCol × LANE_WIDTH + LANE_WIDTH/2
 *   rightmost painted pixel = center + HEAD_RADIUS + MAX_STROKE_WIDTH/2
 *   gutter = ceil(rightmost painted pixel) to ensure integer-pixel alignment.
 */
export function computeGutterWidth(graph: GraphData): number {
  let maxCol = 0;
  let hasLabels = false;
  for (const node of graph.nodes) {
    if (isFiniteColumn(node.column) && node.column > maxCol) maxCol = node.column;
    if (node.branches.length > 0 || node.tags.length > 0) hasLabels = true;
  }
  for (const edge of graph.edges) {
    if (isFiniteColumn(edge.column) && edge.column > maxCol) maxCol = edge.column;
  }
  // [ROBUSTNESS] Treat non-finite/negative reported counts as absent so stale
  // extension/webview payloads cannot poison the shared gutter contract with NaN.
  const reportedColumns = Number.isFinite(graph.columns) && graph.columns > 0
    ? Math.floor(graph.columns)
    : 0;
  // Ensure we cover at least as many columns as graph.columns claims
  const effectiveColumns = Math.max(maxCol + 1, reportedColumns);
  // Rightmost painted pixel: center of last lane + largest radius + half stroke
  const rightmostCenter = (effectiveColumns - 1) * LANE_WIDTH + LANE_WIDTH / 2;
  const rightmostExtent = rightmostCenter + HEAD_RADIUS + MAX_STROKE_WIDTH / 2;
  // Use full lane grid when it already covers the geometry (typical case),
  // otherwise expand to cover the actual extent.
  const laneWidth = Math.max(effectiveColumns * LANE_WIDTH, Math.ceil(rightmostExtent));
  // Reserve extra space for branch/tag labels when refs exist.
  return hasLabels ? laneWidth + LABEL_AREA_WIDTH : laneWidth;
}

/**
 * Build an edge lookup map indexed by column for O(1) per-column access.
 * [PERFORMANCE] Precomputed indices avoid repeated linear scans.
 */
export function buildEdgeLookup(
  edges: readonly GraphEdge[],
  hashToIndex: Record<string, number>,
): Record<number, Array<{ edge: GraphEdge; fromIdx: number; toIdx: number }>> {
  const columnEdges: Record<number, Array<{ edge: GraphEdge; fromIdx: number; toIdx: number }>> = {};
  for (const edge of edges) {
    if (!isFiniteColumn(edge.column)) continue;
    if (!columnEdges[edge.column]) {
      columnEdges[edge.column] = [];
    }
    columnEdges[edge.column].push({
      edge,
      fromIdx: hashToIndex[edge.fromHash] ?? -1,
      toIdx: hashToIndex[edge.toHash] ?? -1,
    });
  }
  return columnEdges;
}

/**
 * Build SVG elements for the graph overlay.
 * Returns an SVG element with edges and nodes drawn at precise pixel positions.
 *
 * @param graph - Graph data from the extension.
 * @param hashToIndex - Precomputed hash → row index map.
 */
export function buildSvgOverlay(
  graph: GraphData,
  hashToIndex: Record<string, number>,
): SVGSVGElement {
  const svgWidth = computeGutterWidth(graph);
  const svgHeight = graph.nodes.length * ROW_HEIGHT;

  // Detect high contrast theme for stronger SVG visuals
  const isHighContrast = document.body.classList.contains('vscode-high-contrast')
    || document.body.classList.contains('vscode-high-contrast-light');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'graph-svg-overlay');
  svg.setAttribute('width', String(svgWidth));
  svg.setAttribute('height', String(svgHeight));
  svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  svg.setAttribute('aria-hidden', 'true');
  // [FIX] SVG 2 defaults overflow to 'visible' — explicitly clip to prevent
  // lane lines and node circles from bleeding into the commit-text area.
  // Belt-and-suspenders: set both SVG attribute and CSS property because some
  // webview renderers only honour one of the two.
  svg.setAttribute('overflow', 'hidden');
  svg.style.overflow = 'hidden';
  svg.style.width = `${svgWidth}px`;
  svg.style.maxWidth = `${svgWidth}px`;

  // Draw edges first (behind nodes)
  const edgeLookup = buildEdgeLookup(graph.edges, hashToIndex);

  // Compute rightmost lane center for label positioning
  let maxLaneCol = 0;
  for (const node of graph.nodes) {
    if (isFiniteColumn(node.column) && node.column > maxLaneCol) maxLaneCol = node.column;
  }
  const maxLaneX = colToX(maxLaneCol);

  for (const column of Object.keys(edgeLookup)) {
    const col = Number(column);
    const edgesInCol = edgeLookup[col];
    if (!edgesInCol) continue;

    for (const entry of edgesInCol) {
      if (entry.fromIdx < 0 || entry.toIdx < 0) continue;

      const fromNode = graph.nodes[entry.fromIdx];
      const toNode = graph.nodes[entry.toIdx];
      if (!fromNode || !toNode) continue;
      if (!isFiniteColumn(fromNode.column) || !isFiniteColumn(col)) continue;

      const fromX = colToX(fromNode.column);
      const fromY = rowToY(entry.fromIdx);
      const toX = colToX(col);
      const toY = rowToY(entry.toIdx);

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', entry.edge.color);
      path.setAttribute('stroke-width', isHighContrast ? '3' : '2');

      if (fromX === toX) {
        // Straight vertical line
        path.setAttribute('d', `M ${fromX} ${fromY} L ${toX} ${toY}`);
      } else {
        // Bezier curve for merge/fork edges
        const midY = (fromY + toY) / 2;
        path.setAttribute('d',
          `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`);
      }

      if (entry.edge.isMergeEdge) {
        path.setAttribute('stroke-dasharray', '4 2');
        path.setAttribute('opacity', '0.7');
      }

      svg.appendChild(path);
    }
  }

  // Draw nodes on top of edges, with tooltips
  // Track label positions for local↔remote link lines
  const branchLabelPositions = new Map<string, { x: number; y: number; color: string }>();
  for (let ni = 0; ni < graph.nodes.length; ni++) {
    const node = graph.nodes[ni];
    if (!isFiniteColumn(node.column)) continue;
    const cx = colToX(node.column);
    const cy = rowToY(ni);

    // Build tooltip text: branch/tag names + commit subject
    const tipParts: string[] = [];
    for (const b of node.branches) tipParts.push(b.isRemote ? `⛅ ${b.name}` : `⎇ ${b.name}`);
    for (const t of node.tags) tipParts.push(`🏷 ${t}`);
    tipParts.push(node.commit.subject);
    const tooltipText = tipParts.join('\n');

    // Node fill: solid in high contrast, semi-transparent normally
    const nodeFill = isHighContrast ? node.color : node.color + '40';
    const edgeWidth = isHighContrast ? '3' : '2';
    const headWidth = isHighContrast ? '4' : '3';

    if (node.isMerge) {
      // Merge node: diamond shape
      const diamond = document.createElementNS(SVG_NS, 'polygon');
      const r = MERGE_RADIUS;
      diamond.setAttribute('points',
        `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`);
      diamond.setAttribute('fill', nodeFill);
      diamond.setAttribute('stroke', node.color);
      diamond.setAttribute('stroke-width', edgeWidth);
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = tooltipText;
      diamond.appendChild(title);
      svg.appendChild(diamond);
    } else {
      // Regular node: circle
      const circle = document.createElementNS(SVG_NS, 'circle');
      const r = node.isHead ? HEAD_RADIUS : NODE_RADIUS;
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', String(r));
      circle.setAttribute('fill', nodeFill);
      circle.setAttribute('stroke', node.color);
      circle.setAttribute('stroke-width', node.isHead ? headWidth : edgeWidth);
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = tooltipText;
      circle.appendChild(title);
      svg.appendChild(circle);
    }

    // Draw branch/tag label flag next to nodes with refs
    if (node.branches.length > 0 || node.tags.length > 0) {
      const branchSync = graph.branchSync ?? {};
      const branch = node.branches.length > 0 ? node.branches[0] : null;
      const rawLabel = branch ? branch.name : node.tags[0];
      const isRemoteLabel = branch ? branch.isRemote : false;
      const isCurrentBranch = node.isHead && branch && !branch.isRemote;

      // Build display text with sync indicators
      let displayLabel = rawLabel.length > LABEL_MAX_CHARS
        ? rawLabel.slice(0, LABEL_MAX_CHARS - 1) + '…'
        : rawLabel;

      // Add sync suffix for local branches
      if (branch && !branch.isRemote) {
        const sync = branchSync[branch.name];
        if (sync) {
          if (sync.ahead > 0 && sync.behind > 0) displayLabel += ` ↑${sync.ahead}↓${sync.behind}`;
          else if (sync.ahead > 0) displayLabel += ` ↑${sync.ahead}`;
          else if (sync.behind > 0) displayLabel += ` ↓${sync.behind}`;
          else displayLabel += ' ✓';
        }
      }
      if (isCurrentBranch) displayLabel += ' ★';

      // Mark worktree branches with robot icon
      const worktrees = graph.worktrees ?? {};
      const isWorktree = branch && !branch.isRemote && worktrees[branch.name];
      if (isWorktree) displayLabel = '🤖 ' + displayLabel;

      // Position label to the right of the rightmost lane
      const labelX = maxLaneX + HEAD_RADIUS + MAX_STROKE_WIDTH + 24;
      const labelY = cy;

      // Track label position for local↔remote link lines
      for (const b of node.branches) {
        branchLabelPositions.set(b.name, { x: labelX, y: labelY, color: node.color });
      }

      // Approximate text width (~6.6px per char at 11px font)
      const textWidth = displayLabel.length * 6.6 + 10;
      const pillHeight = 18;

      // Background pill — dashed border for remote, thicker for current branch
      const pill = document.createElementNS(SVG_NS, 'rect');
      pill.setAttribute('x', String(labelX));
      pill.setAttribute('y', String(labelY - pillHeight / 2));
      pill.setAttribute('width', String(textWidth));
      pill.setAttribute('height', String(pillHeight));
      pill.setAttribute('rx', '4');
      pill.setAttribute('fill', node.color + '30');
      if (isCurrentBranch) {
        pill.setAttribute('stroke', '#007acc');
        pill.setAttribute('stroke-width', '1.5');
      } else if (isRemoteLabel) {
        pill.setAttribute('stroke', node.color);
        pill.setAttribute('stroke-width', '1');
        pill.setAttribute('stroke-dasharray', '3 2');
        pill.setAttribute('opacity', '0.8');
      } else {
        pill.setAttribute('stroke', node.color);
        pill.setAttribute('stroke-width', '1');
      }
      svg.appendChild(pill);

      // Label text
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', String(labelX + 5));
      text.setAttribute('y', String(labelY));
      text.setAttribute('font-size', String(LABEL_FONT_SIZE));
      text.setAttribute('fill', node.color);
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('font-family', 'var(--vscode-editor-font-family, monospace)');
      if (isCurrentBranch) text.setAttribute('font-weight', '700');
      text.textContent = displayLabel;
      svg.appendChild(text);
    }
  }

  // Draw elbow link lines between local and remote branch label pairs.
  // Each pair gets a unique X offset to avoid overlapping lines.
  const branchSync = graph.branchSync ?? {};
  const syncPairs: Array<{
    localPos: { x: number; y: number; color: string };
    remotePos: { x: number; y: number; color: string };
  }> = [];
  for (const [localName, sync] of Object.entries(branchSync)) {
    const localPos = branchLabelPositions.get(localName);
    const remotePos = branchLabelPositions.get(sync.remote);
    if (!localPos || !remotePos) continue;
    // Skip link when both branches are on the same commit (same row) —
    // the labels are already side by side, no elbow needed.
    if (localPos.y === remotePos.y) continue;
    syncPairs.push({ localPos, remotePos });
  }

  // Stagger X offsets so lines don't overlap (each pair gets 4px more offset)
  // Route elbows to the LEFT of labels (between lanes and label area).
  const LINK_BASE_OFFSET = 4;
  const LINK_STEP = 4;
  for (let pi = 0; pi < syncPairs.length; pi++) {
    const { localPos, remotePos } = syncPairs[pi];
    const color = localPos.color;
    const strokeWidth = isHighContrast ? '2' : '1';
    const opacity = isHighContrast ? '1' : '0.7';

    // Determine top/bottom positions
    const topPos = localPos.y <= remotePos.y ? localPos : remotePos;
    const bottomPos = localPos.y <= remotePos.y ? remotePos : localPos;
    const topY = topPos.y;
    const bottomY = bottomPos.y;

    // Elbow X is to the LEFT of labels, staggered inward from label edge
    const linkX = localPos.x - LINK_BASE_OFFSET - pi * LINK_STEP;

    // 90° elbow path: horizontal left from top label → vertical down → horizontal right to bottom label
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d',
      `M ${topPos.x} ${topY}` +          // start at top label left edge
      ` H ${linkX}` +                     // horizontal left to elbow column
      ` V ${bottomY}` +                   // vertical down
      ` H ${bottomPos.x}`                // horizontal right to bottom label
    );
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', strokeWidth);
    path.setAttribute('stroke-dasharray', '3 2');
    path.setAttribute('opacity', opacity);
    svg.appendChild(path);

    // Small dots at each endpoint
    for (const pos of [localPos, remotePos]) {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', String(pos.x));
      dot.setAttribute('cy', String(pos.y));
      dot.setAttribute('r', '2');
      dot.setAttribute('fill', color);
      dot.setAttribute('opacity', opacity);
      svg.appendChild(dot);
    }
  }

  return svg;
}

/** Build transparent gutter hit areas aligned one-to-one with commit rows. */
function buildGutterHitAreas(graph: GraphData): string {
  const hitAreas: string[] = [];
  for (const node of graph.nodes) {
    // Build tooltip for hover: branch/tag names + subject
    const tipParts: string[] = [];
    for (const b of node.branches) tipParts.push(b.isRemote ? '⛅ ' + b.name : '⎇ ' + b.name);
    for (const t of node.tags) tipParts.push('🏷 ' + t);
    tipParts.push(node.commit.subject);
    const tooltip = escapeAttr(tipParts.join('\n'));

    hitAreas.push(
      '<div class="graph-gutter-hit-area" data-hash="' +
      escapeAttr(node.commit.hash) +
      '" title="' + tooltip +
      '"></div>',
    );
  }
  return hitAreas.join('');
}

/**
 * Attach selection/context-menu interactions to every clickable commit surface.
 * Both the gutter hit area and the content row map to the same commit hash.
 */
function attachCommitInteractions(
  container: HTMLElement,
  onCommitClick: (hash: string) => void,
  onCommitContextMenu?: (hash: string, x: number, y: number) => void,
): void {
  container.querySelectorAll('.commit-row, .graph-gutter-hit-area').forEach((target) => {
    const hash = target.getAttribute('data-hash');
    if (!hash) return;

    target.addEventListener('click', () => onCommitClick(hash));
    if (onCommitContextMenu) {
      target.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const mouseEvent = e as MouseEvent;
        onCommitContextMenu(hash, mouseEvent.clientX, mouseEvent.clientY);
      });
    }
  });
}

/** Convert a column index to an X pixel coordinate (center of lane). */
function colToX(column: number): number {
  return column * LANE_WIDTH + LANE_WIDTH / 2;
}

/** Convert a row index to a Y pixel coordinate (center of row). */
function rowToY(rowIndex: number): number {
  return rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
}

/**
 * Render the commit graph into the container element.
 * Uses SVG overlay for the graph lanes and HTML for commit info rows.
 *
 * @param graph   - Graph data from the extension (nodes, edges, columns).
 * @param container - DOM element to render into.
 * @param onCommitClick - Callback when any commit surface is clicked.
 * @param onCommitContextMenu - Optional callback for right-click on a commit surface.
 */
export function renderGraph(
  graph: GraphData,
  container: HTMLElement,
  onCommitClick: (hash: string) => void,
  onCommitContextMenu?: (hash: string, x: number, y: number) => void,
): void {
  if (!graph || !graph.nodes || graph.nodes.length === 0) {
    container.innerHTML = '<div class="empty-state">No commits found.</div>';
    return;
  }

  // [PERFORMANCE] Precompute hash → index map for O(1) lookups
  const hashToIndex: Record<string, number> = {};
  for (let i = 0; i < graph.nodes.length; i++) {
    hashToIndex[graph.nodes[i].commit.hash] = i;
  }

  // Calculate gutter width from actual geometry [FIX: graph-gutter-bleed-v2]
  const gutterWidth = computeGutterWidth(graph);
  const gutterWidthStyle = `${gutterWidth}px`;

  // Build SVG overlay
  const svg = buildSvgOverlay(graph, hashToIndex);
  const gutterHitAreas = buildGutterHitAreas(graph);

  // Propagate branch names so every commit row has a branch badge.
  // Strategy: map lane columns to branch names from nodes that have refs,
  // then assign the branch name to all nodes in the same column.
  // This works because the graph builder assigns each branch its own column.
  const commitBranch = new Map<string, { name: string; isRemote: boolean }>();
  const columnBranch = new Map<number, { name: string; isRemote: boolean }>();

  // First: build column → branch map from nodes with refs
  for (const node of graph.nodes) {
    if (node.branches.length > 0 && !columnBranch.has(node.column)) {
      columnBranch.set(node.column, node.branches[0]);
    }
  }

  // Second: assign branch to every node via its column
  for (const node of graph.nodes) {
    if (node.branches.length > 0) {
      commitBranch.set(node.commit.hash, node.branches[0]);
    } else {
      const fromColumn = columnBranch.get(node.column);
      if (fromColumn) {
        commitBranch.set(node.commit.hash, fromColumn);
      }
    }
  }

  // Build HTML rows
  const html: string[] = [];

  for (let ni = 0; ni < graph.nodes.length; ni++) {
    const node = graph.nodes[ni];

    const badges: string[] = [];
    // Always include branch badges in rows. In graph mode they're hidden via CSS
    // (.graph-viewport .inline-branch-badge { display: none }). In filtered/search
    // mode the gutter is gone so they become visible.
    if (node.branches.length > 0) {
      for (const branch of node.branches) {
        const badgeClass = branch.isRemote ? 'branch-badge remote-badge inline-branch-badge' : 'branch-badge inline-branch-badge';
        badges.push(
          '<span class="' + badgeClass + '" data-branch-name="' + escapeAttr(branch.name) +
          '" data-branch-remote="' + (branch.isRemote ? 'true' : 'false') + '">' +
          escapeHtml(branch.name) + '</span>',
        );
      }
    } else {
      // No direct branch ref — use propagated branch name
      const inherited = commitBranch.get(node.commit.hash);
      if (inherited) {
        const badgeClass = inherited.isRemote
          ? 'branch-badge remote-badge inline-branch-badge'
          : 'branch-badge inline-branch-badge';
        badges.push(
          '<span class="' + badgeClass + '" data-branch-name="' + escapeAttr(inherited.name) +
          '" data-branch-remote="' + (inherited.isRemote ? 'true' : 'false') + '">' +
          escapeHtml(inherited.name) + '</span>',
        );
      }
    }
    for (const tag of node.tags) {
      badges.push('<span class="tag-badge" data-tag-name="' + escapeAttr(tag) + '">' + escapeHtml(tag) + '</span>');
    }

    // Build data attribute for branch context menu (works even when badges are hidden)
    const branchSync = graph.branchSync ?? {};
    const worktrees = graph.worktrees ?? {};
    let branchDataAttr = '';
    if (node.branches.length > 0) {
      const b = node.branches[0];
      const sync = !b.isRemote ? branchSync[b.name] : undefined;
      const wtPath = !b.isRemote ? worktrees[b.name] : undefined;
      branchDataAttr = '" data-branch-name="' + escapeAttr(b.name) +
        '" data-branch-remote="' + (b.isRemote ? 'true' : 'false') +
        (sync ? '" data-sync-ahead="' + sync.ahead + '" data-sync-behind="' + sync.behind : '') +
        (wtPath ? '" data-worktree-path="' + escapeAttr(wtPath) : '');
    }

    html.push(
      '<div class="commit-row" data-hash="' + escapeAttr(node.commit.hash) +
      (node.isHead ? '" data-head="true' : '') +
      branchDataAttr + '">' +
      '<div class="commit-info">' +
      '<span class="commit-hash">' + escapeHtml(node.commit.abbreviatedHash) + '</span>' +
      badges.join('') +
      '<span class="commit-subject">' + escapeHtml(node.commit.subject) + '</span>' +
      '<span class="commit-author">' + escapeHtml(node.commit.authorName) + '</span>' +
      '</div></div>',
    );
  }

  // When file-filtering, show a clean flat list without the graph gutter
  if (graph.filtered) {
    container.innerHTML =
      '<div class="graph-filtered-list">' +
      '<div class="graph-rows">' + html.join('') + '</div>' +
      '</div>';

    attachCommitInteractions(container, onCommitClick, onCommitContextMenu);
    return;
  }

  // Assemble: graph-viewport with dedicated gutter/content columns.
  // [FIX: graph-left-overlap] The viewport owns one shared gutter width
  // contract consumed by the SVG clip wrapper, gutter hit areas, and the
  // content column boundary. That separates graph lanes from the hash/label
  // region structurally without sacrificing click/context-menu reachability.
  //
  // [FIX: csp-inline-styles] All dynamic sizing is applied via CSSOM
  // (element.style.*) rather than inline style="" attributes in the HTML
  // string. VS Code webviews enforce CSP style-src without 'unsafe-inline',
  // so the browser silently strips inline style attributes — causing the
  // gutter width to fall back to the CSS default of 0px.
  container.innerHTML =
    '<div class="graph-viewport">' +
    '<div class="graph-gutter-clip">' +
    '<div class="graph-gutter-hit-areas">' + gutterHitAreas + '</div>' +
    '</div>' +
    '<div class="graph-rows">' + html.join('') + '</div>' +
    '</div>';

  // Apply gutter sizing via CSSOM (CSP-safe).
  const viewport = container.querySelector('.graph-viewport') as HTMLElement | null;
  const gutterClip = container.querySelector('.graph-gutter-clip') as HTMLElement | null;
  if (viewport) {
    viewport.style.setProperty('--graph-gutter-width', gutterWidthStyle);
    viewport.style.gridTemplateColumns = gutterWidthStyle + ' minmax(0, 1fr)';
  }
  if (gutterClip) {
    gutterClip.style.width = gutterWidthStyle;
    gutterClip.style.minWidth = gutterWidthStyle;
    // Insert SVG behind the transparent hit areas.
    gutterClip.prepend(svg);
  }

  attachCommitInteractions(container, onCommitClick, onCommitContextMenu);

  // Wire pull buttons for branches that are behind their remote
  container.querySelectorAll('.sync-pull-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Don't trigger commit row click
    });
  });
}

/**
 * Highlight a commit row by hash and deselect all others.
 */
export function highlightCommit(
  hash: string,
  container: HTMLElement,
): void {
  container.querySelectorAll('.commit-row, .graph-gutter-hit-area').forEach((target) => {
    target.classList.toggle('selected', target.getAttribute('data-hash') === hash);
  });
}

// Re-export constants for testing
export { LANE_WIDTH, ROW_HEIGHT, NODE_RADIUS, HEAD_RADIUS, MERGE_RADIUS, MAX_STROKE_WIDTH, LABEL_AREA_WIDTH };
