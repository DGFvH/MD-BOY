import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { HttpError, notFound } from './errors.js';
import { transaction } from './db.js';

const REVISION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_REVISIONS = 200;
const MAX_TITLE = 200;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const META_COLUMNS = 'id, folder_id, title, version, created_at, updated_at, deleted_at';

function cleanTitle(title) {
  if (title === undefined) return undefined;
  if (typeof title !== 'string') throw new HttpError(400, 'Title must be text.');
  return title.trim().slice(0, MAX_TITLE) || 'Untitled';
}

function cleanContent(content) {
  if (content === undefined) return undefined;
  if (typeof content !== 'string') throw new HttpError(400, 'Content must be text.');
  return content;
}

// Turns free text into a safe FTS5 query: every word becomes a quoted prefix term.
function toFtsQuery(q) {
  const terms = q.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return terms.slice(0, 12).map((t) => `"${t}"*`).join(' ');
}

export function formatBytes(n) {
  return n >= 1024 * 1024 ? `${+(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}

/**
 * Picks the revisions to delete (given newest first): everything from the last
 * day is kept, then the newest one per hour for a week, then the newest one per
 * day, and never more than MAX_REVISIONS in total.
 */
export function revisionsToPrune(revisions, now = Date.now()) {
  const seen = new Set();
  const drop = [];
  for (const r of revisions) {
    const time = Date.parse(r.created_at);
    const age = now - time;
    let bucket = `r${r.id}`;
    if (age >= 7 * DAY) bucket = `d${Math.floor(time / DAY)}`;
    else if (age >= DAY) bucket = `h${Math.floor(time / HOUR)}`;
    if (seen.has(bucket) || seen.size >= MAX_REVISIONS) drop.push(r.id);
    else seen.add(bucket);
  }
  return drop;
}

export function createDocumentsRouter(db, { maxUserBytes = 0 } = {}) {
  const s = {
    list: db.prepare(
      `SELECT ${META_COLUMNS} FROM documents
       WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
    ),
    listTrash: db.prepare(
      `SELECT ${META_COLUMNS} FROM documents
       WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    ),
    // Matches are marked with \u0002 ... \u0003, which do not occur in normal text.
    search: db.prepare(
      `SELECT d.id, d.folder_id, d.title, d.version, d.created_at, d.updated_at, d.deleted_at,
              snippet(documents_fts, 1, char(2), char(3), '…', 16) AS excerpt
       FROM documents_fts JOIN documents d ON d.rowid = documents_fts.rowid
       WHERE documents_fts MATCH ? AND d.user_id = ? AND d.deleted_at IS NULL
       ORDER BY rank LIMIT 100`,
    ),
    get: db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?'),
    insert: db.prepare('INSERT INTO documents (id, user_id, folder_id, title, content) VALUES (?, ?, ?, ?, ?)'),
    update: db.prepare(
      `UPDATE documents SET title = ?, content = ?, folder_id = ?, version = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    ),
    trash: db.prepare(
      `UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`,
    ),
    restore: db.prepare('UPDATE documents SET deleted_at = NULL WHERE id = ? AND user_id = ?'),
    remove: db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?'),
    emptyTrash: db.prepare('DELETE FROM documents WHERE user_id = ? AND deleted_at IS NOT NULL'),
    folderOwned: db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?'),
    usage: db.prepare('SELECT content_bytes FROM users WHERE id = ?'),
    lastRevisionAt: db.prepare('SELECT created_at FROM revisions WHERE document_id = ? ORDER BY id DESC LIMIT 1'),
    lastRevision: db.prepare('SELECT id, content FROM revisions WHERE document_id = ? ORDER BY id DESC LIMIT 1'),
    insertRevision: db.prepare('INSERT INTO revisions (document_id, title, content) VALUES (?, ?, ?)'),
    revisionTimes: db.prepare('SELECT id, created_at FROM revisions WHERE document_id = ? ORDER BY id DESC'),
    deleteRevision: db.prepare('DELETE FROM revisions WHERE id = ?'),
    listRevisions: db.prepare(
      'SELECT id, title, length(content) AS size, created_at FROM revisions WHERE document_id = ? ORDER BY id DESC',
    ),
    getRevision: db.prepare('SELECT id, title, content, created_at FROM revisions WHERE id = ? AND document_id = ?'),
  };

  function loadDoc(id, userId) {
    const doc = s.get.get(id, userId);
    if (!doc) throw notFound('Document not found.');
    return doc;
  }

  function checkFolder(folderId, userId) {
    if (folderId === undefined) return undefined;
    if (folderId === null) return null;
    if (!Number.isInteger(folderId) || !s.folderOwned.get(folderId, userId)) {
      throw new HttpError(400, 'Folder does not exist.');
    }
    return folderId;
  }

  // Refuses changes that would take the user over their storage limit. Shrinking is always allowed.
  function checkQuota(userId, before, after) {
    if (!maxUserBytes) return;
    const growth = Buffer.byteLength(after) - Buffer.byteLength(before);
    if (growth <= 0) return;
    if (s.usage.get(userId).content_bytes + growth > maxUserBytes) {
      throw new HttpError(
        413,
        `Storage limit reached: your documents can use up to ${formatBytes(maxUserBytes)}. ` +
          'Delete some documents or empty the trash to make room.',
      );
    }
  }

  function addRevision(doc) {
    const last = s.lastRevision.get(doc.id);
    if (last && last.content === doc.content) return;
    s.insertRevision.run(doc.id, doc.title, doc.content);
    for (const id of revisionsToPrune(s.revisionTimes.all(doc.id))) s.deleteRevision.run(id);
  }

  /**
   * Applies a patch. The version check only applies when content is sent, and
   * the version only goes up when the content changes, so renames and moves
   * never conflict with an edit in another tab.
   * History keeps the text being replaced when a new editing session starts
   * (no revision for REVISION_INTERVAL_MS), when most of the text is removed,
   * or when `keepCurrent` is set. `force` also stores the new state.
   */
  function saveDoc(userId, id, patch, { force = false, keepCurrent = false } = {}) {
    return transaction(db, () => {
      const doc = loadDoc(id, userId);
      if (doc.deleted_at) {
        throw Object.assign(new HttpError(410, 'This document is in the trash.'), { current: doc });
      }
      if (patch.content !== undefined && patch.version !== undefined && patch.version !== doc.version) {
        throw Object.assign(new HttpError(409, 'This document was changed elsewhere.'), { current: doc });
      }
      const next = {
        title: patch.title ?? doc.title,
        content: patch.content ?? doc.content,
        folder_id: patch.folder_id === undefined ? doc.folder_id : patch.folder_id,
      };
      const contentChanged = next.content !== doc.content;
      if (contentChanged) {
        checkQuota(userId, doc.content, next.content);
        const last = s.lastRevisionAt.get(doc.id);
        const stale = !last || Date.now() - Date.parse(last.created_at) >= REVISION_INTERVAL_MS;
        const bigCut = next.content.length < doc.content.length / 2;
        if (doc.content && (stale || bigCut || keepCurrent)) addRevision(doc);
      }
      if (contentChanged || next.title !== doc.title || next.folder_id !== doc.folder_id) {
        const version = doc.version + (contentChanged ? 1 : 0);
        s.update.run(next.title, next.content, next.folder_id, version, id, userId);
      }
      const saved = s.get.get(id, userId);
      if (force) addRevision(saved);
      return saved;
    });
  }

  const router = Router();

  router.get('/', (req, res) => {
    const uid = req.user.id;
    if (req.query.trash === '1') return res.json({ documents: s.listTrash.all(uid) });
    const q = typeof req.query.q === 'string' ? toFtsQuery(req.query.q) : '';
    if (q) return res.json({ documents: s.search.all(q, uid) });
    res.json({ documents: s.list.all(uid) });
  });

  router.post('/', (req, res) => {
    const uid = req.user.id;
    const title = cleanTitle(req.body?.title) ?? 'Untitled';
    const content = cleanContent(req.body?.content) ?? '';
    const folderId = checkFolder(req.body?.folder_id ?? null, uid);
    const id = randomUUID();
    transaction(db, () => {
      checkQuota(uid, '', content);
      s.insert.run(id, uid, folderId, title, content);
      if (content) s.insertRevision.run(id, title, content);
    });
    res.status(201).json({ document: s.get.get(id, uid) });
  });

  router.delete('/trash', (req, res) => {
    const { changes } = s.emptyTrash.run(req.user.id);
    res.json({ deleted: Number(changes) });
  });

  router.get('/:id', (req, res) => {
    res.json({ document: loadDoc(req.params.id, req.user.id) });
  });

  router.put('/:id', (req, res) => {
    const uid = req.user.id;
    const body = req.body ?? {};
    if (body.version !== undefined && !Number.isInteger(body.version)) {
      throw new HttpError(400, 'Version must be an integer.');
    }
    const patch = {
      title: cleanTitle(body.title),
      content: cleanContent(body.content),
      folder_id: checkFolder(body.folder_id, uid),
      version: body.version,
    };
    res.json({ document: saveDoc(uid, req.params.id, patch, { force: body.snapshot === true }) });
  });

  router.delete('/:id', (req, res) => {
    const uid = req.user.id;
    loadDoc(req.params.id, uid);
    if (req.query.permanent === '1') s.remove.run(req.params.id, uid);
    else s.trash.run(req.params.id, uid);
    res.json({ ok: true });
  });

  router.post('/:id/restore', (req, res) => {
    const uid = req.user.id;
    loadDoc(req.params.id, uid);
    s.restore.run(req.params.id, uid);
    res.json({ document: s.get.get(req.params.id, uid) });
  });

  router.get('/:id/revisions', (req, res) => {
    loadDoc(req.params.id, req.user.id);
    res.json({ revisions: s.listRevisions.all(req.params.id) });
  });

  router.get('/:id/revisions/:rid', (req, res) => {
    loadDoc(req.params.id, req.user.id);
    const rev = s.getRevision.get(Number(req.params.rid), req.params.id);
    if (!rev) throw notFound('Revision not found.');
    res.json({ revision: rev });
  });

  router.post('/:id/revisions/:rid/restore', (req, res) => {
    const uid = req.user.id;
    loadDoc(req.params.id, uid);
    const rev = s.getRevision.get(Number(req.params.rid), req.params.id);
    if (!rev) throw notFound('Revision not found.');
    // keepCurrent: the current text goes into history first, so the restore itself can be undone.
    const patch = { title: rev.title, content: rev.content };
    res.json({ document: saveDoc(uid, req.params.id, patch, { force: true, keepCurrent: true }) });
  });

  return router;
}
