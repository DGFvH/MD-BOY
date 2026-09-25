// Build-time pieces of the public website: the page list, %PUBLIC_URL% filling,
// and the files crawlers look for (robots.txt, sitemap.xml, llms.txt).
// Used by vite.config.js; the site is hosted as static files.

// Public pages: URL -> built HTML file. Only these are listed in the sitemap.
export const PUBLIC_PAGES = [
  { path: '/', file: 'index.html', priority: '1.0' },
  { path: '/guide', file: 'guide/index.html', priority: '0.8' },
  { path: '/learn', file: 'learn/index.html', priority: '0.7' },
  ...['markdown-to-pdf', 'markdown-tables', 'markdown-math-and-diagrams', 'markdown-vs-rich-text'].map((slug) => ({
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
  return `# Hashlite

> Hashlite is a free online Markdown editor with a live preview. Documents are saved automatically to your account, with folders, full-text search, version history and export to Markdown, HTML, PDF or a zip of everything.

Hashlite runs in the browser on desktop and phone. It is open source; documents are stored with Supabase in the EU. There are no ads and no tracking.

## Pages

- [Home](${link('/')}): what Hashlite is, features and FAQ
- [Markdown cheat sheet](${link('/guide')}): a reference for Markdown syntax, from headings to tables, math and diagrams
- [Learn](${link('/learn')}): short guides
  - [How to convert Markdown to PDF](${link('/learn/markdown-to-pdf')})
  - [Markdown tables](${link('/learn/markdown-tables')})
  - [Math and diagrams in Markdown](${link('/learn/markdown-math-and-diagrams')})
  - [Markdown vs rich text](${link('/learn/markdown-vs-rich-text')})
- [Privacy](${link('/privacy')}): what is stored and how to export or delete it
- [Open the editor](${link('/app')}): sign up or sign in

## Features

- Split view with synchronized scrolling, or editor-only and preview-only
- GitHub-flavoured Markdown: tables, task lists, footnotes, autolinks, callouts (> [!NOTE])
- Syntax highlighting, KaTeX math, Mermaid diagrams, ==highlight==, :emoji: shortcodes, YAML front matter
- Autosave with offline drafts, conflict protection across tabs and devices
- Folders, full-text search, trash, version history with preview and restore
- Images by paste, drop or upload; read-only share links
- Import .md files; export .md, standalone .html, print to PDF, or download everything as .zip
- Colour themes (light, dark, sepia, high contrast), keyboard accessible

## Planned

- Chatting with AI models about your documents (bring your own API key)
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
