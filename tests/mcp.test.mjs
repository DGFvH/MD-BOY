// The MCP endpoint (api/mcp.js), called by the official MCP client over Streamable HTTP,
// as Claude does. Run: npm run test:mcp
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { handle } from '../api/mcp.js';
import { MAX_LINK_LENGTH } from '../mcp/server.js';

let http;
let url;

// Node's http server in front of the web-standard handler, like Vercel's runtime.
before(async () => {
  http = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(`http://localhost${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((r) => http.listen(0, r));
  url = new URL(`http://localhost:${http.address().port}/api/mcp`);
});
after(() => {
  http.closeAllConnections();
  http.close();
});

async function connect() {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(url));
  return client;
}

test('lists three read-only tools', async () => {
  const client = await connect();
  assert.equal(client.getServerVersion().name, 'hashlite');
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['csv_to_markdown_table', 'list_hashlite_tools', 'open_in_hashlite']);
  for (const t of tools) assert.equal(t.annotations.readOnlyHint, true, t.name);
  await client.close();
});

test('open_in_hashlite returns an editor link carrying the text', async () => {
  const client = await connect();
  const markdown = '# Plan\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nÜnïcödé & #hash';
  const res = await client.callTool({ name: 'open_in_hashlite', arguments: { markdown, title: 'Plan' } });
  assert.ok(!res.isError);
  const link = new URL(res.structuredContent.url);
  assert.equal(link.origin, 'https://hashlite.io');
  assert.equal(decodeURIComponent(link.hash.slice('#text='.length)), markdown);
  assert.match(res.content[0].text, /Open “Plan” in Hashlite: https:\/\/hashlite\.io\/#text=/);
  await client.close();
});

test('open_in_hashlite explains when a document is too long for a link', async () => {
  const client = await connect();
  const res = await client.callTool({ name: 'open_in_hashlite', arguments: { markdown: 'x'.repeat(MAX_LINK_LENGTH) } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /too long for a link/);
  await client.close();
});

test('csv_to_markdown_table converts CSV and spreadsheet cells', async () => {
  const client = await connect();
  const res = await client.callTool({ name: 'csv_to_markdown_table', arguments: { data: 'Name,Note\nAda,"a, b"\nAlan,p|q', align: 'left' } });
  assert.equal(res.structuredContent.markdown, '| Name | Note |\n| :--- | :--- |\n| Ada  | a, b |\n| Alan | p\\|q |');
  await client.close();
});

test('list_hashlite_tools links every tool page', async () => {
  const client = await connect();
  const res = await client.callTool({ name: 'list_hashlite_tools', arguments: {} });
  assert.equal(res.structuredContent.tools.length, 10);
  assert.ok(res.structuredContent.tools.every((t) => t.url.startsWith('https://hashlite.io/')));
  await client.close();
});

test('answers CORS preflight', async () => {
  const res = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
});
