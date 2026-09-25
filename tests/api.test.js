import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync, crc32, gzipSync, inflateRawSync } from 'node:zlib';
import request from 'supertest';
import { openDatabase } from '../server/db.js';
import { createApp, parseTrustProxy } from '../server/index.js';
import { addressKey, hashPassword } from '../server/auth.js';
import { revisionsToPrune } from '../server/documents.js';
import { safeName } from '../server/export.js';

const PASSWORD = 'correct horse battery';
const DAY = 24 * 60 * 60 * 1000;

// Each suite gets its own database and app, so rate limits and data never leak between suites.
function setup(options = {}) {
  const db = options.db ?? openDatabase(':memory:');
  const app = createApp({ staticDir: '/nonexistent', ...options, db });
  async function signUp(email, password = PASSWORD) {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ email, password }).expect(201);
    return agent;
  }
  return { db, app, signUp };
}

const binary = (res, done) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

// Reads a ZIP archive through its central directory: { name: text }.
function readZip(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'has an end-of-central-directory record');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const skip = nameLength + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    assert.equal(buf.readUInt32LE(offset), 0x04034b50);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const stored = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(stored) : stored;
    assert.equal(crc32(data), buf.readUInt32LE(p + 16), `CRC of ${name}`);
    files[name] = data.toString('utf8');
    p += 46 + skip;
  }
  return files;
}

describe('auth', () => {
  const { app, db, signUp } = setup();

  test('register, me, logout, login', async () => {
    const agent = await signUp('Alice@Example.com');
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.email, 'alice@example.com');

    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);

    await agent.post('/api/auth/login').send({ email: 'alice@example.com', password: 'wrong password' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'ALICE@example.com', password: PASSWORD }).expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  test('rejects duplicate email and weak input', async () => {
    await signUp('dup@example.com');
    await request(app).post('/api/auth/register').send({ email: 'dup@example.com', password: 'whatever123' }).expect(409);
    await request(app).post('/api/auth/register').send({ email: 'nope', password: 'whatever123' }).expect(400);
    await request(app).post('/api/auth/register').send({ email: 'x@y.io', password: 'short' }).expect(400);
  });

  test('two sign-ups with the same email at once: one 201, one 409', async () => {
    const send = () => request(app).post('/api/auth/register').send({ email: 'race@example.com', password: PASSWORD });
    const statuses = (await Promise.all([send(), send()])).map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409]);
  });

  test('protected routes need a session', async () => {
    await request(app).get('/api/docs').expect(401);
    await request(app).get('/api/folders').expect(401);
    await request(app).get('/api/export').expect(401);
    await request(app).post('/api/auth/password').send({}).expect(401);
    await request(app).delete('/api/auth/account').send({}).expect(401);
  });

  test('malformed cookies from other apps are ignored', async () => {
    await request(app).get('/api/health').set('Cookie', 'theme=100%; other=1').expect(200);
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', 'utm=%E0%A4%A')
      .send({ email: 'alice@example.com', password: PASSWORD })
      .expect(200);
    const session = res.headers['set-cookie'][0].split(';')[0];
    const me = await request(app).get('/api/auth/me').set('Cookie', `theme=100%; ${session}; x=%zz`).expect(200);
    assert.equal(me.body.user.email, 'alice@example.com');
  });

  test('sessions slide: an active session is renewed', async () => {
    const agent = await signUp('slide@example.com');
    const { id } = (await agent.get('/api/auth/me').expect(200)).body.user;
    const soon = Date.now() + DAY;
    db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(soon, id);
    const res = await agent.get('/api/auth/me').expect(200);
    assert.match(res.headers['set-cookie']?.[0] ?? '', /^hashlite_session=/);
    const { expires_at } = db.prepare('SELECT expires_at FROM sessions WHERE user_id = ?').get(id);
    assert.ok(expires_at > Date.now() + 29 * DAY);
    // A fresh session is not rewritten on every request.
    const again = await agent.get('/api/auth/me').expect(200);
    assert.equal(again.headers['set-cookie'], undefined);
  });

  test('config says registration is open by default', async () => {
    const res = await request(app).get('/api/config').expect(200);
    assert.deepEqual(res.body, { registration: true });
  });
});

describe('registration turned off', () => {
  const db = openDatabase(':memory:');
  const { app } = setup({ db, allowRegistration: false });

  test('config reports it, register is refused, existing users can still sign in', async () => {
    const config = await request(app).get('/api/config').expect(200);
    assert.deepEqual(config.body, { registration: false });
    const res = await request(app).post('/api/auth/register').send({ email: 'new@example.com', password: PASSWORD });
    assert.equal(res.status, 403);
    assert.ok(res.body.error);

    db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run('old@example.com', await hashPassword(PASSWORD));
    await request(app).post('/api/auth/login').send({ email: 'old@example.com', password: PASSWORD }).expect(200);
  });
});

