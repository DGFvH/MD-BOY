import express, { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { HttpError } from './errors.js';
import { formatBytes } from './documents.js';

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// The type comes from the file's first bytes, never from the browser. SVG is not
// accepted: it can carry scripts.
export function sniffImage(buf) {
  const starts = (...bytes) => bytes.every((b, i) => buf[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (buf.subarray(0, 6).toString('latin1').match(/^GIF8[79]a$/)) return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

/** POST /api/images (signed in): the raw file as the request body. Returns { url }. */
export function createImagesRouter(db, { maxUserBytes = 0 } = {}) {
  const s = {
    insert: db.prepare('INSERT INTO images (id, user_id, mime, bytes, data) VALUES (?, ?, ?, ?, ?)'),
    usage: db.prepare('SELECT content_bytes FROM users WHERE id = ?'),
  };
  const router = Router();
  router.post('/', express.raw({ type: () => true, limit: MAX_IMAGE_BYTES }), (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const mime = data.length ? sniffImage(data) : null;
    if (!mime) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images can be uploaded.');
    if (maxUserBytes && s.usage.get(req.user.id).content_bytes + data.length > maxUserBytes) {
      throw new HttpError(413, `Storage limit reached: your documents and images can use up to ${formatBytes(maxUserBytes)}.`);
    }
    const id = randomBytes(16).toString('base64url');
    s.insert.run(id, req.user.id, mime, data.length, data);
    res.status(201).json({ url: `/i/${id}` });
  });
  return router;
}

/** GET /i/:id: public, cached for a year (an image never changes under its id). */
export function createImageServer(db) {
  const get = db.prepare('SELECT mime, data FROM images WHERE id = ?');
  return (req, res) => {
    const row = /^[\w-]{22}$/.test(req.params.id) ? get.get(req.params.id) : null;
    if (!row) return res.status(404).set('X-Robots-Tag', 'noindex').type('text/plain').send('Not found');
    res.set({
      'Content-Type': row.mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.send(Buffer.from(row.data));
  };
}
