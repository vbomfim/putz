/**
 * Markdown formatting helpers.
 *
 * - `formatMarkdownTables(content)` — pretty-aligns pipe tables in a buffer.
 * - `wrapInline` / `applyLinePrefix` / `insertBlock` are pure string ops the
 *   markdown toolbar uses to compute new text + cursor position.
 *
 * Kept free of Monaco/React imports so they can be unit-tested independently.
 */

/** Column alignment derived from the separator row (`---`, `:---`, `:---:`, `---:`). */
type Align = "left" | "center" | "right";

interface ParsedRow {
  cells: string[];
}

function parseRow(line: string): ParsedRow | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  // Drop leading/trailing pipes, then split. Escaped pipes (\|) are preserved.
  const inner = trimmed.slice(1, -1);
  const cells: string[] = [];
  let buf = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "\\" && inner[i + 1] === "|") {
      buf += "\\|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push(buf.trim());
      buf = "";
      continue;
    }
    buf += ch;
  }
  cells.push(buf.trim());
  return { cells };
}

function isSeparatorRow(row: ParsedRow): boolean {
  if (row.cells.length === 0) return false;
  return row.cells.every((c) => /^:?-{1,}:?$/.test(c));
}

function alignFromSeparator(cell: string): { align: Align; explicitLeft: boolean } {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  if (left && right) return { align: "center", explicitLeft: true };
  if (right) return { align: "right", explicitLeft: false };
  return { align: "left", explicitLeft: left };
}

function pad(text: string, width: number, align: Align): string {
  const slack = Math.max(0, width - visualLength(text));
  if (align === "right") return " ".repeat(slack) + text;
  if (align === "center") {
    const l = Math.floor(slack / 2);
    const r = slack - l;
    return " ".repeat(l) + text + " ".repeat(r);
  }
  return text + " ".repeat(slack);
}

// Best-effort visual length (treats CJK as 2-wide). Good enough for table padding.
function visualLength(s: string): number {
  let n = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    n += code > 0x1100 && (code <= 0x115f || code >= 0x2e80) ? 2 : 1;
  }
  return n;
}

/**
 * Pretty-align pipe tables in a markdown buffer.
 *
 * A table block is at least 2 consecutive lines starting and ending with `|`,
 * the second of which is a separator row (`|---|---|`). Non-table content
 * passes through untouched. Indentation of the first row is preserved on every
 * row of that table.
 */
export function formatMarkdownTables(input: string): string {
  const lines = input.split("\n");
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch ? indentMatch[1] : "";
    const header = parseRow(line);
    const sep = i + 1 < lines.length ? parseRow(lines[i + 1]) : null;

    if (header && sep && isSeparatorRow(sep) && header.cells.length === sep.cells.length) {
      // Collect body rows
      const rows: ParsedRow[] = [header];
      const sepInfo = sep.cells.map(alignFromSeparator);
      const aligns = sepInfo.map((s) => s.align);
      let j = i + 2;
      while (j < lines.length) {
        const r = parseRow(lines[j]);
        if (!r || r.cells.length !== header.cells.length) break;
        rows.push(r);
        j++;
      }

      // Compute per-column widths (min 3 so separator stays valid: `---`)
      const widths = header.cells.map((_, col) => {
        let w = 3;
        for (const r of rows) w = Math.max(w, visualLength(r.cells[col]));
        return w;
      });

      // Header
      out.push(`${indent}| ${header.cells.map((c, k) => pad(c, widths[k], aligns[k])).join(" | ")} |`);
      // Separator (respect alignment markers — preserve explicit left colon)
      out.push(
        `${indent}| ${sepInfo
          .map((info, k) => {
            const w = widths[k];
            if (info.align === "center") return `:${"-".repeat(w - 2)}:`;
            if (info.align === "right") return `${"-".repeat(w - 1)}:`;
            if (info.explicitLeft) return `:${"-".repeat(w - 1)}`;
            return "-".repeat(w);
          })
          .join(" | ")} |`,
      );
      // Body rows
      for (let r = 1; r < rows.length; r++) {
        out.push(
          `${indent}| ${rows[r].cells.map((c, k) => pad(c, widths[k], aligns[k])).join(" | ")} |`,
        );
      }
      i = j;
      continue;
    }

    out.push(line);
    i++;
  }

  return out.join("\n");
}
