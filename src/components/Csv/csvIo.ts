/**
 * CSV parse/serialize helpers using PapaParse.
 *
 * Auto-detects the delimiter (comma, semicolon, tab, pipe) based on
 * the file's first few lines. Round-trips through PapaParse so quoting
 * and escaping are preserved on save.
 */
import Papa from "papaparse";

export type CsvDelimiter = "," | ";" | "\t" | "|";

export interface CsvParsed {
  /** Header row (if present) — column names. */
  headers: string[];
  /** Data rows — array of arrays aligned to headers length. */
  rows: string[][];
  /** Detected delimiter. */
  delimiter: CsvDelimiter;
  /** Whether the first row was treated as a header. */
  hasHeader: boolean;
  /** Detected line ending: "\n" or "\r\n". */
  lineEnding: "\n" | "\r\n";
}

const KNOWN_DELIMITERS: CsvDelimiter[] = [",", ";", "\t", "|"];

/** Sniff delimiter by counting candidates in the first 4KB. */
function sniffDelimiter(input: string): CsvDelimiter {
  const sample = input.slice(0, 4096);
  let best: CsvDelimiter = ",";
  let bestCount = -1;
  for (const d of KNOWN_DELIMITERS) {
    let count = 0;
    for (let i = 0; i < sample.length; i++) {
      if (sample[i] === d) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

/** Detect line ending by looking for \r\n in the first line break. */
function sniffLineEnding(input: string): "\n" | "\r\n" {
  const idx = input.indexOf("\n");
  if (idx > 0 && input[idx - 1] === "\r") return "\r\n";
  return "\n";
}

export function parseCsv(
  input: string,
  opts?: { hasHeader?: boolean; delimiter?: CsvDelimiter },
): CsvParsed {
  const delimiter = opts?.delimiter ?? sniffDelimiter(input);
  const lineEnding = sniffLineEnding(input);
  const result = Papa.parse<string[]>(input, {
    delimiter,
    header: false,
    skipEmptyLines: false,
  });
  const all = (result.data as string[][]).filter((r) => r.length > 0);
  const hasHeader = opts?.hasHeader ?? false;
  if (all.length === 0) {
    return { headers: [], rows: [], delimiter, hasHeader, lineEnding };
  }
  const colCount = all.reduce((max, r) => Math.max(max, r.length), 0);
  // Pad short rows
  const normalized = all.map((r) => {
    const out = r.slice();
    while (out.length < colCount) out.push("");
    return out;
  });
  if (hasHeader) {
    const headers = normalized[0];
    return {
      headers,
      rows: normalized.slice(1),
      delimiter,
      hasHeader,
      lineEnding,
    };
  }
  // Synthesize column names: A, B, C, ...
  const headers: string[] = [];
  for (let i = 0; i < colCount; i++) {
    headers.push(columnName(i));
  }
  return { headers, rows: normalized, delimiter, hasHeader, lineEnding };
}

/** Excel-style column name: 0→A, 25→Z, 26→AA, ... */
export function columnName(index: number): string {
  let n = index;
  let out = "";
  while (true) {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return out;
}

export function serializeCsv(parsed: CsvParsed): string {
  const data = parsed.hasHeader
    ? [parsed.headers, ...parsed.rows]
    : parsed.rows;
  return Papa.unparse(data, {
    delimiter: parsed.delimiter,
    newline: parsed.lineEnding,
    quotes: false,
  });
}
