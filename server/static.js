import { statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const ENCODINGS = [
  ['br', '.br'],
  ['gzip', '.gz'],
];
// Content types for the files the build pre-compresses.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

// Sends root/name, or its ".br"/".gz" sibling when there is one and the browser accepts it.
function send(req, res, root, name, cacheControl) {
  const headers = { 'Cache-Control': cacheControl };
  const type = TYPES[extname(name)];
  const variants = type ? ENCODINGS.filter(([, ext]) => isFile(join(root, name + ext))) : [];
  if (variants.length) headers.Vary = 'Accept-Encoding';
  const pick = variants.find(([encoding]) => req.acceptsEncodings(encoding) === encoding);
  if (pick) {
    headers['Content-Encoding'] = pick[0];
    headers['Content-Type'] = type;
  }
  res.sendFile(pick ? name + pick[1] : name, { root, headers, cacheControl: false, acceptRanges: !pick });
}

/**
 * Serves the built frontend's files. Hashed files under /assets/ are cached for a
 * year; everything else is revalidated on each load, so a deploy shows up at once.
 * HTML pages and extension-less paths are left to the site router (server/site.js),
 * which fills in the public URL. A missing file, such as an old chunk after a
 * redeploy, is a real 404 so the browser does not try to run a page as JavaScript.
 */
export function serveStatic(dir) {
  const root = resolve(dir);
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let path;
    try {
      path = decodeURIComponent(req.path);
    } catch {
      return res.sendStatus(400);
    }
    if (!extname(path) || extname(path) === '.html') return next();
    const file = resolve(root, `.${path}`);
    const safe = file.startsWith(root + sep) && !path.includes('\0') && !path.includes('/.');
    if (safe && isFile(file)) {
      return send(req, res, root, file.slice(root.length + 1), path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
    }
    res.sendStatus(404);
  };
}
