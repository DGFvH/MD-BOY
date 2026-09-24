import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { openDatabase } from '../server/db.js';
import { createApp } from '../server/index.js';

const app = createApp({ db: openDatabase(':memory:'), staticDir: '/nonexistent' });

async function signUp(email, password = 'correct horse battery') {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ email, password }).expect(201);
  return agent;
}

describe('auth', () => {
  test('register, me, logout, login', async () => {
    const agent = await signUp('Alice@Example.com');
    const me = await agent.get('/api/auth/me').expect(200);
    assert.equal(me.body.user.email, 'alice@example.com');

    await agent.post('/api/auth/logout').expect(200);
    await agent.get('/api/auth/me').expect(401);

    await agent.post('/api/auth/login').send({ email: 'alice@example.com', password: 'wrong password' }).expect(401);
    await agent.post('/api/auth/login').send({ email: 'ALICE@example.com', password: 'correct horse battery' }).expect(200);
    await agent.get('/api/auth/me').expect(200);
  });

  test('rejects duplicate email and weak input', async () => {
    await signUp('dup@example.com');
    await request(app).post('/api/auth/register').send({ email: 'dup@example.com', password: 'whatever123' }).expect(409);
    await request(app).post('/api/auth/register').send({ email: 'nope', password: 'whatever123' }).expect(400);
    await request(app).post('/api/auth/register').send({ email: 'x@y.io', password: 'short' }).expect(400);
  });

  test('protected routes need a session', async () => {
    await request(app).get('/api/docs').expect(401);
    await request(app).get('/api/folders').expect(401);
  });

  test('blocks cross-origin writes', async () => {
    const agent = await signUp('csrf@example.com');
    await agent.post('/api/docs').set('Origin', 'https://evil.example').send({ title: 'x' }).expect(403);
  });
});

describe('documents', () => {
  let agent;
  before(async () => {
    agent = await signUp('docs@example.com');
  });

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
  });

  test('stale version returns 409 with the current document', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Conflict' }).expect(201);
    const id = body.document.id;
    await agent.put(`/api/docs/${id}`).send({ content: 'tab A', version: 1 }).expect(200);
    const res = await agent.put(`/api/docs/${id}`).send({ content: 'tab B', version: 1 }).expect(409);
    assert.equal(res.body.current.content, 'tab A');
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

  test('full-text search', async () => {
    await agent.post('/api/docs').send({ title: 'Recipes', content: 'A lovely aubergine curry' }).expect(201);
    const res = await agent.get('/api/docs?q=auberg').expect(200);
    assert.equal(res.body.documents.length, 1);
    assert.equal(res.body.documents[0].title, 'Recipes');
    assert.match(res.body.documents[0].excerpt, /\[\[aubergine\]\]/);
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
    const after = (await agent.get(`/api/docs/${id}/revisions`).expect(200)).body.revisions;
    assert.ok(after.length >= 3, 'the pre-restore state (v3) is kept in history');
  });

  test('users cannot see each other’s documents', async () => {
    const { body } = await agent.post('/api/docs').send({ title: 'Private' }).expect(201);
    const mallory = await signUp('mallory@example.com');
    await mallory.get(`/api/docs/${body.document.id}`).expect(404);
    await mallory.put(`/api/docs/${body.document.id}`).send({ content: 'pwned' }).expect(404);
    await mallory.delete(`/api/docs/${body.document.id}`).expect(404);
    const list = await mallory.get('/api/docs').expect(200);
    assert.equal(list.body.documents.length, 0);
  });
});

describe('folders', () => {
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
