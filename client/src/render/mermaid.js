// Mermaid diagrams: loaded on demand, drawn one at a time (so theme switches never
// interleave), cached by theme + source, and never left behind in <body> on errors.

let mermaidPromise = null;
let initializedTheme = null;
let counter = 0;
let queue = Promise.resolve();
const results = new Map(); // `${theme}\n${src}` → { svg } or { error }
const sources = new WeakMap(); // .mermaid-block → its diagram source
const shown = new WeakMap(); // .mermaid-block → the results key it currently shows
const wanted = new WeakMap(); // container → the theme its diagrams should use

function loadMermaid() {
  mermaidPromise ??= import('mermaid')
    .then((m) => m.default)
    .catch((err) => {
      mermaidPromise = null; // try again next time (e.g. after coming back online)
      throw err;
    });
  return mermaidPromise;
}

function diagramSource(block) {
  let src = sources.get(block);
  if (src === undefined) {
    src = block.querySelector('.mermaid-src')?.textContent ?? '';
    sources.set(block, src);
  }
  return src;
}

const blocksIn = (node) =>
  node.nodeType !== 1 ? [] : node.matches('.mermaid-block') ? [node] : [...node.querySelectorAll('.mermaid-block')];

// The first lines of a parse error hold the position, the caret and what was expected.
const errorText = (err) => String(err?.message ?? err).trim().split('\n').slice(0, 4).join('\n');

async function draw(mermaid, theme, src) {
  const key = `${theme}\n${src}`;
  let result = results.get(key);
  if (result) return result;
  if (theme !== initializedTheme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme,
      fontFamily: 'inherit',
      layout: 'dagre', // Mermaid defaults to ELK, a 1.4 MB download
      suppressErrorRendering: true, // otherwise error diagrams pile up in <body>
    });
    initializedTheme = theme;
  }
  const id = `mermaid_${++counter}`; // "_" never appears in heading slugs, so ids cannot clash
  try {
    result = { svg: (await mermaid.render(id, src)).svg };
  } catch (err) {
    // A TypeError is e.g. a diagram chunk that failed to download: not cached, retried next render.
    if (err instanceof TypeError) return { error: errorText(err), transient: true };
    result = { error: errorText(err) };
  } finally {
    document.getElementById(`d${id}`)?.remove();
  }
  if (results.size >= 200) results.delete(results.keys().next().value); // drop the oldest
  results.set(key, result);
  return result;
}

function show(block, key, { svg, error }) {
  shown.set(block, key);
  block.classList.toggle('failed', !svg);
  if (svg) {
    block.innerHTML = svg;
    block.classList.add('rendered');
    return;
  }
  const message = document.createElement('pre');
  message.className = 'mermaid-error';
  message.textContent = `Diagram error: ${error}`;
  // While a diagram is being edited, keep its last good drawing under the error; else show the source.
  let body = block.querySelector(':scope > svg');
  if (!body) {
    body = document.createElement('pre');
    body.className = 'mermaid-src';
    body.textContent = diagramSource(block);
  }
  block.replaceChildren(message, body);
}

async function renderPending(container) {
  const blocks = container.querySelectorAll('.mermaid-block');
  if (!blocks.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch {
    for (const block of blocks) {
      if (!shown.has(block)) show(block, null, { error: 'the diagram renderer could not be loaded.' });
    }
    return;
  }
  for (const block of blocks) {
    const theme = wanted.get(container);
    const key = `${theme}\n${diagramSource(block)}`;
    if (!container.contains(block) || shown.get(block) === key) continue;
    const result = await draw(mermaid, theme, diagramSource(block));
    // Skip blocks replaced by a newer render, or a theme that changed meanwhile (a later run redraws).
    // A transient error is not recorded as shown, so the next update() or rerender() retries it.
    if (container.contains(block) && wanted.get(container) === theme) show(block, result.transient ? null : key, result);
  }
}

/**
 * Draws the diagrams in container with a Mermaid theme ('default' or 'dark').
 * Cached drawings are applied at once; the returned promise (which never rejects)
 * resolves when all diagrams are done.
 */
export function renderDiagrams(container, theme) {
  wanted.set(container, theme);
  for (const block of container.querySelectorAll('.mermaid-block')) {
    const key = `${theme}\n${diagramSource(block)}`;
    const cached = results.get(key);
    if (cached && shown.get(block) !== key) show(block, key, cached);
  }
  queue = queue.then(() => renderPending(container)).catch((err) => console.error(err));
  return queue;
}

/** While a changed diagram is redrawn, keep showing its previous drawing instead of the raw source. */
export function carryOverDiagrams(removed, added) {
  const before = removed.flatMap(blocksIn);
  const after = added.flatMap(blocksIn);
  if (!before.length || before.length !== after.length) return;
  after.forEach((block, i) => {
    const drawing = before[i].querySelector(':scope > svg');
    if (!drawing) return;
    diagramSource(block); // remember the source before the placeholder goes
    block.replaceChildren(drawing);
    block.classList.add('rendered');
  });
}
