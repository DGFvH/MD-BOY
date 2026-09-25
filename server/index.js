import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseFile, openDatabase } from './db.js';
import { createAuth } from './auth.js';
import { createDocumentsRouter } from './documents.js';
import { createFoldersRouter } from './folders.js';
import { createExportRouter } from './export.js';
import { serveStatic } from './static.js';
import { createSite } from './site.js';
import { createImagesRouter, createImageServer } from './images.js';
import { createShareRouter, createSharePage } from './share.js';
import { HttpError } from './errors.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MAX_USER_BYTES = 100 * 1024 * 1024;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    'img-src * data: blob:',
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

function originHost(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return null; // e.g. "null" from sandboxed frames
  }
}

// CSRF protection: state-changing API requests from a browser must come from our
// own origin. Browsers send Sec-Fetch-Site, which proxies pass through unchanged.
// Older browsers only send Origin, which is compared with the host the browser
// used: req.host follows X-Forwarded-Host when TRUST_PROXY is set.
function isSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.origin;
  if (!origin) return true; // not a browser (curl, scripts)
  const host = originHost(origin);
  return host !== null && (host === req.host || host === req.headers.host);
}

// TRUST_PROXY: a number of proxy hops ("1"), or the proxies' addresses or subnets
// ("127.0.0.1", "loopback, 10.0.0.0/8"). Unset, "0" or "false" trusts no proxy.
// "true" trusts every hop: only safe when clients can reach the app solely
// through the proxy, since anyone else could fake X-Forwarded-For and -Proto.
export function parseTrustProxy(value) {
  const v = value?.trim().toLowerCase();
  if (!v || v === '0' || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

export function createApp({
  db,
  cookieSecure = false,
  staticDir = join(ROOT, 'dist'),
  trustProxy = false,
  allowRegistration = true,
  maxUserBytes = DEFAULT_MAX_USER_BYTES,
  publicUrl = '',
  limits,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    res.set(SECURITY_HEADERS);
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || isSameOrigin(req)) return next();
    next(new HttpError(403, 'Cross-origin request blocked.'));
  });

  app.use('/api', express.json({ limit: '5mb' }));
  app.use('/api', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
    next();
  });

  const auth = createAuth(db, { cookieSecure, allowRegistration, limits });
  app.use('/api', auth.sessionMiddleware);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/config', (_req, res) => res.json({ registration: allowRegistration }));
  app.use('/api/auth', auth.router);
  app.use('/api/docs', auth.requireUser, createDocumentsRouter(db, { maxUserBytes }));
  app.use('/api/folders', auth.requireUser, createFoldersRouter(db));
  app.use('/api/export', auth.requireUser, createExportRouter(db));
  app.use('/api/images', auth.requireUser, createImagesRouter(db, { maxUserBytes }));
  app.use('/api/docs', auth.requireUser, createShareRouter(db));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  app.get('/i/:id', createImageServer(db));
  app.get('/s/:token', createSharePage(db));

  if (existsSync(staticDir)) {
    const site = createSite({ staticDir, publicUrl, sessionMiddleware: auth.sessionMiddleware });
    app.use(site.router);
    app.use(serveStatic(staticDir));
    app.use(site.notFoundPage);
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status ?? err.statusCode ?? 500;
    let message = err.message;
    if (err.type === 'entity.too.large') message = 'Document is too large (max 5 MB).';
    else if (err.type === 'entity.parse.failed') message = 'Invalid JSON.';
    else if (status >= 500) {
      console.error(err);
      status = 500;
      message = 'Something went wrong on the server.';
    }
    const body = { error: message };
    if (err.current) body.current = err.current;
    res.status(status).json(body);
  });

  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const port = Number(env.PORT) || 3000;
  const host = env.HOST || undefined;
  const db = openDatabase(databaseFile(env));
  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy === true) {
    console.warn('TRUST_PROXY=true trusts every proxy hop: only safe when the app can be reached solely ' +
      'through your proxy. Prefer a hop count such as TRUST_PROXY=1.');
  }
  const app = createApp({
    db,
    cookieSecure: env.COOKIE_SECURE === '1',
    trustProxy,
    allowRegistration: env.ALLOW_REGISTRATION !== '0',
    maxUserBytes: /^\d+$/.test(env.MAX_USER_BYTES ?? '') ? Number(env.MAX_USER_BYTES) : DEFAULT_MAX_USER_BYTES,
    publicUrl: env.PUBLIC_URL,
  });
  const server = app.listen(port, host, (err) => {
    if (err) throw err;
    console.log(`Hashlite running at http://${host ?? 'localhost'}:${port}`);
  });

  // On SIGTERM (docker stop, redeploys) or Ctrl+C: finish open requests, such as
  // the save a closing tab sends, then close the database. Without a handler,
  // Node running as PID 1 in a container would ignore SIGTERM.
  const shutdown = () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
    server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
