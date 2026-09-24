import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { HttpError, notFound } from './errors.js';
import { transaction } from './db.js';

const REVISION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_REVISIONS = 50;
const MAX_TITLE = 200;

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

export function createDocumentsRouter(db) {
  const s = {
    list: db.prepare(
      `SELECT ${META_COLUMNS}, substr(content, 1, 160) AS excerpt FROM documents
       WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC`,
    ),
    listTrash: db.prepare(
      `SELECT ${META_COLUMNS}, substr(content, 1, 160) AS excerpt FROM documents
       WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    ),
    search: db.prepare(
      `SELECT d.id, d.folder_id, d.title, d.version, d.created_at, d.updated_at, d.deleted_at,
              snippet(documents_fts, 1, '[[', ']]', '…', 16) AS excerpt
       FROM documents_fts JOIN documents d ON d.rowid = documents_fts.rowid
       WHERE documents_fts MATCH ? AND d.user_id = ? AND d.deleted_at IS NULL
       ORDER BY rank LIMIT 100`,
    ),
    get: db.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?'),
    insert: db.prepare('INSERT INTO documents (id, user_id, folder_id, title, content) VALUES (?, ?, ?, ?, ?)'),
    update: db.prepare(
      `UPDATE documents SET title = ?, content = ?, folder_id = ?, version = version + 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ? AND version = ?`,
    ),
    trash: db.prepare(
      `UPDATE documents SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ?`,
    ),
    restore: db.prepare('UPDATE documents SET deleted_at = NULL WHERE id = ? AND user_id = ?'),
    remove: db.prepare('DELETE FROM documents WHERE id = ? AND user_id = ?'),
    emptyTrash: db.prepare('DELETE FROM documents WHERE user_id = ? AND deleted_at IS NOT NULL'),
    folderOwned: db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?'),
    lastRevision: db.prepare('SELECT id, content, created_at FROM revisions WHERE document_id = ? ORDER BY id DESC LIMIT 1'),
    insertRevision: db.prepare('INSERT INTO revisions (document_id, title, content) VALUES (?, ?, ?)'),
    pruneRevisions: db.prepare(
      `DELETE FROM revisions WHERE document_id = ? AND id NOT IN
         (SELECT id FROM revisions WHERE document_id = ? ORDER BY id DESC LIMIT ${MAX_REVISIONS})`,
    ),
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

  function snapshot(doc, force) {
    const last = s.lastRevision.get(doc.id);
    if (last && last.content === doc.content) return;
    const age = last ? Date.now() - Date.parse(last.created_at) : Infinity;
    if (!force && age < REVISION_INTERVAL_MS) return;
    s.insertRevision.run(doc.id, doc.title, doc.content);
    s.pruneRevisions.run(doc.id, doc.id);
  }

  function saveDoc(userId, id, patch, { force = false } = {}) {
    return transaction(db, () => {
      const doc = loadDoc(id, userId);
      if (patch.version !== undefined && patch.version !== doc.version) {
        throw Object.assign(new HttpError(409, 'This document was changed elsewhere.'), { current: doc });
      }
      const next = {
        title: patch.title ?? doc.title,
        content: patch.content ?? doc.content,
        folder_id: patch.folder_id === undefined ? doc.folder_id : patch.folder_id,
      };
      s.update.run(next.title, next.content, next.folder_id, id, userId, doc.version);
      const saved = s.get.get(id, userId);
      snapshot(saved, force);
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
    const doc = loadDoc(req.params.id, uid);
    const rev = s.getRevision.get(Number(req.params.rid), req.params.id);
    if (!rev) throw notFound('Revision not found.');
    // Keep the current state in history so the restore itself can be undone.
    transaction(db, () => {
      const last = s.lastRevision.get(doc.id);
      if (!last || last.content !== doc.content) s.insertRevision.run(doc.id, doc.title, doc.content);
    });
    res.json({ document: saveDoc(uid, doc.id, { title: rev.title, content: rev.content }, { force: true }) });
  });

  return router;
}
