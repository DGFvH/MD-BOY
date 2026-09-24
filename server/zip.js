// Minimal ZIP writer (deflate, UTF-8 names), so exports need no dependency.
// Entries: { name, data, date }; a name ending in "/" is a folder.
import { crc32, deflateRaw } from 'node:zlib';
import { promisify } from 'node:util';

const deflateRawAsync = promisify(deflateRaw);
const UTF8_NAMES = 0x0800;

function dosDateTime(value) {
  let d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1980) d = new Date(1980, 0, 1);
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export async function createZip(entries) {
  if (entries.length > 0xffff) throw new Error('Too many files for one ZIP archive.');
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.data ?? '');
    const deflated = raw.length ? await deflateRawAsync(raw) : raw;
    const compress = deflated.length < raw.length;
    const body = compress ? deflated : raw;
    const crc = crc32(raw);
    const { time, date } = dosDateTime(entry.date);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(compress ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed to extract
    header.writeUInt16LE(UTF8_NAMES, 8);
    header.writeUInt16LE(compress ? 8 : 0, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(entry.name.endsWith('/') ? 0x10 : 0, 38); // MS-DOS directory flag
    header.writeUInt32LE(offset, 42);

    chunks.push(local, name, body);
    central.push(header, name);
    offset += local.length + name.length + body.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}
