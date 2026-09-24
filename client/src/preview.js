// Markdown → sanitized HTML, plus preview behaviours (scroll mapping, mermaid, tasks).
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import anchor from 'markdown-it-anchor';
import katexPluginModule from '@vscode/markdown-it-katex';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import { escapeHtml } from './ui.js';

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

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* fall through to plain text */
      }
    }
    return escapeHtml(code);
  },
})
  .use(taskLists, { enabled: true, label: true })
  .use(footnote)
  .use(anchor, { slugify, tabIndex: false })
  .use(katexPlugin, { throwOnError: false, enableFencedBlocks: true });

// Record the source line of every block, so the preview can scroll in sync with the editor.
md.core.ruler.push('source_lines', (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting !== -1) token.attrSet('data-line', String(token.map[0] + 1));
  }
});

// Mermaid fences become placeholders that are rendered to SVG after sanitizing.
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const lang = token.info.trim().split(/\s+/)[0].toLowerCase();
  if (lang === 'mermaid') {
    return `<div class="mermaid-block" data-line="${token.map[0] + 1}"><pre class="mermaid-src">${escapeHtml(token.content)}</pre></div>\n`;
  }
  const html = defaultFence(tokens, idx, options, env, self);
  return lang ? html.replace('<pre>', `<pre data-lang="${escapeHtml(lang)}">`) : html;
};

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.getAttribute('href') && !node.getAttribute('href').startsWith('#')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(src) {
  const raw = md.render(src);
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['data-line', 'data-lang', 'target'],
    FORBID_TAGS: ['style', 'form'],
  });
}

export function extractHeadings(src) {
  const tokens = md.parse(src, {});
  const out = [];
  const seen = new Map();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type !== 'heading_open') continue;
    const inline = tokens[i + 1];
    const text = inline.children.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('');
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ level: Number(t.tag.slice(1)), text: text || '(untitled)', line: t.map[0] + 1, id: n ? `${base}-${n}` : base });
  }
  return out;
}

export function documentStats(src) {
  const text = src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~[\]()!-]/g, ' ');
  const words = (text.match(/[\p{L}\p{N}'’]+/gu) ?? []).length;
  return { words, chars: src.length, minutes: Math.max(1, Math.round(words / 230)) };
}

// ---- Mermaid (loaded on demand) -----------------------------------------

let mermaidPromise;
const svgCache = new Map();
let mermaidCounter = 0;

async function renderMermaid(container, dark) {
  const blocks = container.querySelectorAll('.mermaid-block');
  if (!blocks.length) return;
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'inherit' });
  for (const block of blocks) {
    const src = block.querySelector('.mermaid-src')?.textContent ?? '';
    const key = `${dark}:${src}`;
    let svg = svgCache.get(key);
    if (svg === undefined) {
      try {
        ({ svg } = await mermaid.render(`mermaid-${++mermaidCounter}`, src));
      } catch (err) {
        svg = null;
        block.dataset.error = String(err?.message ?? err).split('\n')[0];
      }
      if (svgCache.size > 100) svgCache.clear();
      svgCache.set(key, svg);
    }
    if (!block.isConnected) return;
    if (svg) {
      block.innerHTML = svg;
      block.classList.add('rendered');
    } else {
      block.classList.add('failed');
    }
  }
}

// ---- Preview pane controller --------------------------------------------

export function createPreview({ scroller, content }, { onToggleTask, onScroll, isDark }) {
  let lastSrc = null;

  content.addEventListener('click', (e) => {
    const box = e.target.closest('input.task-list-item-checkbox');
    if (box) {
      e.preventDefault();
      const line = Number(box.closest('[data-line]')?.dataset.line);
      if (line) onToggleTask?.(line);
      return;
    }
    const link = e.target.closest('a[href^="#"]');
    if (link) {
      e.preventDefault();
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      const target = id && content.querySelector(`[id="${CSS.escape(id)}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  scroller.addEventListener('scroll', () => onScroll?.(), { passive: true });

  function anchors() {
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
    return list;
  }

  return {
    update(src, { force = false } = {}) {
      if (!force && src === lastSrc) return;
      lastSrc = src;
      content.innerHTML = renderMarkdown(src) || '<p class="preview-empty">Nothing to preview yet.</p>';
      renderMermaid(content, isDark());
    },
    rerender() {
      if (lastSrc !== null) this.update(lastSrc, { force: true });
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
    html: () => content.innerHTML,
  };
}
