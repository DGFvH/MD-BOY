// The account connector's tools: with the user's permission (OAuth), an assistant can find,
// read, create and update the user's Hashlite documents, and share one. Every call passes the
// user's access token to the database, which checks it and applies the app's own ownership
// rules; nothing here can reach another user's documents.
import { z } from 'zod';
import { newServer, registerPublicTools, SITE } from './server.js';
import { rpc, DbError } from './db.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const text = (t) => ({ type: 'text', text: t });
const appLink = (id) => `${SITE}/app#/doc/${id}`;
const fail = (message) => ({ isError: true, content: [text(message)] });

// Database errors the assistant can act on become tool errors; an invalid token is rethrown
// so the endpoint answers 401 and the client refreshes or reconnects.
function toolError(err) {
  if (!(err instanceof DbError) || err.code === 'HL401') throw err;
  if (err.code === 'HL404') return fail('No document with that id (it may be in the trash, or belong to someone else).');
  if (err.code === 'HL409') return fail('The document was changed after you read it. Read it again, then update the new version.');
  if (err.code === 'HL410') return fail('That document is in the trash. The user can restore it in Hashlite.');
  if (err.code === 'HL413') return fail('The user’s Hashlite storage is full.');
  return fail(err.message);
}

const INSTRUCTIONS =
  'Hashlite is the user\'s Markdown editor. With these tools you can search, list and read their Hashlite documents, '
  + 'create new ones and update existing ones (the previous text is always kept in version history), and create read-only '
  + 'share links. Read a document before updating it, and pass its version to update_document. Only create share links '
  + 'when the user asks: anyone with the link can read the document. open_in_hashlite needs no saving: it only makes a link.';

export function createAccountServer(token) {
  const server = newServer(INSTRUCTIONS);
  registerPublicTools(server);

  server.registerTool('search_documents', {
    title: 'Search my documents',
    description: 'Full-text search in the user\'s Hashlite documents (titles and text). Returns up to 25 matches with an excerpt; **bold** marks matched words.',
    inputSchema: { query: z.string().min(1).max(200).describe('Words to look for.') },
    annotations: READ,
  }, async ({ query }) => {
    try {
      const rows = await rpc('mcp_search', { p_token: token, p_query: query });
      if (!rows.length) return { content: [text(`No documents match “${query}”.`)], structuredContent: { results: [] } };
      return {
        content: [text(rows.map((r) => `- ${r.title} (id: ${r.id}, updated ${r.updated_at.slice(0, 10)})\n  ${r.excerpt}`).join('\n'))],
        structuredContent: { results: rows },
      };
    } catch (err) {
      return toolError(err);
    }
  });

  server.registerTool('list_documents', {
    title: 'List my documents',
    description: 'Lists the user\'s Hashlite documents, most recently changed first, with their folder.',
    inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('How many (default 50).') },
    annotations: READ,
  }, async ({ limit = 50 }) => {
    try {
      const rows = await rpc('mcp_list', { p_token: token, p_limit: limit });
      if (!rows.length) return { content: [text('The user has no documents yet.')], structuredContent: { documents: [] } };
      return {
        content: [text(rows.map((r) => `- ${r.title}${r.folder ? ` [${r.folder}]` : ''} (id: ${r.id}, updated ${r.updated_at.slice(0, 10)}${r.shared ? ', shared' : ''})`).join('\n'))],
        structuredContent: { documents: rows },
      };
    } catch (err) {
      return toolError(err);
    }
  });

  server.registerTool('read_document', {
    title: 'Read a document',
    description: 'Returns a document\'s Markdown, title and version. Pass the version to update_document to avoid overwriting newer edits.',
    inputSchema: { id: z.string().uuid().describe('The document id (from search_documents or list_documents).') },
    annotations: READ,
  }, async ({ id }) => {
    try {
      const [doc] = await rpc('mcp_read', { p_token: token, p_id: id });
      return {
        content: [text(`# ${doc.title}\n(id: ${doc.id}, version ${doc.version}${doc.folder ? `, folder ${doc.folder}` : ''}, open: ${appLink(doc.id)})\n\n${doc.content}`)],
        structuredContent: { ...doc, url: appLink(doc.id) },
      };
    } catch (err) {
      return toolError(err);
    }
  });

  server.registerTool('create_document', {
    title: 'Create a document',
    description: 'Saves a new Markdown document in the user\'s Hashlite account and returns its link.',
    inputSchema: {
      title: z.string().min(1).max(200).describe('Document title.'),
      markdown: z.string().max(2_000_000).describe('The document\'s Markdown.'),
    },
    annotations: WRITE,
  }, async ({ title, markdown }) => {
    try {
      const [doc] = await rpc('mcp_create', { p_token: token, p_title: title, p_content: markdown });
      return { content: [text(`Saved “${doc.title}” in Hashlite: ${appLink(doc.id)}`)], structuredContent: { ...doc, url: appLink(doc.id) } };
    } catch (err) {
      return toolError(err);
    }
  });

  server.registerTool('update_document', {
    title: 'Update a document',
    description:
      'Replaces a document\'s Markdown (and optionally its title). The previous text is kept in the document\'s version '
      + 'history, so the user can restore it. Pass the version from read_document: if the document changed since, nothing is '
      + 'overwritten and you get an error instead.',
    inputSchema: {
      id: z.string().uuid().describe('The document id.'),
      markdown: z.string().max(2_000_000).describe('The complete new Markdown (not a diff).'),
      title: z.string().min(1).max(200).optional().describe('A new title, if it should change.'),
      version: z.number().int().optional().describe('The version read_document returned.'),
    },
    annotations: WRITE,
  }, async ({ id, markdown, title, version }) => {
    try {
      const [doc] = await rpc('mcp_update', { p_token: token, p_id: id, p_content: markdown, p_title: title ?? null, p_version: version ?? null });
      return {
        content: [text(`Updated “${doc.title}” (now version ${doc.version}). The previous text is in its version history. ${appLink(doc.id)}`)],
        structuredContent: { ...doc, url: appLink(doc.id) },
      };
    } catch (err) {
      return toolError(err);
    }
  });

  server.registerTool('share_document', {
    title: 'Share a document (read-only link)',
    description:
      'Creates a read-only public link to a document (or returns the existing one). Anyone with the link can read the '
      + 'document, so only use this when the user asks to share it. The user can turn the link off in Hashlite.',
    inputSchema: { id: z.string().uuid().describe('The document id.') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ id }) => {
    try {
      const shareToken = await rpc('mcp_share', { p_token: token, p_id: id });
      const url = `${SITE}/s/${shareToken}`;
      return { content: [text(`Read-only link: ${url}\nAnyone with this link can read the document. Turn it off in Hashlite with ⋯ › Shared link.`)], structuredContent: { url } };
    } catch (err) {
      return toolError(err);
    }
  });

  return server;
}
