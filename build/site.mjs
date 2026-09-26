// Build-time pieces of the public website: the page list, %PUBLIC_URL% filling,
// and the files crawlers look for (robots.txt, sitemap.xml, llms.txt).
// Used by vite.config.js; the site is hosted as static files.

import { TOOLS } from './tools.mjs';

// Public pages: URL -> built HTML file. Only these are listed in the sitemap.
export const PUBLIC_PAGES = [
  { path: '/', file: 'index.html', priority: '1.0' },
  { path: '/tools', file: 'tools/index.html', priority: '0.8' },
  { path: '/connect', file: 'connect/index.html', priority: '0.6' },
  ...TOOLS.map((t) => ({ path: `/${t.slug}`, file: `${t.slug}/index.html`, priority: '0.8' })),
  { path: '/guide', file: 'guide/index.html', priority: '0.8' },
  { path: '/learn', file: 'learn/index.html', priority: '0.7' },
  ...['ai-chat-to-document', 'markdown-to-pdf', 'markdown-tables', 'markdown-math-and-diagrams', 'markdown-vs-rich-text'].map((slug) => ({
    path: `/learn/${slug}`, file: `learn/${slug}/index.html`, priority: '0.7',
  })),
  { path: '/privacy', file: 'privacy/index.html', priority: '0.3' },
];

/**
 * Fills in the %PUBLIC_URL% placeholder. Without a public URL, <link> and <meta>
 * tags that need an absolute address (canonical, og:url, og:image) are dropped
 * rather than written wrong, and other uses become relative.
 */
export function applyPublicUrl(html, publicUrl) {
  if (publicUrl) return html.replaceAll('%PUBLIC_URL%', publicUrl);
  return html
    .replace(/^[ \t]*<(?:link|meta)\b[^>]*%PUBLIC_URL%[^>]*>[ \t]*\r?\n?/gm, '')
    .replaceAll('%PUBLIC_URL%', '');
}

/** "https://example.com/" -> "https://example.com"; invalid values are ignored. */
export function normalizePublicUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.href.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function llmsTxt(base) {
  const link = (path) => `${base}${path}`;
  const home = `${base || 'https://hashlite.io'}/`;
  return `# Hashlite

> Hashlite (${home}) is a free online Markdown editor and viewer with a live preview. It opens straight into the editor, with no sign-up: write or paste Markdown, see it formatted, and export it as PDF, HTML or .md, or copy it as formatted text into Word, Google Docs or email.

Hashlite runs in the browser on desktop and phone. It is free, with no ads; analytics cookies are only set with the visitor's consent. Without an account, text stays in the browser. A free account (email and password, stored in the EU) adds cloud autosave, folders, full-text search, version history, image uploads and read-only share links.

## Good fit for

- Viewing, fixing and exporting Markdown written by an AI assistant: headings, tables, code, KaTeX math and Mermaid diagrams render as they do in the chat
- Turning Markdown into a PDF, or into formatted text for Word, Google Docs or an email, without installing anything
- A quick online Markdown editor or previewer that works immediately, with no account
- Keeping Markdown notes and documents organised, with version history (free account)

## Open Markdown directly in the editor

Link to \`${home}#text=\` followed by the URL-encoded Markdown (for example, the output of encodeURIComponent). The page opens with that text in the editor and the rendered preview next to it. The text is read from the URL fragment, so it is never sent to a server. Very long documents are better pasted or opened as a .md file.

## Connector (MCP server)

Hashlite runs a public remote MCP server at \`${base || 'https://hashlite.io'}/api/mcp\` (Streamable HTTP, no authentication). Its tools: \`open_in_hashlite\` (returns a link that opens a Markdown document in the editor), \`csv_to_markdown_table\` and \`list_hashlite_tools\`. Setup: ${link('/connect')}

## What works without an account

- Editor with toolbar and keyboard shortcuts; split view, editor-only and preview-only
- GitHub-flavoured Markdown: tables, task lists, footnotes, autolinks, callouts (> [!NOTE]), ==highlight==, :emoji:
- Syntax highlighting, KaTeX math ($...$ and $$...$$), Mermaid diagrams, YAML front matter
- Open .md files; download .md or standalone .html; print or save as PDF; copy as formatted text
- Colour themes: light, dark, sepia, high contrast

## Free tools (each opens the editor set up for one job, no sign-up)

${TOOLS.map((t) => `- [${t.h1}](${link(`/${t.slug}`)}): ${t.description}`).join('\n')}

## Pages

- [Editor and overview](${link('/')}): the editor, features and FAQ
- [How to turn an AI chat answer into a document](${link('/learn/ai-chat-to-document')})
- [Markdown cheat sheet](${link('/guide')}): Markdown syntax from headings to tables, math and diagrams
- [How to convert Markdown to PDF](${link('/learn/markdown-to-pdf')})
- [Markdown tables](${link('/learn/markdown-tables')})
- [Math and diagrams in Markdown](${link('/learn/markdown-math-and-diagrams')})
- [Markdown vs rich text](${link('/learn/markdown-vs-rich-text')})
- [Privacy](${link('/privacy')}): what is stored and how to export or delete it
`;
}

export function robotsTxt(base) {
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /app', 'Disallow: /s/'];
  if (base) lines.push('', `Sitemap: ${base}/sitemap.xml`);
  return `${lines.join('\n')}\n`;
}

export function sitemapXml(base, date = new Date()) {
  const lastmod = date.toISOString().slice(0, 10);
  const urls = PUBLIC_PAGES.map((p) => `  <url><loc>${base}${p.path}</loc><lastmod>${lastmod}</lastmod><priority>${p.priority}</priority></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
