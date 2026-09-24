// Markdown → sanitized HTML, plus preview behaviours (scroll mapping, mermaid, tasks).
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import anchor from 'markdown-it-anchor';
import katexPluginModule from '@vscode/markdown-it-katex';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { escapeHtml } from './ui.js';
import { frontMatter, stripFrontMatter } from './render/front-matter.js';
import { splitBlocks, blockKey, patchBlocks } from './render/blocks.js';
import { renderDiagrams, carryOverDiagrams } from './render/mermaid.js';

const katexPlugin = katexPluginModule.default ?? katexPluginModule;

export function slugify(s) {
  return (
    String(s)
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-') || 'section'
  );
}

// Math and code barely change between keystrokes, so their output is memoized. Each cache
// only keeps what the last two renders used, so it stays about the size of the document.
let generation = 0;
function memo(fn) {
  let gen = generation;
  let current = new Map();
  let previous = new Map();
  return (key, ...args) => {
    if (gen !== generation) {
      gen = generation;
      previous = current;
      current = new Map();
    }
    let out = current.get(key) ?? previous.get(key);
    if (out === undefined) out = fn(...args);
    current.set(key, out);
    return out;
  };
}

const highlight = memo((code, lang) => {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      /* fall through to plain text */
    }
  }
  return escapeHtml(code);
});

// The plugin would otherwise use its own nested (older) KaTeX, whose markup does not
// match the app's katex.min.css. `output` is 'mathml' for exports, which need no CSS.
function katexFor(output) {
  const render = memo((tex, displayMode) => katex.renderToString(tex, { displayMode, output, throwOnError: false }));
  return { renderToString: (tex, opts) => render(`${opts?.displayMode ? 'D' : 'I'}${tex}`, tex, Boolean(opts?.displayMode)) };
}

function createMarkdown({ standalone = false } = {}) {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight: (code, lang) => highlight(`${lang}\n${code}`, code, lang),
  })
    .use(frontMatter)
    .use(taskLists, { enabled: true, label: true }) // its options are global: keep them identical everywhere
    .use(footnote)
    .use(anchor, { slugify, tabIndex: false })
    .use(katexPlugin, { katex: katexFor(standalone ? 'mathml' : 'htmlAndMathml'), throwOnError: false, enableFencedBlocks: true });

  // Record the source line of every block, so the preview can scroll in sync with the editor.
  if (!standalone) {
    md.core.ruler.push('source_lines', (state) => {
      for (const token of state.tokens) {
        if (token.map && token.nesting !== -1) token.attrSet('data-line', String(token.map[0] + 1));
      }
    });
  }

  // Tables scroll inside a wrapper, so they keep their table semantics.
  md.renderer.rules.table_open = (tokens, idx, options, env, self) => `<div class="table-wrap">${self.renderToken(tokens, idx, options)}`;
  md.renderer.rules.table_close = (tokens, idx, options, env, self) => `${self.renderToken(tokens, idx, options)}</div>\n`;

  // Mermaid fences become placeholders that are rendered to SVG after sanitizing.
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const lang = token.info.trim().split(/\s+/)[0].toLowerCase();
    if (lang === 'mermaid') {
      const line = token.attrGet('data-line');
      return `<div class="mermaid-block"${line ? ` data-line="${line}"` : ''}><pre class="mermaid-src">${escapeHtml(token.content)}</pre></div>\n`;
    }
    const html = defaultFence(tokens, idx, options, env, self);
    return lang ? html.replace('<pre>', `<pre data-lang="${escapeHtml(lang)}">`) : html;
  };
  return md;
}

const md = createMarkdown();
let standaloneMd = null;

// A private sanitizer, so Mermaid's hooks on the shared DOMPurify instance never run here.
const purify = typeof window === 'undefined' ? DOMPurify : DOMPurify(window);
purify.setConfig({ ADD_ATTR: ['data-line', 'data-lang', 'target'], FORBID_TAGS: ['style', 'form'] });

