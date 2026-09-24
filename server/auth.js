import { Router } from 'express';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './errors.js';

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = 'hashmark_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Simple fixed-window limiter, per key, kept in memory.
function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}

export function createAuth(db, { cookieSecure = false } = {}) {
  const stmts = {
    userByEmail: db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(
      `SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };
  const allowAttempt = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

  function setSessionCookie(res, token) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  function startSession(res, userId) {
    const token = randomBytes(32).toString('base64url');
    stmts.insertSession.run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
    setSessionCookie(res, token);
  }

  function readCredentials(body) {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Please enter a valid email address.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (password.length > 256) throw new HttpError(400, 'Password is too long.');
    return { email, password };
  }

  /** Attaches req.user when a valid session cookie is present. */
  function sessionMiddleware(req, _res, next) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    req.sessionToken = token;
    req.user = token ? stmts.sessionUser.get(hashToken(token), Date.now()) ?? null : null;
    next();
  }

  function requireUser(req, _res, next) {
    if (!req.user) return next(new HttpError(401, 'Please sign in.'));
    next();
  }

  const router = Router();

  router.post('/register', async (req, res) => {
    if (!allowAttempt(`reg:${req.ip}`)) throw new HttpError(429, 'Too many attempts. Try again later.');
    const { email, password } = readCredentials(req.body);
    if (stmts.userByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists.');
    const hash = await hashPassword(password);
    const { lastInsertRowid } = stmts.insertUser.run(email, hash);
    startSession(res, Number(lastInsertRowid));
    res.status(201).json({ user: { id: Number(lastInsertRowid), email } });
  });

  router.post('/login', async (req, res) => {
    const { email, password } = readCredentials(req.body);
    if (!allowAttempt(`login:${req.ip}:${email}`)) throw new HttpError(429, 'Too many attempts. Try again later.');
    const user = stmts.userByEmail.get(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) throw new HttpError(401, 'Incorrect email or password.');
    stmts.purgeSessions.run(Date.now());
    startSession(res, user.id);
    res.json({ user: { id: user.id, email: user.email } });
  });

  router.post('/logout', (req, res) => {
    if (req.sessionToken) stmts.deleteSession.run(hashToken(req.sessionToken));
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    if (!req.user) throw new HttpError(401, 'Please sign in.');
    res.json({ user: req.user });
  });

  return { router, sessionMiddleware, requireUser };
}