describe('cross-origin protection', () => {
  const { app, signUp } = setup();
  const proxied = setup({ trustProxy: 1 });

  test('blocks cross-origin writes', async () => {
    const agent = await signUp('csrf@example.com');
    await agent.post('/api/docs').set('Origin', 'https://evil.example').send({ title: 'x' }).expect(403);
    await agent.post('/api/docs').set('Sec-Fetch-Site', 'cross-site').send({ title: 'x' }).expect(403);
    await agent.post('/api/docs').set('Sec-Fetch-Site', 'same-site').send({ title: 'x' }).expect(403);
    await agent.post('/api/docs').set('Sec-Fetch-Site', 'same-origin').send({ title: 'x' }).expect(201);
    await agent.get('/api/docs').set('Sec-Fetch-Site', 'cross-site').expect(200); // reads are fine
  });

  test('works behind a reverse proxy that rewrites Host', async () => {
    const register = (target, email) =>
      request(target)
        .post('/api/auth/register')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'https://notes.example.com')
        .set('X-Forwarded-Host', 'notes.example.com')
        .send({ email, password: PASSWORD });
    assert.equal((await register(proxied.app, 'proxy@example.com')).status, 201);
    // Without TRUST_PROXY the forwarded host is not believed.
    assert.equal((await register(app, 'proxy@example.com')).status, 403);
    // Modern browsers send Sec-Fetch-Site, which a proxy does not change.
    const res = await request(app)
      .post('/api/auth/register')
      .set('Host', '127.0.0.1:3000')
      .set('Origin', 'https://notes.example.com:8443')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ email: 'proxy2@example.com', password: PASSWORD });
    assert.equal(res.status, 201);
  });

  test('HTTPS behind a trusted proxy: Secure cookie and HSTS', async () => {
    const res = await request(proxied.app)
      .post('/api/auth/register')
      .set('X-Forwarded-Proto', 'https')
      .send({ email: 'https@example.com', password: PASSWORD })
      .expect(201);
    assert.match(res.headers['set-cookie'][0], /; Secure/i);
    assert.ok(res.headers['strict-transport-security']);
    const plain = await request(app).post('/api/auth/register').send({ email: 'http@example.com', password: PASSWORD });
    assert.doesNotMatch(plain.headers['set-cookie'][0], /Secure/i);
    assert.equal(plain.headers['strict-transport-security'], undefined);
  });

  test('TRUST_PROXY accepts a hop count, a list of addresses, or true/false', async () => {
    assert.equal(parseTrustProxy(undefined), false);
    assert.equal(parseTrustProxy(''), false);
    assert.equal(parseTrustProxy('0'), false);
    assert.equal(parseTrustProxy('false'), false);
    assert.equal(parseTrustProxy('1'), 1);
    assert.equal(parseTrustProxy('true'), true);
    assert.equal(parseTrustProxy(' TRUE '), true);
    assert.deepEqual(parseTrustProxy('loopback, 10.0.0.0/8'), ['loopback', '10.0.0.0/8']);
    // Express takes each of them (it throws at startup on anything it cannot parse).
    const hsts = async (value) => {
      const { app: proxiedApp } = setup({ trustProxy: parseTrustProxy(value) });
      const res = await request(proxiedApp).get('/api/health').set('X-Forwarded-Proto', 'https').expect(200);
      return res.headers['strict-transport-security'];
    };
    assert.ok(await hsts('true'));
    assert.ok(await hsts('loopback, 10.0.0.0/8'));
    assert.equal(await hsts('false'), undefined);
  });
});

describe('rate limits', () => {
  test('one address cannot spray a password across many accounts', async () => {
    const { app } = setup({ limits: { loginPerIp: 3 } });
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/auth/login').send({ email: `u${i}@example.com`, password: PASSWORD }).expect(401);
    }
    await request(app).post('/api/auth/login').send({ email: 'u9@example.com', password: PASSWORD }).expect(429);
  });

  test('failed logins for one email are capped across addresses', async () => {
    const { app, signUp } = setup({ limits: { loginFailuresPerEmail: 2 }, trustProxy: 1 });
    await signUp('target@example.com');
    const login = (ip, password) =>
      request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email: 'target@example.com', password });
    assert.equal((await login('10.0.0.1', 'wrong password 1')).status, 401);
    assert.equal((await login('10.0.0.2', 'wrong password 2')).status, 401);
    assert.equal((await login('10.0.0.3', PASSWORD)).status, 429);
  });

  test('IPv6 addresses are grouped by /64', () => {
    assert.equal(addressKey('1.2.3.4'), '1.2.3.4');
    assert.equal(addressKey('::ffff:1.2.3.4'), '1.2.3.4');
    assert.equal(addressKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
    assert.equal(addressKey('2001:0db8:0001:0002::9'), '2001:db8:1:2::/64');
    assert.equal(addressKey('2001:db8::1'), '2001:db8:0:0::/64');
  });
});

