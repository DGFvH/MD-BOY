// The preview is built from top-level blocks. Each render re-parses the whole document,
// but only blocks whose HTML changed are sanitized and put in the DOM again. Unchanged
// blocks keep their nodes, so drawn diagrams, open <details>, selections and scroll
// positions survive typing elsewhere, and a keystroke costs little even in long documents.

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;

// How many elements a piece of raw HTML leaves open, e.g. "<details>" (closed in a later block).
function openTags(html) {
  let depth = 0;
  const tags = html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g);
  for (const [, close, name, selfClose] of tags) {
    if (!VOID.test(name) && !selfClose) depth += close ? -1 : 1;
  }
  return depth;
}

/** Splits markdown-it tokens into [start, end) ranges of top-level blocks. */
export function splitBlocks(tokens) {
  const ranges = [];
  let start = 0;
  let depth = 0;
  let open = 0; // raw HTML elements still open: keep their content in the same block
  tokens.forEach((token, i) => {
    depth += token.nesting;
    if (token.type === 'html_block' && token.level === 0) open = Math.max(0, open + openTags(token.content));
    if (depth === 0 && open === 0) {
      ranges.push([start, i + 1]);
      start = i + 1;
    }
  });
  if (start < tokens.length) ranges.push([start, tokens.length]);
  return ranges;
}

/** A block's identity: its HTML with data-line values relative to its first line. */
export function blockKey(html, line) {
  return html.replace(/ data-line="(\d+)"/g, (_, n) => ` data-line="${n - line}"`);
}

function shiftLines(nodes, delta) {
  if (!delta) return;
  for (const node of nodes) {
    if (node.nodeType !== 1) continue;
    for (const el of [node, ...node.querySelectorAll('[data-line]')]) {
      if (el.hasAttribute('data-line')) el.setAttribute('data-line', String(Number(el.getAttribute('data-line')) + delta));
    }
  }
}

/**
 * Moves parent from the blocks it shows (`prev`, as returned earlier) to `next`
 * ([{ key, line, ... }]). Changed blocks go through build(blocks) → [[node]].
 * Returns { blocks, removed, added }.
 */
export function patchBlocks(parent, prev, next, build) {
  let start = 0;
  while (start < prev.length && start < next.length && prev[start].key === next[start].key) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1].key === next[endNext - 1].key) {
    endPrev--;
    endNext--;
  }
  const keep = (old, fresh) => {
    shiftLines(old.nodes, fresh.line - old.line);
    return { key: fresh.key, line: fresh.line, nodes: old.nodes };
  };
  const removed = prev.slice(start, endPrev).flatMap((b) => b.nodes);
  const changed = next.slice(start, endNext);
  const built = changed.length ? build(changed) : [];
  const middle = changed.map((b, i) => ({ key: b.key, line: b.line, nodes: built[i] }));
  const added = middle.flatMap((b) => b.nodes);
  const blocks = [
    ...prev.slice(0, start).map((b, i) => keep(b, next[i])),
    ...middle,
    ...prev.slice(endPrev).map((b, i) => keep(b, next[endNext + i])),
  ];

  let anchor = null; // insert before the first surviving node after the changed range
  for (let i = endPrev; i < prev.length && !anchor; i++) anchor = prev[i].nodes.find((n) => n.parentNode === parent) ?? null;
  for (const node of removed) node.remove();
  const fragment = document.createDocumentFragment();
  fragment.append(...added);
  parent.insertBefore(fragment, anchor);
  return { blocks, removed, added };
}
