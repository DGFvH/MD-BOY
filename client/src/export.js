// Import and export: Markdown files, standalone HTML and print-to-PDF.
import markdownCss from './markdown.css?raw';
import { APP_NAME } from './brand.js';
import { downloadFile, escapeHtml, h } from './ui.js';
import { frontMatterTitle } from './render/front-matter.js';

export function safeFileName(title) {
  return (title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';
}

export function exportMarkdown(title, content) {
  downloadFile(`${safeFileName(title)}.md`, content, 'text/markdown;charset=utf-8');
}

/**
 * A self-contained page: no external CSS, fonts or scripts. Expects the body from
 * preview.renderStandalone() (math as MathML, light-theme diagrams), so it is always light.
 */
export function buildStandaloneHtml(title, bodyHtml) {
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
</body>
</html>
`;
}

export function exportHtml(title, bodyHtml) {
  downloadFile(`${safeFileName(title)}.html`, buildStandaloneHtml(title, bodyHtml), 'text/html;charset=utf-8');
}

export function printDocument() {
  window.print();
}

const MD_EXT = /\.(md|markdown|mdown|mkd|txt)$/i;

export function isMarkdownFile(file) {
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
    document.body.append(input);
    input.click();
  });
}
