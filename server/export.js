import { Router } from 'express';
import { HttpError } from './errors.js';
import { createZip } from './zip.js';

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i; // not allowed as file names on Windows

// Makes a title or folder name safe as a file name on Windows, macOS and Linux.
export function safeName(name, fallback) {
  let out = String(name ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  out = [...out].slice(0, 100).join('').replace(/^[. ]+|[. ]+$/g, '');
  if (!out) out = fallback;
  if (RESERVED.test(out.split('.')[0])) out = `_${out}`;
  return out;
}

// "Notes.md", then "Notes (2).md", ... (case-insensitive, as on Windows and macOS).
function uniqueName(taken, base, ext = '') {
  let name = base + ext;
  for (let i = 2; taken.has(name.toLowerCase()); i += 1) name = `${base} (${i})${ext}`;
  taken.add(name.toLowerCase());
  return name;
}

/** GET /api/export: every document outside the trash as a .md file, in its folder. */
export function createExportRouter(db) {
  const s = {
    folders: db.prepare(
      'SELECT id, parent_id, name, created_at FROM folders WHERE user_id = ? ORDER BY name COLLATE NOCASE, id',
    ),
    documents: db.prepare(
      `SELECT folder_id, title, content, updated_at FROM documents
       WHERE user_id = ? AND deleted_at IS NULL ORDER BY title COLLATE NOCASE, created_at`,
    ),
  };

  const router = Router();
  router.get('/', async (req, res) => {
    const uid = req.user.id;
    const folders = new Map(s.folders.all(uid).map((f) => [f.id, f]));
    const takenIn = new Map(); // folder path -> names used in it
    const taken = (dir) => takenIn.get(dir) ?? takenIn.set(dir, new Set()).get(dir);
    const paths = new Map(); // folder id -> "Parent/Child/"

    const folderPath = (id, depth = 0) => {
      const folder = folders.get(id);
      if (!folder || depth > 100) return '';
      if (!paths.has(id)) {
        const parent = folderPath(folder.parent_id, depth + 1);
        paths.set(id, `${parent}${uniqueName(taken(parent), safeName(folder.name, 'Folder'))}/`);
      }
      return paths.get(id);
    };

    const entries = [];
    for (const f of folders.values()) entries.push({ name: folderPath(f.id), date: f.created_at });
    entries.sort((a, b) => (a.name < b.name ? -1 : 1)); // parents before children
    for (const doc of s.documents.all(uid)) {
      const dir = folderPath(doc.folder_id);
      const name = uniqueName(taken(dir), safeName(doc.title, 'Untitled'), '.md');
      entries.push({ name: dir + name, data: doc.content, date: doc.updated_at });
    }
    if (entries.length > 0xffff) throw new HttpError(413, 'Too many documents to export as one ZIP file.');

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="hashlite-export.zip"',
    });
    res.send(await createZip(entries));
  });
  return router;
}
