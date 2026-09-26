// Import and export: Markdown files, standalone HTML and print-to-PDF.
import markdownCss from './markdown.css?raw';
import { APP_NAME } from './brand.js';
import { downloadFile, escapeHtml, h } from './ui.js';
import { getPrefs } from './storage.js';
import { frontMatterTitle } from './render/front-matter.js';

export function safeFileName(title) {
  return (title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';
}

/** A document's title: its front matter title, else its first heading, else "Untitled". */
export function titleFromMarkdown(src) {
  const heading = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(src)?.[1];
  return (frontMatterTitle(src) || heading || 'Untitled').trim().slice(0, 200) || 'Untitled';
}

export function exportMarkdown(title, content) {
  downloadFile(`${safeFileName(title)}.md`, content, 'text/markdown;charset=utf-8');
}

/**
 * A self-contained page: no external CSS, fonts or scripts. Expects the body from
 * preview.renderStandalone() (math as MathML, light-theme diagrams), so it is always light.
 */
/** Whether downloaded HTML ends with a small "Written with Hashlite" line (on unless switched off). */
export const exportCredit = () => getPrefs().exportCredit !== false;

const CREDIT = '<p class="hl-credit" style="max-width:860px;margin:0 auto;padding:0 24px 32px;font:12px system-ui,sans-serif;color:#6b6b78">Written with <a href="https://hashlite.io" style="color:inherit">Hashlite</a>, a free online Markdown editor.</p>';

export function buildStandaloneHtml(title, bodyHtml, { credit = false } = {}) {
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${APP_NAME}">
<title>${escapeHtml(title || 'Untitled')}</title>
<style>
:root { color-scheme: light; }
body { margin: 0; background: var(--bg); color: var(--text); }
${markdownCss}
.markdown-body .katex-html { display: none; } /* HTML math needs KaTeX's CSS; show the MathML copy */
.markdown-body .katex-display { display: block; text-align: center; }
.markdown-body math { font-size: 1.1em; }
</style>
</head>
<body>
<main class="markdown-body" style="max-width: 860px; margin: 0 auto; padding: 48px 24px;">
${bodyHtml}
</main>
${credit ? CREDIT : ''}
</body>
</html>
`;
}

export function exportHtml(title, bodyHtml) {
  downloadFile(`${safeFileName(title)}.html`, buildStandaloneHtml(title, bodyHtml, { credit: exportCredit() }), 'text/html;charset=utf-8');
}

const MD_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;

function isMarkdownFile(file) {
  return MD_EXT.test(file.name) || file.type === 'text/markdown' || file.type === 'text/plain';
}

/** Reads files and returns [{ title, content }]. Skips files that are not text/Markdown or too large. */
export async function readMarkdownFiles(files) {
  const out = [];
  for (const file of files) {
    if (!isMarkdownFile(file) || file.size > 5 * 1024 * 1024) continue;
    const content = await file.text();
    out.push({ title: frontMatterTitle(content) || file.name.replace(MD_EXT, '') || 'Imported', content });
  }
  return out;
}

export function pickMarkdownFiles() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain', multiple: true, style: 'display:none' });
    input.addEventListener('change', async () => {
      resolve(await readMarkdownFiles([...input.files]));
      input.remove();
    });
    // Closing the file chooser without picking anything.
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

/**
 * Puts a rendered document on the clipboard as formatted text (for Word, Google Docs or
 * email), with the Markdown as the plain-text version. Expects renderStandalone() output.
 */
export async function copyRichText(html, markdown) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([markdown], { type: 'text/plain' }),
      })]);
      return;
    } catch {
      // Not allowed here: try the older way.
    }
  }
  let copied = false;
  const onCopy = (e) => {
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', markdown);
    e.preventDefault();
    copied = true;
  };
  document.addEventListener('copy', onCopy);
  try {
    document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', onCopy);
  }
  if (!copied) throw new Error('Your browser did not allow copying.');
}

/** Prints a standalone page (see buildStandaloneHtml) from a hidden frame, so the page itself stays as it is. */
export function printStandalone(html) {
  const frame = h('iframe', { class: 'print-frame', title: 'Print preview', 'aria-hidden': 'true', tabindex: '-1' });
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  frame.srcdoc = html;
  frame.addEventListener('load', () => {
    const win = frame.contentWindow;
    const remove = () => setTimeout(() => frame.remove(), 500);
    win.addEventListener('afterprint', remove);
    setTimeout(() => frame.isConnected && frame.remove(), 5 * 60 * 1000); // browsers that never fire afterprint
    win.focus();
    win.print();
  }, { once: true });
  document.body.append(frame);
}
