/**
 * Working tree overlay renderer.
 * [CLEAN-CODE][SRP] Owns the working tree status display only.
 * [SECURITY] All file paths and statuses are escaped before HTML insertion.
 */

import type { WorkingTreeStatus } from './types';
import { escapeHtml, sanitizeStatusClass } from './security';

/**
 * Render the working tree status overlay.
 *
 * @param wt         - Working tree status data (null/undefined hides the overlay).
 * @param overlayEl  - The overlay container element.
 * @param filesEl    - The collapsible file-detail element.
 */
export function renderWorkingTree(
  wt: WorkingTreeStatus | null | undefined,
  overlayEl: HTMLElement,
  filesEl: HTMLElement,
): void {
  if (!wt) {
    overlayEl.style.display = 'none';
    return;
  }

  const stagedCount = wt.staged ? wt.staged.length : 0;
  const unstagedCount = wt.unstaged ? wt.unstaged.length : 0;
  const untrackedCount = wt.untracked ? wt.untracked.length : 0;
  const total = stagedCount + unstagedCount + untrackedCount;

  if (total === 0) {
    overlayEl.className = 'working-tree-overlay clean';
    overlayEl.style.display = 'flex';
    overlayEl.innerHTML =
      '<span class="wt-label">Working Tree</span> ' +
      '<span>Clean \u2014 no uncommitted changes</span>';
    filesEl.classList.remove('visible');
    return;
  }

  overlayEl.className = 'working-tree-overlay';
  overlayEl.style.display = 'flex';

  const parts = ['<span class="wt-label">Working Tree</span>'];
  if (stagedCount > 0) {
    parts.push(
      '<span class="wt-badge staged">\u25CF <span class="count">' +
      stagedCount + '</span> staged</span>',
    );
  }
  if (unstagedCount > 0) {
    parts.push(
      '<span class="wt-badge unstaged">\u25CF <span class="count">' +
      unstagedCount + '</span> unstaged</span>',
    );
  }
  if (untrackedCount > 0) {
    parts.push(
      '<span class="wt-badge untracked">\u25CF <span class="count">' +
      untrackedCount + '</span> untracked</span>',
    );
  }
  parts.push('<button class="wt-toggle" id="wt-toggle-btn">details \u25BE</button>');
  overlayEl.innerHTML = parts.join('');

  // Build file detail sections
  const fileLines: string[] = [];
  if (stagedCount > 0) {
    fileLines.push('<div class="wt-detail"><strong>Staged:</strong><ul class="wt-detail-list">');
    wt.staged.forEach((f) => {
      fileLines.push(
        '<li><span class="status ' + sanitizeStatusClass(f.status) + '">' +
        escapeHtml(f.status) + '</span> ' + escapeHtml(f.path) + '</li>',
      );
    });
    fileLines.push('</ul></div>');
  }
  if (unstagedCount > 0) {
    fileLines.push('<div class="wt-detail"><strong>Unstaged:</strong><ul class="wt-detail-list">');
    wt.unstaged.forEach((f) => {
      fileLines.push(
        '<li><span class="status ' + sanitizeStatusClass(f.status) + '">' +
        escapeHtml(f.status) + '</span> ' + escapeHtml(f.path) + '</li>',
      );
    });
    fileLines.push('</ul></div>');
  }
  if (untrackedCount > 0) {
    fileLines.push('<div class="wt-detail"><strong>Untracked:</strong><ul class="wt-detail-list">');
    wt.untracked.forEach((p) => {
      fileLines.push('<li>' + escapeHtml(p) + '</li>');
    });
    fileLines.push('</ul></div>');
  }
  filesEl.innerHTML = fileLines.join('');

  // Wire up toggle button
  const toggleBtn = document.getElementById('wt-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', function (this: HTMLElement) {
      filesEl.classList.toggle('visible');
      this.textContent = filesEl.classList.contains('visible')
        ? 'details \u25B4'
        : 'details \u25BE';
    });
  }
}
