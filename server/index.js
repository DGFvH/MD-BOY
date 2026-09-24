import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { createAuth } from './auth.js';
import { createDocumentsRouter } from './documents.js';
import { createFoldersRouter } from './folders.js';
import { HttpError } from './errors.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

export function createApp({ db, cookieSecure = false, staticDir = join(ROOT, 'dist') } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);

  app.use((_req, res, next) => {
    res.set(SECURITY_HEADERS);
    next();
  });

  // CSRF protection: state-changing requests from a browser must come from our own origin.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && originHost(origin) !== req.headers.host) {
      return next(new HttpError(403, 'Cross-origin request blocked.'));
    }
    next();
  });

  app.use('/api', express.json({ limit: '5mb' }));
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const auth = createAuth(db, { cookieSecure });
  app.use('/api', auth.sessionMiddleware);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth.router);
  app.use('/api/docs', auth.requireUser, createDocumentsRouter(db));
  app.use('/api/folders', auth.requireUser, createFoldersRouter(db));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found.')));

  if (existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(staticDir, 'index.html')));
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
  const port = Number(process.env.PORT) || 3000;
  const dataDir = process.env.DATA_DIR || join(ROOT, 'data');
  const db = openDatabase(join(dataDir, 'md-boy.db'));
  const app = createApp({ db, cookieSecure: process.env.COOKIE_SECURE === '1' });
  app.listen(port, () => console.log(`MD-BOY running at http://localhost:${port}`));
}
