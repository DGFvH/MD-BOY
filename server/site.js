// The public website: landing page, guide and privacy pages, the app shell at
// /app, and the files crawlers look for (robots.txt, sitemap.xml, llms.txt).
import { Router } from 'express';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

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
  return `# Hashmark

> Hashmark is a free online Markdown editor with a live preview. Documents are saved automatically to your account, with folders, full-text search, version history and export to Markdown, HTML, PDF or a zip of everything.

Hashmark runs in the browser on desktop and phone. It is open source and can be self-hosted (Node.js and SQLite, or Docker). There are no ads and no tracking.

## Pages

- [Home](${link('/')}): what Hashmark is, features and FAQ
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

export function createSite({ staticDir, publicUrl = '', sessionMiddleware }) {
  const base = normalizePublicUrl(publicUrl);
  const cache = new Map();

  // Built pages, with the public URL filled in and compressed once.
  function page(file) {
    const path = join(staticDir, file);
    const mtime = statSync(path, { throwIfNoEntry: false })?.mtimeMs;
    if (mtime === undefined) return null;
    let entry = cache.get(file);
    if (!entry || entry.mtime !== mtime) {
      const html = Buffer.from(applyPublicUrl(readFileSync(path, 'utf8'), base));
      entry = {
        mtime,
        html,
        br: brotliCompressSync(html, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }),
        gz: gzipSync(html, { level: 9 }),
      };
      cache.set(file, entry);
    }
    return entry;
  }

  function sendPage(req, res, file, { status = 200, noindex = false } = {}) {
    const entry = page(file);
    if (!entry) return res.status(status === 200 ? 404 : status).type('text/plain').send('Not found');
    res.status(status).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' });
    if (noindex) res.set('X-Robots-Tag', 'noindex');
    const encoding = req.acceptsEncodings('br', 'gzip');
    if (encoding === 'br' || encoding === 'gzip') {
      res.set('Content-Encoding', encoding);
      return res.send(encoding === 'br' ? entry.br : entry.gz);
    }
    res.send(entry.html);
  }

  // strict: '/guide/' must not match '/guide', so it can redirect to the clean URL.
  const router = Router({ strict: true });

  // Signed-in people go straight to their documents; crawlers have no cookie.
  router.get('/', sessionMiddleware, (req, res) => {
    if (req.user) return res.redirect(302, '/app');
    sendPage(req, res, 'index.html');
  });
  for (const p of PUBLIC_PAGES.slice(1)) {
    router.get(p.path, (req, res) => sendPage(req, res, p.file));
    router.get(`${p.path}/`, (_req, res) => res.redirect(301, p.path));
  }
  // Direct requests for the built HTML files go to their clean URLs.
  router.get('/index.html', (_req, res) => res.redirect(301, '/'));
  for (const p of PUBLIC_PAGES.slice(1)) router.get(`${p.path}/index.html`, (_req, res) => res.redirect(301, p.path));

  // The editor. Its routes live after the '#', so any /app/... path gets the same shell.
  router.get(['/app', '/app/', /^\/app\/.*/], (req, res) => sendPage(req, res, 'app/index.html', { noindex: true }));
  router.get('/404.html', (req, res) => sendPage(req, res, '404.html', { status: 404, noindex: true }));

  router.get('/robots.txt', (_req, res) => {
    const lines = ['User-agent: *', 'Allow: /', 'Disallow: /app', 'Disallow: /api/', 'Disallow: /s/', 'Disallow: /i/'];
    if (base) lines.push('', `Sitemap: ${base}/sitemap.xml`);
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(`${lines.join('\n')}\n`);
  });

  router.get('/sitemap.xml', (_req, res) => {
    if (!base) return res.status(404).type('text/plain').send('Set PUBLIC_URL to publish a sitemap.');
    // Only pages that were built.
    const built = PUBLIC_PAGES.map((p) => ({ ...p, mtime: statSync(join(staticDir, p.file), { throwIfNoEntry: false })?.mtime }))
      .filter((p) => p.mtime);
    const urls = built.map((p) => {
      const lastmod = `<lastmod>${p.mtime.toISOString().slice(0, 10)}</lastmod>`;
      return `  <url><loc>${base}${p.path === '/' ? '/' : p.path}</loc>${lastmod}<priority>${p.priority}</priority></url>`;
    });
    res.type('application/xml').set('Cache-Control', 'public, max-age=3600')
      .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
  });

  router.get('/llms.txt', (_req, res) => {
    res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(llmsTxt(base));
  });

  /** Last handler: a friendly 404 page for anything unknown. */
  const notFoundPage = (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(404).type('text/plain').send('Not found');
    sendPage(req, res, '404.html', { status: 404, noindex: true });
  };

  return { router, notFoundPage };
}