describe('account', () => {
  const { app, db, signUp } = setup();

  test('change password: keeps this session, signs out the others', async () => {
    const agent = await signUp('pw@example.com');
    const other = request.agent(app);
    await other.post('/api/auth/login').send({ email: 'pw@example.com', password: PASSWORD }).expect(200);

    const wrong = await agent
      .post('/api/auth/password')
      .send({ current_password: 'not my password', new_password: 'brand new password' })
      .expect(400);
    assert.equal(wrong.body.error, 'Current password is incorrect.');
    await agent.post('/api/auth/password').send({ current_password: PASSWORD, new_password: 'short' }).expect(400);

    const ok = await agent
      .post('/api/auth/password')
      .send({ current_password: PASSWORD, new_password: 'brand new password' })
      .expect(200);
    assert.deepEqual(ok.body, { ok: true });
    await agent.get('/api/auth/me').expect(200);
    await other.get('/api/auth/me').expect(401);
    await request(app).post('/api/auth/login').send({ email: 'pw@example.com', password: PASSWORD }).expect(401);
    await request(app).post('/api/auth/login').send({ email: 'pw@example.com', password: 'brand new password' }).expect(200);
  });

  test('delete account removes the user and all their data', async () => {
    const agent = await signUp('gone@example.com');
    const keeper = await signUp('keeper@example.com');
    await keeper.post('/api/docs').send({ title: 'Kept', content: 'zucchini soup' }).expect(201);
    const { id: userId } = (await agent.get('/api/auth/me')).body.user;
    const folder = (await agent.post('/api/folders').send({ name: 'Mine' }).expect(201)).body.folder;
    const doc = (await agent.post('/api/docs').send({ title: 'Doomed', content: 'zucchini', folder_id: folder.id })).body.document;
    await agent.put(`/api/docs/${doc.id}`).send({ content: 'zucchini bread', snapshot: true }).expect(200);

    const wrong = await agent.delete('/api/auth/account').send({ password: 'not my password' }).expect(400);
    assert.ok(wrong.body.error);
    await agent.get('/api/auth/me').expect(200);

    const res = await agent.delete('/api/auth/account').send({ password: PASSWORD }).expect(200);
    assert.deepEqual(res.body, { ok: true });
    assert.match(res.headers['set-cookie'].join(), /hashlite_session=;/);
    await agent.get('/api/auth/me').expect(401);
    await request(app).post('/api/auth/login').send({ email: 'gone@example.com', password: PASSWORD }).expect(401);

    for (const table of ['sessions', 'folders', 'documents']) {
      const { n } = db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?`).get(userId);
      assert.equal(n, 0, `${table} are deleted`);
    }
    assert.equal(db.prepare('SELECT count(*) AS n FROM revisions WHERE document_id = ?').get(doc.id).n, 0);
    // The search index stays consistent, and other users are untouched.
    db.exec("INSERT INTO documents_fts(documents_fts) VALUES ('integrity-check')");
    const found = await keeper.get('/api/docs?q=zucchini').expect(200);
    assert.deepEqual(found.body.documents.map((d) => d.title), ['Kept']);
    // The email can be used again.
    await signUp('gone@example.com');
  });

  test('export: every document as .md, in its folders', async () => {
    const agent = await signUp('export@example.com');
    const other = await signUp('export-other@example.com');
    await other.post('/api/docs').send({ title: 'Not mine', content: 'secret' }).expect(201);

    const work = (await agent.post('/api/folders').send({ name: 'Work' })).body.folder;
    const work2 = (await agent.post('/api/folders').send({ name: 'work' })).body.folder;
    const notes = (await agent.post('/api/folders').send({ name: 'Notes: 2024', parent_id: work.id })).body.folder;
    await agent.post('/api/folders').send({ name: 'Empty' }).expect(201);
    const add = (title, content, folder_id = null) => agent.post('/api/docs').send({ title, content, folder_id }).expect(201);
    await add('Plan', '# Plan A', notes.id);
    await add('Plan', '# Plan B', notes.id);
    await add('a/b: c?', 'unsafe');
    await add('CON', 'reserved');
    await add('Café ☕', 'unicode');
    await add('Other work', 'x', work2.id);
    const trashed = (await add('Trashed', 'gone')).body.document;
    await agent.delete(`/api/docs/${trashed.id}`).expect(200);

    const res = await agent.get('/api/export').buffer(true).parse(binary).expect(200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(res.headers['content-disposition'], /attachment; filename="hashlite-export\.zip"/);
    const files = readZip(res.body);
    assert.deepEqual(Object.keys(files).sort(), [
      '_CON.md',
      'Café ☕.md',
      'Empty/',
      'Work/',
      'Work/Notes- 2024/',
      'Work/Notes- 2024/Plan (2).md',
      'Work/Notes- 2024/Plan.md',
      'a-b- c-.md',
      'work (2)/',
      'work (2)/Other work.md',
    ].sort());
    assert.equal(files['Café ☕.md'], 'unicode');
    const plans = [files['Work/Notes- 2024/Plan.md'], files['Work/Notes- 2024/Plan (2).md']].sort();
    assert.deepEqual(plans, ['# Plan A', '# Plan B']);
  });

  test('safe file names', () => {
    assert.equal(safeName('a/b\\c:d*e?f"g<h>i|j', 'Untitled'), 'a-b-c-d-e-f-g-h-i-j');
    assert.equal(safeName(' ..hidden. ', 'Untitled'), 'hidden');
    assert.equal(safeName('...', 'Untitled'), 'Untitled');
    assert.equal(safeName('nul.txt', 'Untitled'), '_nul.txt');
    assert.equal([...safeName('😀'.repeat(150), 'x')].length, 100);
  });
});

describe('documents', () => {
  const { app, db, signUp } = setup();
  let agent;
  before(async () => {
    agent = await signUp('docs@example.com');
  });
  const revisionTexts = async (id) => {
    const revs = (await agent.get(`/api/docs/${id}/revisions`).expect(200)).body.revisions;
    return Promise.all(revs.map(async (r) => (await agent.get(`/api/docs/${id}/revisions/${r.id}`)).body.revision.content));
  };

  test('create, read, update, list', async () => {
    const created = await agent.post('/api/docs').send({ title: 'Hello', content: '# Hi' }).expect(201);
    const doc = created.body.document;
    assert.equal(doc.version, 1);

    const saved = await agent.put(`/api/docs/${doc.id}`).send({ content: '# Hi there', version: 1 }).expect(200);
    assert.equal(saved.body.document.version, 2);
    assert.equal(saved.body.document.title, 'Hello');

    const got = await agent.get(`/api/docs/${doc.id}`).expect(200);
    assert.equal(got.body.document.content, '# Hi there');

    const list = await agent.get('/api/docs').expect(200);
    assert.ok(list.body.documents.some((d) => d.id === doc.id));
    assert.equal(list.body.documents[0].content, undefined, 'list returns metadata only');
    assert.equal(list.body.documents[0].excerpt, undefined, 'excerpts are only for search results');
  });

  test('stale version returns 409 with the current document', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Conflict' }).expect(201);
    const id = body.document.id;
    await agent.put(`/api/docs/${id}`).send({ content: 'tab A', version: 1 }).expect(200);
    const res = await agent.put(`/api/docs/${id}`).send({ content: 'tab B', version: 1 }).expect(409);
    assert.equal(res.body.current.content, 'tab A');
  });

  test('a retried save of text that is already stored is not a conflict', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Retry', content: 'v1' }).expect(201);
    const id = body.document.id;
    await agent.put(`/api/docs/${id}`).send({ content: 'v2', version: 1 }).expect(200);
    // The reply was lost, so the tab sends the same text with its old version again.
    const res = await agent.put(`/api/docs/${id}`).send({ content: 'v2', version: 1 }).expect(200);
    assert.equal(res.body.document.version, 2);
    await agent.put(`/api/docs/${id}`).send({ content: 'v3', version: 1 }).expect(409);
  });

  test('a snapshot of the unchanged stored text still lands in history', async () => {
    // "Overwrite" in the conflict dialog first saves the other tab's text as a version.
    const { body } = await agent.post('/api/docs').send({ title: 'Theirs', content: 'mine' }).expect(201);
    const id = body.document.id;
    const theirs = (await agent.put(`/api/docs/${id}`).send({ content: 'theirs', version: 1 }).expect(200)).body.document;
    assert.deepEqual(await revisionTexts(id), ['mine']);
    const keep = { content: theirs.content, version: theirs.version, snapshot: true };
    const res = await agent.put(`/api/docs/${id}`).send(keep).expect(200);
    assert.equal(res.body.document.version, theirs.version);
    assert.deepEqual(await revisionTexts(id), ['theirs', 'mine']);
    await agent.put(`/api/docs/${id}`).send(keep).expect(200);
    assert.deepEqual(await revisionTexts(id), ['theirs', 'mine'], 'the same text is not stored twice');
  });

  test('version only changes with the content; renames and moves never conflict', async () => {
    const folder = (await agent.post('/api/folders').send({ name: 'Box' })).body.folder;
    const { body } = await agent.post('/api/docs').send({ title: 'Meta', content: 'text' }).expect(201);
    const id = body.document.id;
    const put = (patch) => agent.put(`/api/docs/${id}`).send(patch);

    let res = await put({ title: 'Renamed' }).expect(200);
    assert.equal(res.body.document.version, 1);
    res = await put({ folder_id: folder.id, version: 42 }).expect(200); // no content: no version check
    assert.equal(res.body.document.version, 1);
    assert.equal(res.body.document.folder_id, folder.id);
    res = await put({ content: 'text', version: 1 }).expect(200); // same text: same version
    assert.equal(res.body.document.version, 1);
    res = await put({ title: 'Renamed', content: 'new text', version: 1 }).expect(200);
    assert.equal(res.body.document.version, 2);
    await put({ content: 'stale tab', version: 1 }).expect(409);
  });

  test('a trashed document cannot be edited: 410 with the current document', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Binned', content: 'before' }).expect(201);
    const id = body.document.id;
    await agent.put(`/api/docs/${id}`).send({ content: 'more', snapshot: true }).expect(200);
    await agent.delete(`/api/docs/${id}`).expect(200);

    const res = await agent.put(`/api/docs/${id}`).send({ content: 'typed after trashing', version: 2 }).expect(410);
    assert.equal(res.body.current.id, id);
    assert.equal(res.body.current.content, 'more');
    assert.ok(res.body.current.deleted_at);
    await agent.put(`/api/docs/${id}`).send({ title: 'x' }).expect(410);
    const revs = (await agent.get(`/api/docs/${id}/revisions`).expect(200)).body.revisions;
    await agent.post(`/api/docs/${id}/revisions/${revs.at(-1).id}/restore`).expect(410);

    await agent.post(`/api/docs/${id}/restore`).expect(200);
    await agent.put(`/api/docs/${id}`).send({ content: 'back again', version: 2 }).expect(200);
  });

  test('trash, restore and permanent delete', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Trash me' }).expect(201);
    const id = body.document.id;
    await agent.delete(`/api/docs/${id}`).expect(200);
    let list = await agent.get('/api/docs').expect(200);
    assert.ok(!list.body.documents.some((d) => d.id === id));
    const trash = await agent.get('/api/docs?trash=1').expect(200);
    assert.ok(trash.body.documents.some((d) => d.id === id));

    await agent.post(`/api/docs/${id}/restore`).expect(200);
    list = await agent.get('/api/docs').expect(200);
    assert.ok(list.body.documents.some((d) => d.id === id));

    await agent.delete(`/api/docs/${id}?permanent=1`).expect(200);
    await agent.get(`/api/docs/${id}`).expect(404);
  });

  test('full-text search marks matches with \\u0002 and \\u0003', async () => {
    await agent.post('/api/docs').send({ title: 'Recipes', content: 'See [[Home Page]] for a lovely aubergine curry' }).expect(201);
    const res = await agent.get('/api/docs?q=auberg').expect(200);
    assert.equal(res.body.documents.length, 1);
    assert.equal(res.body.documents[0].title, 'Recipes');
    const { excerpt } = res.body.documents[0];
    assert.match(excerpt, /\u0002aubergine\u0003/);
    assert.match(excerpt, /\[\[Home Page\]\]/, 'wiki links in the text are left alone');
    assert.equal(excerpt.split('\u0002').length, 2, 'only the match is marked');
    // Punctuation that would be FTS syntax must not break the query.
    await agent.get('/api/docs?q=' + encodeURIComponent('"curry" OR (NEAR')).expect(200);
  });

  test('revisions: snapshot and restore', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Rev', content: 'v1' }).expect(201);
    const id = body.document.id;
    await agent.put(`/api/docs/${id}`).send({ content: 'v2', snapshot: true }).expect(200);
    await agent.put(`/api/docs/${id}`).send({ content: 'v3' }).expect(200); // within interval: no snapshot

    const revs = (await agent.get(`/api/docs/${id}/revisions`).expect(200)).body.revisions;
    assert.equal(revs.length, 2);
    const oldest = revs.at(-1);
    const rev = await agent.get(`/api/docs/${id}/revisions/${oldest.id}`).expect(200);
    assert.equal(rev.body.revision.content, 'v1');

    const restored = await agent.post(`/api/docs/${id}/revisions/${oldest.id}/restore`).expect(200);
    assert.equal(restored.body.document.content, 'v1');
    assert.deepEqual(await revisionTexts(id), ['v3', 'v2', 'v1'], 'the pre-restore state (v3) is kept, and v1 is not duplicated');
  });

  test('history keeps the text that a later session overwrites', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Diary', content: 'Draft: first sentence.' }).expect(201);
    const id = body.document.id;
    await agent.put(`/api/docs/${id}`).send({ content: 'MONDAY FINAL: the finished text' }).expect(200);
    // A day passes.
    db.prepare('UPDATE revisions SET created_at = ? WHERE document_id = ?').run(new Date(Date.now() - DAY).toISOString(), id);
    await agent.put(`/api/docs/${id}`).send({ content: 'oops, pasted a URL over everything' }).expect(200);
    assert.deepEqual(await revisionTexts(id), ['MONDAY FINAL: the finished text', 'Draft: first sentence.']);

    // Deleting most of the text keeps a copy, even right after the last revision.
    await agent.put(`/api/docs/${id}`).send({ content: 'x' }).expect(200);
    assert.equal((await revisionTexts(id))[0], 'oops, pasted a URL over everything');
    // Small edits within the interval do not add revisions.
    await agent.put(`/api/docs/${id}`).send({ content: 'xy' }).expect(200);
    assert.equal((await revisionTexts(id)).length, 3);
  });

  test('revision thinning: all of the last day, hourly for a week, then daily', () => {
    const now = Date.parse('2026-06-30T12:00:00Z');
    const at = (ms) => new Date(now - ms).toISOString();
    const revs = [
      { id: 9, created_at: at(60 * 1000) },
      { id: 8, created_at: at(2 * 60 * 1000) },
      { id: 7, created_at: at(DAY + 10 * 60 * 1000) }, // same hour as 6: keep the newest
      { id: 6, created_at: at(DAY + 20 * 60 * 1000) },
      { id: 5, created_at: at(3 * DAY) },
      { id: 4, created_at: at(10 * DAY) }, // same day as 3
      { id: 3, created_at: at(10 * DAY + 60 * 1000) },
      { id: 2, created_at: at(40 * DAY) },
    ];
    assert.deepEqual(revisionsToPrune(revs, now), [6, 3]);
    const many = Array.from({ length: 250 }, (_, i) => ({ id: 1000 - i, created_at: at(i * 1000) }));
    assert.equal(revisionsToPrune(many, now).length, 50);
  });

  test('users cannot see each other’s documents', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Private', content: 'kumquat marmalade' }).expect(201);
    const mallory = await signUp('mallory@example.com');
    await mallory.get(`/api/docs/${body.document.id}`).expect(404);
    await mallory.put(`/api/docs/${body.document.id}`).send({ content: 'pwned' }).expect(404);
    await mallory.delete(`/api/docs/${body.document.id}`).expect(404);
    await mallory.get(`/api/docs/${body.document.id}/revisions`).expect(404);
    const list = await mallory.get('/api/docs').expect(200);
    assert.equal(list.body.documents.length, 0);
    const search = await mallory.get('/api/docs?q=kumquat').expect(200);
    assert.equal(search.body.documents.length, 0);
    const zip = readZip((await mallory.get('/api/export').buffer(true).parse(binary).expect(200)).body);
    assert.deepEqual(zip, {});
  });
});

describe('storage limit', () => {
  const { signUp } = setup({ maxUserBytes: 1000 });

  test('saves that go over the limit get 413; shrinking always works', async () => {
    const agent = await signUp('quota@example.com');
    const doc = (await agent.post('/api/docs').send({ title: 'Big', content: 'a'.repeat(800) }).expect(201)).body.document;
    const res = await agent.post('/api/docs').send({ title: 'Too much', content: 'b'.repeat(300) }).expect(413);
    assert.match(res.body.error, /Storage limit/);
    await agent.put(`/api/docs/${doc.id}`).send({ content: 'é'.repeat(501) }).expect(413); // 1002 bytes
    await agent.put(`/api/docs/${doc.id}`).send({ content: 'a'.repeat(700) }).expect(200);
    await agent.post('/api/docs').send({ title: 'Fits', content: 'b'.repeat(300) }).expect(201);

    // The trash still counts; deleting for good frees the space.
    await agent.delete(`/api/docs/${doc.id}`).expect(200);
    await agent.post('/api/docs').send({ content: 'c'.repeat(100) }).expect(413);
    await agent.delete('/api/docs/trash').expect(200);
    await agent.post('/api/docs').send({ content: 'c'.repeat(100) }).expect(201);
  });
});

describe('folders', () => {
  const { signUp } = setup();

  test('create, nest, move doc, rename, prevent cycles, delete', async () => {
    const agent = await signUp('folders@example.com');
    const a = (await agent.post('/api/folders').send({ name: 'Work' }).expect(201)).body.folder;
    const b = (await agent.post('/api/folders').send({ name: 'Notes', parent_id: a.id }).expect(201)).body.folder;

    const doc = (await agent.post('/api/docs').send({ title: 'In folder', folder_id: b.id }).expect(201)).body.document;
    assert.equal(doc.folder_id, b.id);

    await agent.patch(`/api/folders/${a.id}`).send({ parent_id: b.id }).expect(400);
    await agent.patch(`/api/folders/${b.id}`).send({ name: 'Meeting notes' }).expect(200);

    const other = await signUp('folders2@example.com');
    await other.post('/api/docs').send({ title: 'x', folder_id: a.id }).expect(400);

    await agent.delete(`/api/folders/${a.id}`).expect(200);
    const folders = (await agent.get('/api/folders').expect(200)).body.folders;
    assert.equal(folders.length, 0);
    const moved = (await agent.get(`/api/docs/${doc.id}`).expect(200)).body.document;
    assert.equal(moved.folder_id, null);
  });
});

describe('database', () => {
  test('foreign keys are on after migrations', () => {
    const db = openDatabase(':memory:');
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  });

  test('an existing database is upgraded and its storage use counted', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hashlite-db-'));
    try {
      const file = join(dir, 'hashlite.db');
      const old = new DatabaseSync(file);
      const init = fileURLToPath(new URL('../server/migrations/001_init.sql', import.meta.url));
      old.exec(readFileSync(init, 'utf8'));
      old.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1);');
      old.exec("INSERT INTO users (email, password_hash) VALUES ('old@example.com', 'x')");
      old.exec("INSERT INTO documents (id, user_id, title, content) VALUES ('d1', 1, 'T', 'héllo')");
      old.exec("INSERT INTO revisions (document_id, title, content) VALUES ('d1', 'T', 'h')");
      old.close();

      const db = openDatabase(file);
      assert.equal(db.prepare('SELECT content_bytes FROM users').get().content_bytes, 6);
      assert.equal(db.prepare('SELECT count(*) AS n FROM revisions').get().n, 1);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('static files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashlite-static-'));
  const js = 'console.log("hello from a chunk");\n'.repeat(100);
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Hashlite</title>');
  mkdirSync(join(dir, 'app'));
  writeFileSync(join(dir, 'app', 'index.html'), '<!doctype html><title>Hashlite</title>');
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  writeFileSync(join(dir, '.env'), 'SECRET=1');
  writeFileSync(join(dir, 'assets', 'index-abc123.js'), js);
  writeFileSync(join(dir, 'assets', 'index-abc123.js.br'), brotliCompressSync(js));
  writeFileSync(join(dir, 'assets', 'index-abc123.js.gz'), gzipSync(js));
  writeFileSync(join(dir, 'assets', 'font-abc123.woff2'), 'font');
  const { app } = setup({ staticDir: dir });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('a missing asset is a 404, never index.html', async () => {
    const res = await request(app).get('/assets/index-OLDHASH.js').expect(404);
    assert.doesNotMatch(res.headers['content-type'] ?? '', /html/);
    await request(app).get('/favicon.ico').expect(404);
  });

  test('HTML is left to the site router; unknown pages are a 404', async () => {
    for (const path of ['/', '/app', '/app/anything']) {
      const res = await request(app).get(path).expect(200);
      assert.match(res.headers['content-type'], /text\/html/);
      assert.equal(res.headers['cache-control'], 'no-cache');
      assert.match(res.text, /<title>Hashlite/);
    }
    await request(app).get('/index.html').expect(301).expect('Location', '/');
    await request(app).get('/some/route').expect(404);
    const env = await request(app).get('/.env');
    assert.doesNotMatch(env.text, /SECRET/);
    await request(app).get('/api/nope').expect(404).expect('Content-Type', /json/);
  });

  test('hashed assets are immutable and served pre-compressed', async () => {
    const path = '/assets/index-abc123.js';
    for (const [accept, encoding] of [['br', 'br'], ['gzip, deflate, br', 'br'], ['gzip', 'gzip'], ['br;q=0, gzip', 'gzip']]) {
      const res = await request(app).get(path).set('Accept-Encoding', accept).expect(200);
      assert.equal(res.headers['content-encoding'], encoding, accept);
      assert.equal(res.headers.vary, 'Accept-Encoding');
      assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
      assert.match(res.headers['content-type'], /javascript/);
      assert.equal(res.text, js);
    }
    const plain = await request(app).get(path).set('Accept-Encoding', 'identity').expect(200);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.headers.vary, 'Accept-Encoding');
    assert.equal(plain.text, js);

    const font = await request(app).get('/assets/font-abc123.woff2').expect(200);
    assert.equal(font.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(font.headers.vary, undefined);
    const icon = await request(app).get('/favicon.svg').expect(200);
    assert.equal(icon.headers['cache-control'], 'no-cache');
  });
});

describe('public site and crawler files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hashlite-site-'));
  for (const d of ['app', 'guide', 'privacy', 'learn/markdown-tables']) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'learn', 'markdown-tables', 'index.html'), '<!doctype html><title>Markdown tables</title>');
  const landing = [
    '<!doctype html><html><head><title>Hashlite landing</title>',
    '    <link rel="canonical" href="%PUBLIC_URL%/">',
    '    <meta property="og:image" content="%PUBLIC_URL%/og.png">',
    '<script type="application/ld+json">{"url":"%PUBLIC_URL%/"}</script>',
    '</head><body><h1>Landing</h1></body></html>',
  ].join('\n');
  writeFileSync(join(dir, 'index.html'), landing);
  writeFileSync(join(dir, 'app', 'index.html'), '<!doctype html><title>Hashlite app</title>');
  writeFileSync(join(dir, 'guide', 'index.html'), '<!doctype html><title>Markdown cheat sheet</title>');
  writeFileSync(join(dir, 'privacy', 'index.html'), '<!doctype html><title>Privacy</title>');
  writeFileSync(join(dir, '404.html'), '<!doctype html><title>Page not found</title>');
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('without PUBLIC_URL: absolute-URL tags are dropped, no sitemap', async () => {
    const { app } = setup({ staticDir: dir });
    const res = await request(app).get('/').expect(200);
    assert.match(res.text, /Hashlite landing/);
    assert.doesNotMatch(res.text, /PUBLIC_URL|canonical|og:image/);
    assert.match(res.text, /"url":"\/"/);
    await request(app).get('/sitemap.xml').expect(404);
    const robots = await request(app).get('/robots.txt').expect(200);
    assert.match(robots.text, /Disallow: \/app/);
    assert.doesNotMatch(robots.text, /Sitemap/);
  });

  test('with PUBLIC_URL: canonical, sitemap, robots and llms.txt use it', async () => {
    const { app } = setup({ staticDir: dir, publicUrl: 'https://notes.example.com/' });
    const res = await request(app).get('/').set('Accept-Encoding', 'identity').expect(200);
    assert.match(res.text, /<link rel="canonical" href="https:\/\/notes.example.com\/">/);
    assert.match(res.text, /"url":"https:\/\/notes.example.com\/"/);
    const gz = await request(app).get('/').set('Accept-Encoding', 'gzip').expect(200);
    assert.equal(gz.headers['content-encoding'], 'gzip');
    const sitemap = await request(app).get('/sitemap.xml').expect(200).expect('Content-Type', /xml/);
    for (const loc of ['https://notes.example.com/', 'https://notes.example.com/guide', 'https://notes.example.com/privacy']) {
      assert.match(sitemap.text, new RegExp(`<loc>${loc}</loc>`));
    }
    assert.doesNotMatch(sitemap.text, /\/app/);
    assert.match(sitemap.text, /<loc>https:\/\/notes.example.com\/learn\/markdown-tables<\/loc>/);
    assert.doesNotMatch(sitemap.text, /markdown-to-pdf/, 'pages that were not built are left out');
    assert.match((await request(app).get('/robots.txt')).text, /Sitemap: https:\/\/notes.example.com\/sitemap.xml/);
    const llms = await request(app).get('/llms.txt').expect(200);
    assert.match(llms.text, /^# Hashlite/);
    assert.match(llms.text, /\(https:\/\/notes.example.com\/guide\)/);
  });

  test('pages, clean URLs, noindex on the app, and a real 404 page', async () => {
    const { app } = setup({ staticDir: dir });
    assert.match((await request(app).get('/guide').expect(200)).text, /cheat sheet/);
    await request(app).get('/guide/').expect(301).expect('Location', '/guide');
    await request(app).get('/privacy/index.html').expect(301).expect('Location', '/privacy');
    const appPage = await request(app).get('/app').expect(200);
    assert.equal(appPage.headers['x-robots-tag'], 'noindex');
    assert.equal((await request(app).get('/api/health')).headers['x-robots-tag'], 'noindex');
    const missing = await request(app).get('/no-such-page').expect(404);
    assert.match(missing.text, /Page not found/);
    assert.equal(missing.headers['x-robots-tag'], 'noindex');
  });

  test('signed-in visitors go from / straight to /app', async () => {
    const { app, signUp } = setup({ staticDir: dir });
    const agent = await signUp('landing@example.com');
    await agent.get('/').expect(302).expect('Location', '/app');
    await request(app).get('/').expect(200);
  });
});

describe('images', () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 7)]);

  test('upload, public read, type sniffing, size and quota limits, account deletion', async () => {
    const { app, db, signUp } = setup({ maxUserBytes: 1000 });
    await request(app).post('/api/images').send(PNG).expect(401);
    const agent = await signUp('images@example.com');
    const up = await agent.post('/api/images').set('Content-Type', 'image/png').send(PNG).expect(201);
    assert.match(up.body.url, /^\/i\/[\w-]{22}$/);

    const img = await request(app).get(up.body.url).buffer(true).parse(binary).expect(200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.match(img.headers['cache-control'], /immutable/);
    assert.equal(img.headers['x-robots-tag'], 'noindex');
    assert.ok(Buffer.compare(img.body, PNG) === 0);
    await request(app).get('/i/aaaaaaaaaaaaaaaaaaaaaa').expect(404);

    // The browser's type is ignored: SVG (or anything else) is refused.
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    await agent.post('/api/images').set('Content-Type', 'image/png').send(svg).expect(415);
    await agent.post('/api/images').set('Content-Type', 'image/png').send(Buffer.alloc(0)).expect(415);

    // Images count toward the storage limit.
    const usage = () => db.prepare("SELECT content_bytes FROM users WHERE email = 'images@example.com'").get().content_bytes;
    assert.equal(usage(), PNG.length);
    const big = Buffer.concat([PNG, Buffer.alloc(1000)]);
    await agent.post('/api/images').set('Content-Type', 'image/png').send(big).expect(413);

    await agent.delete('/api/auth/account').send({ password: PASSWORD }).expect(200);
    await request(app).get(up.body.url).expect(404);
  });
});

describe('share links', () => {
  test('create, public read-only page, escaping, noindex, revoke', async () => {
    const { app, signUp } = setup();
    const agent = await signUp('share@example.com');
    const content = '# Shared doc\n\n<script>alert(1)</script>\n\n- [x] done\n\n> [!NOTE]\n> Heads up\n\n$x^2$ and ==marked== :tada:';
    const { body } = await agent.post('/api/docs').send({ title: 'Shared doc', content }).expect(201);
    const id = body.document.id;

    const other = await signUp('share2@example.com');
    await other.post(`/api/docs/${id}/share`).expect(404);

    const shared = await agent.post(`/api/docs/${id}/share`).expect(200);
    assert.match(shared.body.url, /^\/s\/[\w-]{22}$/);
    const again = await agent.post(`/api/docs/${id}/share`).expect(200);
    assert.equal(again.body.url, shared.body.url, 'sharing twice keeps the same link');
    const listed = (await agent.get('/api/docs').expect(200)).body.documents.find((d) => d.id === id);
    assert.equal(listed.share_token, shared.body.token);

    const page = await request(app).get(shared.body.url).expect(200).expect('Content-Type', /html/);
    assert.equal(page.headers['x-robots-tag'], 'noindex');
    assert.match(page.text, /<meta name="robots" content="noindex">/);
    assert.match(page.text, /<h1[^>]*>Shared doc<\/h1>/);
    assert.doesNotMatch(page.text, /<script>alert/);
    assert.match(page.text, /&lt;script&gt;/);
    assert.match(page.text, /markdown-alert-note/);
    assert.match(page.text, /<math/);
    assert.match(page.text, /<mark>marked<\/mark>/);
    assert.match(page.text, /🎉/);
    assert.match(page.text, /<input class="task-list-item-checkbox"[^>]*disabled/);

    await agent.delete(`/api/docs/${id}/share`).expect(200);
    await request(app).get(shared.body.url).expect(404);

    // A trashed document is no longer shared.
    const re = await agent.post(`/api/docs/${id}/share`).expect(200);
    await agent.delete(`/api/docs/${id}`).expect(200);
    await request(app).get(re.body.url).expect(404);
  });
});
