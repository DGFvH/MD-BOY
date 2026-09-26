// CSV/TSV parsing and Markdown table output. No DOM, so the MCP server (api/mcp.js) uses it
// too; the table tools' UI is in table-tool.js.

// ---- Parsing ----------------------------------------------------------------

/** The delimiter that splits the first line into the most fields: tab, comma or semicolon. */
export function detectDelimiter(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of ['\t', ',', ';']) {
    let count = 0;
    let quoted = false;
    for (const ch of first) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count++;
    }
    if (count > bestCount) [best, bestCount] = [d, count];
  }
  return best;
}

/** Parses delimited text (RFC 4180 quoting: "a, b" and "" for a quote) into rows of cells. */
export function parseDelimited(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---- Markdown ---------------------------------------------------------------

const width = (s) => [...s].length;
// Pipes would end the cell; line breaks inside a cell become <br>.
const cellText = (s) => String(s ?? '').trim().replace(/\|/g, '\\|').replace(/\n+/g, '<br>');

/**
 * rows: [[...cells]]. header: use the first row as the header (otherwise "Column 1", …).
 * align: 'left' | 'center' | 'right' | 'none'. The columns are padded so the source lines up.
 */
export function toMarkdownTable(rows, { header = true, align = 'none' } = {}) {
  const cols = Math.max(0, ...rows.map((r) => r.length));
  if (!cols) return '';
  const norm = rows.map((r) => Array.from({ length: cols }, (_, i) => cellText(r[i])));
  const head = header ? norm[0] : Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
  const body = header ? norm.slice(1) : norm;
  const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...[head, ...body].map((r) => width(r[i]))));
  const pad = (s, i) => s + ' '.repeat(widths[i] - width(s));
  const line = (r) => `| ${r.map(pad).join(' | ')} |`;
  const rule = widths.map((w) => {
    if (align === 'center') return `:${'-'.repeat(Math.max(1, w - 2))}:`;
    if (align === 'right') return `${'-'.repeat(w - 1)}:`;
    if (align === 'left') return `:${'-'.repeat(w - 1)}`;
    return '-'.repeat(w);
  });
  return [line(head), `| ${rule.join(' | ')} |`, ...body.map(line)].join('\n');
}
