/**
 * Commit detail panel — right-side split panel showing full commit info.
 * [CLEAN-CODE][SRP] Owns the detail panel rendering only.
 * [SECURITY] All user-controlled strings are escaped before HTML insertion.
 */

import type { CommitDetail } from "./types";
import { escapeHtml, escapeAttr, sanitizeStatusClass } from "./security";

/** Callbacks for commit detail panel interactions. */
export interface CommitDetailCallbacks {
  onSelectCommit: (hash: string) => void;
  onOpenFileDiff: (hash: string, filePath: string) => void;
}

/**
 * Render the commit detail panel with full commit information.
 *
 * @param panelEl    - The detail panel container element.
 * @param detail     - Commit detail data.
 * @param callbacks  - Callback handlers for user interactions.
 */
export function renderCommitDetail(
  panelEl: HTMLElement,
  detail: CommitDetail,
  callbacks: CommitDetailCallbacks,
): void {
  const html: string[] = [];

  // Header with close button
  html.push(
    '<div class="detail-header">' +
      '<h3 class="detail-title">Commit Detail</h3>' +
      '<button class="detail-close" id="detail-close-btn" title="Close">\u2715</button>' +
      "</div>",
  );

  // Commit identity
  html.push(
    '<div class="detail-section detail-identity">' +
      '<div class="detail-hash" title="' +
      escapeAttr(detail.hash) +
      '">' +
      escapeHtml(detail.abbreviatedHash) +
      "</div>" +
      '<div class="detail-subject">' +
      escapeHtml(detail.subject) +
      "</div>" +
      "</div>",
  );

  // Author info
  const dateStr = formatDate(detail.authorDate);
  html.push(
    '<div class="detail-section detail-meta">' +
      '<div class="detail-author">' +
      '<span class="detail-label">Author:</span> ' +
      escapeHtml(detail.authorName) +
      ' <span class="detail-email">&lt;' +
      escapeHtml(detail.authorEmail) +
      "&gt;</span>" +
      "</div>" +
      '<div class="detail-date">' +
      '<span class="detail-label">Date:</span> ' +
      escapeHtml(dateStr) +
      "</div>" +
      "</div>",
  );

  // Parent hashes
  if (detail.parentHashes.length > 0) {
    const parentLinks = detail.parentHashes
      .map(
        (h) =>
          '<span class="detail-parent-hash" data-hash="' +
          escapeAttr(h) +
          '">' +
          escapeHtml(h.slice(0, 7)) +
          "</span>",
      )
      .join(", ");
    html.push(
      '<div class="detail-section detail-parents">' +
        '<span class="detail-label">Parent' +
        (detail.parentHashes.length > 1 ? "s" : "") +
        ":</span> " +
        parentLinks +
        "</div>",
    );
  }

  // Body (full commit message)
  if (detail.body && detail.body.trim()) {
    html.push(
      '<div class="detail-section detail-body">' +
        '<pre class="detail-body-text">' +
        escapeHtml(detail.body.trim()) +
        "</pre>" +
        "</div>",
    );
  }

  // Changed files
  const files = detail.files || [];
  html.push(
    '<div class="detail-section detail-files">' +
      '<div class="detail-files-header">' +
      '<span class="detail-label">Files changed</span>' +
      '<span class="detail-files-count">' +
      files.length +
      "</span>" +
      "</div>",
  );

  if (files.length === 0) {
    html.push('<div class="detail-files-empty">No files changed</div>');
  } else {
    html.push('<ul class="detail-files-list">');
    for (const file of files) {
      html.push(
        '<li class="detail-file-item" data-path="' +
          escapeAttr(file.path) +
          '" ' +
          'data-hash="' +
          escapeAttr(detail.hash) +
          '">' +
          '<span class="status ' +
          sanitizeStatusClass(file.status) +
          '">' +
          escapeHtml(file.status) +
          "</span> " +
          '<span class="detail-file-path">' +
          escapeHtml(file.path) +
          "</span>" +
          "</li>",
      );
    }
    html.push("</ul>");
  }
  html.push("</div>");

  panelEl.innerHTML = html.join("");
  panelEl.classList.add("visible");

  // Wire close button
  const closeBtn = document.getElementById("detail-close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      panelEl.classList.remove("visible");
    });
  }

  // Wire parent hash clicks (navigate to parent commit)
  panelEl.querySelectorAll(".detail-parent-hash").forEach((el) => {
    el.addEventListener("click", () => {
      const hash = el.getAttribute("data-hash");
      if (hash) {
        callbacks.onSelectCommit(hash);
      }
    });
  });

  // Wire file clicks (open diff)
  panelEl.querySelectorAll(".detail-file-item").forEach((el) => {
    el.addEventListener("click", () => {
      const filePath = el.getAttribute("data-path");
      const hash = el.getAttribute("data-hash");
      if (filePath && hash) {
        callbacks.onOpenFileDiff(hash, filePath);
      }
    });
  });
}

/**
 * Hide the commit detail panel.
 */
export function hideCommitDetail(panelEl: HTMLElement): void {
  panelEl.classList.remove("visible");
}

/**
 * Format an ISO date string for display.
 * [CLEAN-CODE] Extracted for readability.
 */
function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) {
      return isoDate;
    }
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoDate;
  }
}
