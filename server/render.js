// Server-side Markdown rendering for read-only share pages. Raw HTML in the
// document is escaped (html: false), so a shared page can't run scripts.
import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnote from 'markdown-it-footnote';
import anchor from 'markdown-it-anchor';
import mark from 'markdown-it-mark';
import { full as emoji } from 'markdown-it-emoji';
import katexPluginModule from '@vscode/markdown-it-katex';
import katex from 'katex';
import hljs from 'highlight.js/lib/common';
import alertsPlugin from '../client/src/render/alerts.js';

const katexPlugin = katexPluginModule.default ?? katexPluginModule;

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function slugify(s) {
  return String(s).trim().toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'section';
}

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/;

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* plain text below */
      }
    }
    return escapeHtml(code);
  },
})
  .use(taskLists, { enabled: false })
  .use(footnote)
  .use(anchor, { slugify, tabIndex: false })
  .use(mark)
  .use(emoji, { shortcuts: {} }) // keep ':)' and '8)' as typed, like the preview
  .use(alertsPlugin)
  // MathML needs no stylesheet or fonts, so the page stays self-contained.
  .use(katexPlugin, { katex, output: 'mathml', throwOnError: false, enableFencedBlocks: true });

// External links open in a new tab and don't pass on the page address.
const defaultLinkOpen = md.renderer.rules.link_open ?? ((t, i, o, e, self) => self.renderToken(t, i, o));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') ?? '';
  if (!href.startsWith('#')) {
    tokens[idx].attrSet('target', '_blank');
    tokens[idx].attrSet('rel', 'noopener noreferrer nofollow');
  }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdownToHtml(src) {
  return md.render(String(src).replace(FRONT_MATTER, ''));
}
