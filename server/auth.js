import { Router } from 'express';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './errors.js';

const scryptAsync = promisify(scrypt);
const SESSION_COOKIE = 'hashmark_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, renewed while the session is in use
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Attempts allowed per 15 minutes.
export const DEFAULT_LIMITS = {
  register: 20, // per client address
  login: 20, // per client address and email
  loginPerIp: 100, // per client address, across all emails (stops password spraying)
  loginFailuresPerEmail: 50, // failed logins per email, across all addresses
  passwordChecks: 10, // wrong passwords per signed-in user (change password, delete account)
};

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

// Reads only our own cookie. Other cookies on the same domain are ignored, even
// malformed ones. The token is base64url, so it never needs decoding.
function readSessionCookie(header = '') {
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE) {
      const value = part.slice(i + 1).trim();
      if (/^[\w-]{1,128}$/.test(value)) return value;
    }
  }
  return undefined;
}

// Rate-limit key for a client address. IPv6 clients usually control a whole /64.
export function addressKey(ip = '') {
  if (!ip.includes(':')) return ip;
  if (/^::ffff:[\d.]+$/i.test(ip)) return ip.slice(7);
  const [head, tail] = ip.toLowerCase().split('%')[0].split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b];
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// Fixed-window counters kept in memory. Expired entries are swept on a timer and
// the map has a size cap (oldest dropped first), so each request does O(1) work.
function createRateLimiter(windowMs, maxKeys = 50_000) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }, windowMs).unref();
  const live = (key) => {
    const entry = hits.get(key);
    return entry && entry.reset > Date.now() ? entry : null;
  };
  return {
    /** Counts one attempt; false once the key is over `max`. */
    hit(key, max) {
      let entry = live(key);
      if (!entry) {
        hits.delete(key);
        if (hits.size >= maxKeys) hits.delete(hits.keys().next().value);
        entry = { count: 0, reset: Date.now() + windowMs };
        hits.set(key, entry);
      }
      entry.count += 1;
      return entry.count <= max;
    },
    /** True when the key has used up `max` attempts, without counting one. */
    blocked(key, max) {
      return (live(key)?.count ?? 0) >= max;
    },
  };
}

export function createAuth(db, { cookieSecure = false, allowRegistration = true, limits = {} } = {}) {
  const max = { ...DEFAULT_LIMITS, ...limits };
  const stmts = {
    userByEmail: db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?'),
    userById: db.prepare('SELECT id, email, password_hash FROM users WHERE id = ?'),
    insertUser: db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)'),
    setPassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(
      `SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    ),
    renewSession: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };
  const limiter = createRateLimiter(LIMIT_WINDOW_MS);
  const tooMany = () => new HttpError(429, 'Too many attempts. Try again later.');

  const purgeSessions = () => {
    try {
      stmts.purgeSessions.run(Date.now());
    } catch {
      // Best effort (e.g. the database was closed on shutdown); retried next hour.
    }
  };
  setInterval(purgeSessions, 60 * 60 * 1000).unref();

  // Secure when configured, or when the request came over HTTPS (seen through TRUST_PROXY).
  function setSessionCookie(req, res, token) {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure || req.secure,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
  }

  function startSession(req, res, userId) {
    const token = randomBytes(32).toString('base64url');
    stmts.insertSession.run(hashToken(token), userId, Date.now() + SESSION_TTL_MS);
    setSessionCookie(req, res, token);
  }

  function checkNewPassword(password) {
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    if (password.length > 256) throw new HttpError(400, 'Password is too long.');
  }

  function readCredentials(body) {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Please enter a valid email address.');
    checkNewPassword(password);
    return { email, password };
  }

  // Re-checks the signed-in user's password before a sensitive change. A wrong
  // password is a 400, not a 401, which the client treats as "session expired".
  async function confirmPassword(userId, password, message) {
    const key = `confirm:${userId}`;
    if (limiter.blocked(key, max.passwordChecks)) throw tooMany();
    const user = stmts.userById.get(userId);
    const valid = typeof password === 'string' && password.length <= 256 && user;
    const ok = valid ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) {
      limiter.hit(key, max.passwordChecks);
      throw new HttpError(400, message);
    }
  }

  /** Attaches req.user when a valid session cookie is present, and slides its expiry. */
  function sessionMiddleware(req, res, next) {
    const token = readSessionCookie(req.headers.cookie);
    req.sessionToken = token;
    req.user = null;
    if (token) {
      const now = Date.now();
      const tokenHash = hashToken(token);
      const row = stmts.sessionUser.get(tokenHash, now);
      if (row) {
        req.user = { id: row.id, email: row.email };
        // Renew once less than half the lifetime is left, so active users stay signed in.
        if (row.expires_at - now < SESSION_TTL_MS / 2) {
          stmts.renewSession.run(now + SESSION_TTL_MS, tokenHash);
          setSessionCookie(req, res, token);
        }
      }
    }
    next();
  }

  function requireUser(req, _res, next) {
    if (!req.user) return next(new HttpError(401, 'Please sign in.'));
    next();
  }

  const router = Router();

  router.post('/register', async (req, res) => {
    if (!allowRegistration) throw new HttpError(403, 'Creating new accounts is turned off on this server.');
    if (!limiter.hit(`reg:${addressKey(req.ip)}`, max.register)) throw tooMany();
    const { email, password } = readCredentials(req.body);
    const exists = () => new HttpError(409, 'An account with this email already exists.');
    if (stmts.userByEmail.get(email)) throw exists();
    const hash = await hashPassword(password);
    let id;
    try {
      id = Number(stmts.insertUser.run(email, hash).lastInsertRowid);
    } catch (err) {
      if (err.errcode === 2067) throw exists(); // SQLITE_CONSTRAINT_UNIQUE: a parallel sign-up won
      throw err;
    }
    startSession(req, res, id);
    res.status(201).json({ user: { id, email } });
  });

  router.post('/login', async (req, res) => {
    const { email, password } = readCredentials(req.body);
    const ip = addressKey(req.ip);
    const failuresKey = `login-fail:${email}`;
    if (
      !limiter.hit(`login-ip:${ip}`, max.loginPerIp) ||
      !limiter.hit(`login:${ip}:${email}`, max.login) ||
      limiter.blocked(failuresKey, max.loginFailuresPerEmail)
    ) {
      throw tooMany();
    }
    const user = stmts.userByEmail.get(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : false;
    if (!ok) {
      limiter.hit(failuresKey, max.loginFailuresPerEmail);
      throw new HttpError(401, 'Incorrect email or password.');
    }
    purgeSessions();
    startSession(req, res, user.id);
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

  // Changes the password, keeps this session and signs out every other one.
  router.post('/password', requireUser, async (req, res) => {
    const next = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    checkNewPassword(next);
    await confirmPassword(req.user.id, req.body?.current_password, 'Current password is incorrect.');
    stmts.setPassword.run(await hashPassword(next), req.user.id);
    stmts.deleteOtherSessions.run(req.user.id, hashToken(req.sessionToken));
    res.json({ ok: true });
  });

  // Deletes the account; sessions, folders, documents and revisions go with it (ON DELETE CASCADE).
  router.delete('/account', requireUser, async (req, res) => {
    await confirmPassword(req.user.id, req.body?.password, 'Password is incorrect.');
    stmts.deleteUser.run(req.user.id);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  return { router, sessionMiddleware, requireUser };
}
