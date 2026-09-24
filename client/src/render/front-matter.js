// YAML front matter ("---" on the first line, closed by "---" or "..."), as written by
// Jekyll, Hugo, Obsidian and friends. It is shown as a small collapsed metadata block
// instead of a rule plus a heading, and it is left out of word counts.
import { escapeHtml } from '../ui.js';

// The line after the opening "---" must look like a YAML key ("title: ..."); anything else
// ("# Heading", a paragraph, a blank line) means the "---" is a horizontal rule.
const FRONT_MATTER = /^---[ \t]*\r?\n(?=[\w"'][^\r\n:]*:(?:[ \t]|\r?\n|$))(?:[^\r\n]*\r?\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function stripFrontMatter(src) {
  return src.replace(FRONT_MATTER, '');
}

/** The `title:` value from the front matter, if there is one. */
export function frontMatterTitle(src) {
  const block = FRONT_MATTER.exec(src)?.[0] ?? '';
  const m = /^title:[ \t]*(.+?)[ \t]*$/m.exec(block);
  return m ? m[1].replace(/^(['"])(.*)\1$/, '$2').trim() : '';
}

export function frontMatter(md) {
  md.block.ruler.before('table', 'front_matter', (state, startLine, endLine, silent) => {
    if (startLine !== 0 || state.parentType !== 'root') return false;
    const m = FRONT_MATTER.exec(state.src);
    if (!m) return false;
    const lines = m[0].replace(/\n$/, '').split('\n');
    const close = lines.length - 1;
    if (close >= endLine) return false;
    if (silent) return true;
    const token = state.push('front_matter', '', 0);
    token.block = true;
    token.map = [0, close + 1];
    token.content = lines.slice(1, -1).join('\n');
    state.line = close + 1;
    return true;
  });
  md.renderer.rules.front_matter = (tokens, idx) => {
    const line = tokens[idx].attrGet('data-line');
    return `<details class="front-matter"${line ? ` data-line="${line}"` : ''}><summary>Metadata</summary><pre>${escapeHtml(tokens[idx].content)}</pre></details>\n`;
  };
}