purify.addHook('uponSanitizeAttribute', (node, data) => {
  // Heading ids come from slugify; words like "links" or "title" would otherwise be dropped
  // as DOM clobbering risks, which they are not on a heading.
  if (data.attrName === 'id' && /^H[1-6]$/.test(node.nodeName) && /^[\p{L}\p{N}_-]+$/u.test(data.attrValue)) {
    data.forceKeepAttr = true;
  }
});
purify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href') && !node.getAttribute('href').startsWith('#')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// Raw HTML typed by the user (markdown-it's own output is always well-formed).
const isRawHtml = (t) => t.type === 'html_block' || Boolean(t.children?.some((c) => c.type === 'html_inline'));

/** Renders src block by block: [{ html, line, key, raw }] (see render/blocks.js). */
function renderBlocks(markdown, src) {
  generation++;
  const env = {};
  const tokens = markdown.parse(src, env);
  return splitBlocks(tokens).map(([start, end]) => {
    const slice = tokens.slice(start, end);
    const html = markdown.renderer.render(slice, markdown.options, env);
    const first = slice.find((t) => t.map);
    const line = first ? first.map[0] + 1 : 0;
    return { html, line, key: blockKey(html, line), raw: slice.some(isRawHtml) };
  });
}

function sanitizeOne(html) {
  const box = document.createElement('div');
  box.innerHTML = purify.sanitize(html);
  return [...box.childNodes];
}

// Blocks with raw HTML are sanitized and parsed one by one, so an unclosed tag cannot leak
// into the blocks after it. The others are well-formed and go through in one pass.
function sanitizeBlocks(list) {
  const nodes = [];
  const plain = list.flatMap((b, i) => (b.raw ? [] : [i]));
  if (plain.length > 1) {
    const box = document.createElement('div');
    box.innerHTML = purify.sanitize(plain.map((i) => `<div>${list[i].html}</div>`).join(''));
    if (box.childNodes.length === plain.length) box.childNodes.forEach((wrapper, j) => (nodes[plain[j]] = [...wrapper.childNodes]));
  }
  return list.map((b, i) => nodes[i] ?? sanitizeOne(b.html));
}

const renderNodes = (markdown, src) => sanitizeBlocks(renderBlocks(markdown, src)).flat();

export function renderMarkdown(src) {
  const box = document.createElement('div');
  box.append(...renderNodes(md, src));
  return box.innerHTML;
}

const EMPTY = { html: '<p class="preview-empty">Nothing to preview yet.</p>', line: 0, key: 'empty' };

/** Sanitized, self-contained HTML for "Download HTML": light diagrams inlined, math as MathML. */
export async function renderStandalone(src) {
  standaloneMd ??= createMarkdown({ standalone: true });
  const box = document.createElement('div');
  box.append(...renderNodes(standaloneMd, src));
  for (const input of box.querySelectorAll('input.task-list-item-checkbox')) input.setAttribute('disabled', '');
  for (const li of box.querySelectorAll('.task-list-item.enabled')) li.classList.remove('enabled');
  await renderDiagrams(box, 'default');
  return box.innerHTML;
}

/** Headings with the same ids the preview gives them (read from markdown-it-anchor's tokens). */
export function extractHeadings(src) {
  const tokens = md.parse(src, {});
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const text = tokens[i + 1].children.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('');
    out.push({ level: Number(t.tag.slice(1)), text: text || '(untitled)', line: t.map[0] + 1, id: t.attrGet('id') });
  }
  return out;
}

