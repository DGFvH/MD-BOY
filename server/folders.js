import { Router } from 'express';
import { HttpError, notFound } from './errors.js';

function cleanName(name) {
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'Folder name is required.');
  return name.trim().slice(0, 120);
}

export function createFoldersRouter(db) {
  const s = {
    list: db.prepare('SELECT id, parent_id, name, created_at FROM folders WHERE user_id = ? ORDER BY name COLLATE NOCASE'),
    get: db.prepare('SELECT id, parent_id, name, created_at FROM folders WHERE id = ? AND user_id = ?'),
    insert: db.prepare('INSERT INTO folders (user_id, parent_id, name) VALUES (?, ?, ?)'),
    update: db.prepare('UPDATE folders SET name = ?, parent_id = ? WHERE id = ? AND user_id = ?'),
    remove: db.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?'),
    parentOf: db.prepare('SELECT parent_id FROM folders WHERE id = ?'),
  };

  function checkParent(parentId, userId) {
    if (parentId === null || parentId === undefined) return null;
    if (!Number.isInteger(parentId) || !s.get.get(parentId, userId)) throw new HttpError(400, 'Parent folder does not exist.');
    return parentId;
  }

  function isDescendant(candidateId, ancestorId) {
    for (let id = candidateId; id != null; id = s.parentOf.get(id)?.parent_id) {
      if (id === ancestorId) return true;
    }
    return false;
  }

  const router = Router();

  router.get('/', (req, res) => {
    res.json({ folders: s.list.all(req.user.id) });
  });

  router.post('/', (req, res) => {
    const uid = req.user.id;
    const name = cleanName(req.body?.name);
    const parentId = checkParent(req.body?.parent_id, uid);
    const { lastInsertRowid } = s.insert.run(uid, parentId, name);
    res.status(201).json({ folder: s.get.get(Number(lastInsertRowid), uid) });
  });

  router.patch('/:id', (req, res) => {
    const uid = req.user.id;
    const id = Number(req.params.id);
    const folder = s.get.get(id, uid);
    if (!folder) throw notFound('Folder not found.');
    const name = req.body?.name === undefined ? folder.name : cleanName(req.body.name);
    const parentId = req.body?.parent_id === undefined ? folder.parent_id : checkParent(req.body.parent_id, uid);
    if (parentId !== null && isDescendant(parentId, id)) {
      throw new HttpError(400, 'A folder cannot be moved into itself.');
    }
    s.update.run(name, parentId, id, uid);
    res.json({ folder: s.get.get(id, uid) });
  });

  // Deleting a folder deletes its subfolders; documents inside move to the top level.
  router.delete('/:id', (req, res) => {
    const uid = req.user.id;
    const id = Number(req.params.id);
    if (!s.get.get(id, uid)) throw notFound('Folder not found.');
    s.remove.run(id, uid);
    res.json({ ok: true });
  });

  return router;
}
