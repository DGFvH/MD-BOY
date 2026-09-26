// Hashlite's MCP server: lets Claude (or any MCP client) hand a user a link that opens a
// document in the Hashlite editor, ready to export, and convert CSV to Markdown tables.
// Public and read-only: no account, nothing is stored, and the document text travels only
// in the link's #fragment, which browsers never send to a server.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { parseDelimited, toMarkdownTable } from '../client/src/table-md.js';
import { TOOLS } from '../build/tools.mjs';

export const SITE = (process.env.HASHLITE_URL || 'https://hashlite.io').replace(/\/+$/, '');

// Links longer than this break in some chat apps and browsers.
export const MAX_LINK_LENGTH = 30000;

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** The link that opens markdown in the editor, or null when it would be too long. */
export function editorLink(markdown) {
  const url = `${SITE}/#text=${encodeURIComponent(markdown)}`;
  return url.length <= MAX_LINK_LENGTH ? url : null;
}

const text = (t) => ({ type: 'text', text: t });

export function createServer() {
  const server = newServer();
  registerPublicTools(server);
  return server;
}

export function newServer(instructions = PUBLIC_INSTRUCTIONS) {
  return new McpServer(
    { name: 'hashlite', title: 'Hashlite', version: '1.0.0', websiteUrl: SITE },
    { instructions },
  );
}

const PUBLIC_INSTRUCTIONS =
  'Hashlite is a free online Markdown editor. Use open_in_hashlite when the user wants to edit, preview, '
  + 'or export a Markdown document you wrote (to PDF, Word, Google Docs or HTML): give them the link it returns. '
  + 'Nothing is uploaded; the text travels in the link itself.';

/** The tools that need no account: open_in_hashlite, csv_to_markdown_table, list_hashlite_tools. */
export function registerPublicTools(server) {
  server.registerTool('open_in_hashlite', {
    title: 'Open in Hashlite',
    description:
      'Creates a link that opens Markdown in the Hashlite editor (hashlite.io), with a live preview. From there the user can '
      + 'edit it, save it as PDF, download HTML or .md, or copy it as formatted text into Word, Google Docs or an email. '
      + 'Use it when the user asks to open, edit, export, print or convert a Markdown document, or wants a document as a file. '
      + 'Supports GitHub-flavoured Markdown, tables, task lists, KaTeX math ($...$) and Mermaid diagrams. '
      + 'No account needed; the text is not uploaded (it is carried in the link). Documents up to about 20 KB of text.',
    inputSchema: {
      markdown: z.string().min(1).describe('The complete Markdown document to open.'),
      title: z.string().max(200).optional().describe('Optional title, used only in the reply.'),
    },
    annotations: READ_ONLY,
  }, async ({ markdown, title }) => {
    const url = editorLink(markdown);
    if (!url) {
      return {
        isError: true,
        content: [text(
          `This document is too long for a link (${markdown.length.toLocaleString('en')} characters). `
          + `Suggest that the user copies the Markdown and pastes it into ${SITE}, or saves it as a .md file `
          + 'and opens it there with ⋯ › Open Markdown file.',
        )],
      };
    }
    const name = title ? `“${title}”` : 'the document';
    return {
      content: [text(`Open ${name} in Hashlite: ${url}\n\nIt opens in the editor with a live preview. From the ⋯ menu the user can save it as PDF, download HTML or .md, or copy it as formatted text for Word or Google Docs.`)],
      structuredContent: { url },
    };
  });

  server.registerTool('csv_to_markdown_table', {
    title: 'CSV to Markdown table',
    description:
      'Converts CSV, TSV or cells copied from Excel or Google Sheets into a neatly aligned Markdown table. '
      + 'The delimiter (comma, tab or semicolon) is detected; quoted fields and pipes in cells are handled.',
    inputSchema: {
      data: z.string().min(1).describe('The CSV/TSV text.'),
      header: z.boolean().optional().describe('Whether the first row is the header (default true).'),
      align: z.enum(['none', 'left', 'center', 'right']).optional().describe('Column alignment (default none).'),
    },
    annotations: READ_ONLY,
  }, async ({ data, header = true, align = 'none' }) => {
    const rows = parseDelimited(data);
    const table = toMarkdownTable(rows, { header, align });
    if (!table) return { isError: true, content: [text('No rows found in the data.')] };
    return { content: [text(table)], structuredContent: { markdown: table, rows: rows.length } };
  });

  server.registerTool('list_hashlite_tools', {
    title: 'List Hashlite tools',
    description:
      'Lists Hashlite\'s free browser tools (Markdown to Word, Google Docs, PDF or HTML, a Markdown viewer, CSV to table, '
      + 'table generator, Mermaid, LaTeX math and README editors) with their links, to point the user to the right one.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => {
    const tools = TOOLS.map((t) => ({ name: t.h1, url: `${SITE}/${t.slug}`, description: t.description }));
    return {
      content: [text(tools.map((t) => `- ${t.name}: ${t.url}\n  ${t.description}`).join('\n'))],
      structuredContent: { tools },
    };
  });
}