export function documentStats(src) {
  const text = stripFrontMatter(src)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()!-]/g, ' ');
  const words = (text.match(/[\p{L}\p{N}'’]+/gu) ?? []).length;
  return { words, chars: src.length, minutes: words ? Math.max(1, Math.round(words / 230)) : 0 };
}

// ---- Preview pane controller --------------------------------------------

export function createPreview({ scroller, content }, { onToggleTask, onScroll, isDark }) {
  let lastSrc = null; // latest source passed to update()
  let shownSrc = null; // source currently rendered (null: needs a render)
  let visible = true;
  let themeOverride = null;
  let anchorList = null;
  let blocks = []; // what the content element shows, see patchBlocks()

  const diagramTheme = () => ((themeOverride ?? (isDark?.() ? 'dark' : 'light')) === 'dark' ? 'dark' : 'default');

  function render() {
    shownSrc = lastSrc;
    anchorList = null;
    const next = renderBlocks(md, lastSrc);
    const patch = patchBlocks(content, blocks, next.length ? next : [EMPTY], sanitizeBlocks);
    blocks = patch.blocks;
    carryOverDiagrams(patch.removed, patch.added);
    return renderDiagrams(content, diagramTheme());
  }

  const flush = () => (lastSrc !== null && lastSrc !== shownSrc ? render() : null);

  content.addEventListener('click', (e) => {
    const box = e.target.closest('input.task-list-item-checkbox');
    if (box) {
      e.preventDefault();
      const line = Number(box.closest('[data-line]')?.dataset.line);
      // The source line as rendered: lets the caller ignore clicks on a stale preview.
      if (line) onToggleTask?.(line, shownSrc?.split(/\r\n?|\n/)[line - 1] ?? '');
      return;
    }
    const link = e.target.closest('a[href^="#"]');
    if (link) {
      e.preventDefault();
      let id = link.getAttribute('href').slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        /* keep it as written */
      }
      const target = id && content.querySelector(`[id="${CSS.escape(id)}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  scroller.addEventListener('scroll', () => onScroll?.(), { passive: true });
  // Block positions only move when the content resizes (images, diagrams, fonts, width).
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => (anchorList = null)).observe(content);

  function anchors() {
    if (anchorList) return anchorList;
    const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const list = [];
    let lastLine = 0;
    let lastY = -1;
    for (const el of content.querySelectorAll('[data-line]')) {
      const line = Number(el.dataset.line);
      const y = el.getBoundingClientRect().top - top;
      if (line > lastLine && y >= lastY) {
        list.push({ line, y });
        lastLine = line;
        lastY = y;
      }
    }
    anchorList = list;
    return list;
  }

  return {
    update(src, { force = false } = {}) {
      lastSrc = src;
      if (force) shownSrc = null;
      if (visible) flush();
    },
    rerender() {
      if (lastSrc !== null) this.update(lastSrc, { force: true });
    },
    /** While hidden, update() only stores the source; showing it renders what is pending. */
    setVisible(on) {
      visible = Boolean(on);
      anchorList = null;
      if (visible) flush();
    },
    /** Re-renders diagrams with a fixed theme ('light', or null to follow the app); resolves when done. */
    setThemeOverride(theme) {
      themeOverride = theme || null;
      flush(); // printing shows the preview even when it is hidden, so bring it up to date
      return renderDiagrams(content, diagramTheme());
    },
    /** Scroll so that the given (fractional) source line sits at the top. */
    scrollToLine(line) {
      const list = anchors();
      if (!list.length) return;
      let before = { line: 1, y: 0 };
      let after = null;
      for (const a of list) {
        if (a.line <= line) before = a;
        else {
          after = a;
          break;
        }
      }
      const endY = scroller.scrollHeight;
      const next = after ?? { line: before.line + 1e6, y: endY };
      const ratio = next.line === before.line ? 0 : (line - before.line) / (next.line - before.line);
      scroller.scrollTop = before.y + (next.y - before.y) * Math.min(Math.max(ratio, 0), 1) - 16;
    },
    /** The (fractional) source line currently at the top of the preview. */
    topLine() {
      const list = anchors();
      const y = scroller.scrollTop + 16;
      if (!list.length) return 1;
      let before = { line: 1, y: 0 };
      let after = null;
      for (const a of list) {
        if (a.y <= y) before = a;
        else {
          after = a;
          break;
        }
      }
      if (!after) return before.line;
      const ratio = after.y === before.y ? 0 : (y - before.y) / (after.y - before.y);
      return before.line + (after.line - before.line) * ratio;
    },
    scrollToId(id) {
      content.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start' });
    },
    html() {
      flush();
      return content.innerHTML;
    },
    renderStandalone,
  };
}
