// Serves dist/ like the static hosts do (see client/public/_redirects):
// clean URLs, /app/* and /s/* rewrites, and 404.html for anything unknown.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const PORT = Number(process.env.PORT) || 3123;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const isFile = async (p) => (await stat(p).catch(() => null))?.isFile();

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.includes('..')) path = '/';
  if (/^\/app(\/|$)/.test(path)) path = '/app/index.html';
  else if (/^\/s\//.test(path)) path = '/s/index.html';
  let file = join(ROOT, normalize(path));
  if (!(await isFile(file))) file = join(file, 'index.html');
  let status = 200;
  if (!(await isFile(file))) {
    file = join(ROOT, '404.html');
    status = 404;
  }
  res.writeHead(status, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
}).listen(PORT, () => console.log(`dist/ on http://localhost:${PORT}`));
