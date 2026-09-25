// "Download all documents": a ZIP of Markdown files in their folders, built in the
// browser (deflate via CompressionStream, UTF-8 names), so no server is needed.

const UTF8_NAMES = 0x0800;
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

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function dosDateTime(value) {
  let d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1980) d = new Date(1980, 0, 1);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** entries: [{ name, data, date }]; a name ending in "/" is a folder. Returns a Blob. */
export async function createZip(entries) {
  if (entries.length > 0xffff) throw new Error('Too many files for one ZIP archive.');
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const raw = enc.encode(entry.data ?? '');
    const deflated = raw.length ? await deflateRaw(raw) : null;
    const compress = !!deflated && deflated.length < raw.length;
    const body = compress ? deflated : raw;
    const crc = crc32(raw);
    const { time, date } = dosDateTime(entry.date);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, UTF8_NAMES, true);
    local.setUint16(8, compress ? 8 : 0, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);

    const header = new DataView(new ArrayBuffer(46));
    header.setUint32(0, 0x02014b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 20, true);
    header.setUint16(8, UTF8_NAMES, true);
    header.setUint16(10, compress ? 8 : 0, true);
    header.setUint16(12, time, true);
    header.setUint16(14, date, true);
    header.setUint32(16, crc, true);
    header.setUint32(20, body.length, true);
    header.setUint32(24, raw.length, true);
    header.setUint16(28, name.length, true);
    header.setUint32(38, entry.name.endsWith('/') ? 0x10 : 0, true); // MS-DOS directory flag
    header.setUint32(42, offset, true);

    parts.push(local, name, body);
    central.push(header, name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((n, b) => n + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

/** Builds the export from { folders, documents } (documents outside the trash). */
export function exportEntries(folders, documents) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const takenIn = new Map(); // folder path -> names used in it
  const taken = (dir) => takenIn.get(dir) ?? takenIn.set(dir, new Set()).get(dir);
  const paths = new Map(); // folder id -> "Parent/Child/"
  const folderPath = (id, depth = 0) => {
    const folder = byId.get(id);
    if (!folder || depth > 100) return '';
    if (!paths.has(id)) {
      const parent = folderPath(folder.parent_id, depth + 1);
      paths.set(id, `${parent}${uniqueName(taken(parent), safeName(folder.name, 'Folder'))}/`);
    }
    return paths.get(id);
  };
  const entries = [];
  for (const f of [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))) entries.push({ name: folderPath(f.id), date: f.created_at });
  entries.sort((a, b) => (a.name < b.name ? -1 : 1)); // parents before children
  for (const doc of [...documents].sort((a, b) => a.title.localeCompare(b.title))) {
    const dir = folderPath(doc.folder_id);
    entries.push({ name: dir + uniqueName(taken(dir), safeName(doc.title, 'Untitled'), '.md'), data: doc.content, date: doc.updated_at });
  }
  return entries;
}
