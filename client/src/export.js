// Import and export: Markdown files, standalone HTML and print-to-PDF.
import markdownCss from './markdown.css?raw';
import { APP_NAME } from './brand.js';
import { downloadFile, escapeHtml, h } from './ui.js';
import katexPkg from 'katex/package.json';

export function safeFileName(title) {
  return (title || 'Untitled').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Untitled';
}

export function exportMarkdown(title, content) {
  downloadFile(`${safeFileName(title)}.md`, content, 'text/markdown;charset=utf-8');
}

export function buildStandaloneHtml(title, bodyHtml) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${APP_NAME}">
<title>${escapeHtml(title || 'Untitled')}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${katexPkg.version}/dist/katex.min.css">
<style>
:root { color-scheme: light dark; }
body { margin: 0; background: var(--bg); color: var(--text); }
${markdownCss}
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
    out.push({ title: file.name.replace(MD_EXT, '') || 'Imported', content: await file.text() });
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
