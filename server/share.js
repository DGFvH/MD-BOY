import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { notFound } from './errors.js';
import { escapeHtml, renderMarkdownToHtml } from './render.js';

// The same colours and Markdown styles as the app and the HTML export.
const MARKDOWN_CSS = readFileSync(fileURLToPath(new URL('../client/src/markdown.css', import.meta.url)), 'utf8');

/** POST/DELETE /api/docs/:id/share (signed in): turn the read-only link on or off. */
export function createShareRouter(db) {
  const s = {
    get: db.prepare('SELECT id, share_token FROM documents WHERE id = ? AND user_id = ? AND deleted_at IS NULL'),
    set: db.prepare('UPDATE documents SET share_token = ? WHERE id = ? AND user_id = ?'),
  };
  const router = Router();
  router.post('/:id/share', (req, res) => {
    const doc = s.get.get(req.params.id, req.user.id);
    if (!doc) throw notFound('Document not found.');
    const token = doc.share_token ?? randomBytes(16).toString('base64url');
    if (!doc.share_token) s.set.run(token, doc.id, req.user.id);
    res.json({ token, url: `/s/${token}` });
  });
  router.delete('/:id/share', (req, res) => {
    const doc = s.get.get(req.params.id, req.user.id);
    if (!doc) throw notFound('Document not found.');
    s.set.run(null, doc.id, req.user.id);
    res.json({ ok: true });
  });
  return router;
}

function sharePage(doc, bodyHtml) {
  const title = escapeHtml(doc.title || 'Untitled');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>${title} · Hashlite</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--font-ui); }
${MARKDOWN_CSS}
.markdown-body math { font-size: 1.1em; }
.share-foot { max-width: 860px; margin: 0 auto; padding: 0 24px 40px; color: var(--text-muted); font-size: 14px; }
.share-foot a { color: var(--md-link); }
</style>
</head>
<body>
<main class="markdown-body" style="max-width: 860px; margin: 0 auto; padding: 48px 24px 32px;">
${bodyHtml}
</main>
<footer class="share-foot">Last updated ${escapeHtml(doc.updated_at.slice(0, 10))} · Written with <a href="/">Hashlite</a>, a free online Markdown editor.</footer>
</body>
</html>
`;
}

/** GET /s/:token: the shared document as a plain, read-only page. */
export function createSharePage(db) {
  const get = db.prepare('SELECT title, content, updated_at FROM documents WHERE share_token = ? AND deleted_at IS NULL');
  return (req, res) => {
    const doc = /^[\w-]{22}$/.test(req.params.token) ? get.get(req.params.token) : null;
    res.set({ 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer' });
    if (!doc) return res.status(404).type('text/plain').send('This link is not shared (any more).');
    res.type('html').send(sharePage(doc, renderMarkdownToHtml(doc.content)));
  };
}
