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

// The Vercel functions in api/, with vercel.json's rewrites for the OAuth discovery documents.
const FUNCTIONS = {
  '/api/mcp': '../api/mcp.js',
  '/api/account-mcp': '../api/account-mcp.js',
  '/api/oauth/register': '../api/oauth/register.js',
  '/api/oauth/token': '../api/oauth/token.js',
  '/api/oauth/metadata': '../api/oauth/metadata.js',
};

async function callFunction(req, res, url) {
  let path = url.pathname;
  if (path.startsWith('/.well-known/oauth-protected-resource')) {
    path = '/api/oauth/metadata';
    url.search = '?type=resource';
  } else if (path.startsWith('/.well-known/oauth-authorization-server')) {
    path = '/api/oauth/metadata';
    url.search = '?type=server';
  }
  const mod = await import(FUNCTIONS[path]);
  const fn = mod[req.method] ?? mod.handle;
  if (!fn) {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://${req.headers.host}${path}${url.search}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await fn(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (FUNCTIONS[url.pathname] || url.pathname.startsWith('/.well-known/oauth-')) {
    await callFunction(req, res, url).catch((err) => {
      console.error(err);
      res.writeHead(500).end();
    });
    return;
  }
  let path = decodeURIComponent(url.pathname);
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
