# Hashmark

**Write Markdown. See it live. Keep it safe.**

Hashmark is a simple, capable **online Markdown editor**. Write in the browser, see a live preview, and have everything saved to your account on the server.

## Features

**Editor**
- CodeMirror 6 editor with Markdown syntax highlighting, search and replace, multiple cursors, and automatic list continuation
- Live preview in split view with **synchronized scrolling**, or editor-only and preview-only modes
- Toolbar and shortcuts for headings, bold, italic, strikethrough, lists, task lists, quotes, links, images, code, tables, math and horizontal rules
- GitHub-flavoured Markdown: tables, task lists (tick them off in the preview), footnotes, autolinks
- Syntax-highlighted code blocks, **KaTeX math** (`$…$`, `$$…$$`) and **Mermaid diagrams**
- Outline panel, word and character count, reading time, cursor position
- Light and dark theme (follows your system, or pick one)
- Responsive layout that works on phones

**Storage (backend)**
- Accounts with email and password
- Documents and nested **folders**; drag a document onto a folder to move it
- **Autosave** one second after you stop typing, plus a local draft in the browser so nothing is lost when you go offline or close a tab
- **Conflict detection**: editing the same document in two tabs never silently overwrites; you choose what to keep
- **Version history**: automatic snapshots every few minutes and on <kbd>Ctrl</kbd>+<kbd>S</kbd>; preview and restore any version
- **Full-text search** across all your documents (SQLite FTS5)
- **Trash** with restore and permanent delete

**Import and export**
- Import `.md` files with the button or by dragging them onto the window
- Download as `.md` or as standalone `.html`
- Print or save as PDF (a clean print stylesheet shows only the document)

## Quick start

Requires **Node.js 22.5 or newer** (it uses the built-in `node:sqlite` module, so there are no native builds).

```bash
npm install
npm run build
npm start           # http://localhost:3000
```

For development with hot reload (API on :3000, Vite on :5173 with a proxy to the API):

```bash
npm run dev         # open http://localhost:5173
```

### Docker

```bash
docker build -t hashmark .
docker run -p 3000:3000 -v hashmark-data:/data hashmark
```

## Configuration

| Variable        | Default  | Description |
| --------------- | -------- | ----------- |
| `PORT`          | `3000`   | HTTP port |
| `DATA_DIR`      | `./data` | Folder for the SQLite database (`hashmark.db`) |
| `COOKIE_SECURE` | unset    | Set to `1` when served over HTTPS, so session cookies are marked `Secure` |
| `TRUST_PROXY`   | unset    | Set to `1` behind a reverse proxy (nginx, Caddy, Fly.io, Render…) so rate limiting sees real client IPs |

Back up your data by copying `DATA_DIR`. It is safest to do this while the server is stopped, or with `sqlite3 hashmark.db ".backup backup.db"`.

## Tests

```bash
npm test            # API tests (node:test + supertest, in-memory database)
npm run test:e2e    # browser test with Playwright: builds, starts a server, registers, writes, reloads
```

If Playwright can't find its bundled browser, point it at an installed Chromium with `CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Project layout

```
server/                 Express 5 API + static file server
  index.js              app setup, security headers, CSRF origin check, error handling
  db.js                 SQLite connection and migrations
  migrations/           SQL schema (users, sessions, folders, documents, revisions, FTS index)
  auth.js               register / login / logout, scrypt password hashing, sessions
  documents.js          documents, search, trash, revisions
  folders.js            folders
client/                 Vite frontend (vanilla JS, no framework)
  src/main.js           app shell, autosave, conflicts, panels, routing
  src/editor.js         CodeMirror setup and formatting commands
  src/preview.js        markdown-it pipeline, sanitizing, Mermaid, scroll mapping
  src/sidebar.js        folder tree, search
  src/export.js         import and export
  src/storage.js        local drafts and preferences
tests/                  API and end-to-end tests
docs/LLM-INTEGRATION.md research: connecting Hashmark to LLMs
```

## API

All endpoints use JSON and need a session cookie, except register and login.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Account and session |
| `GET`  | `/api/auth/me` | Current user |
| `GET`  | `/api/docs` · `?q=search` · `?trash=1` | List, search, or list the trash |
| `POST` | `/api/docs` | Create `{ title, content, folder_id }` |
| `GET`  | `/api/docs/:id` | Fetch one document |
| `PUT`  | `/api/docs/:id` | Save `{ title?, content?, folder_id?, version?, snapshot? }`; returns **409** if `version` is stale |
| `DELETE` | `/api/docs/:id` · `?permanent=1` | Move to trash, or delete permanently |
| `POST` | `/api/docs/:id/restore` | Restore from the trash |
| `DELETE` | `/api/docs/trash` | Empty the trash |
| `GET`  | `/api/docs/:id/revisions`, `/api/docs/:id/revisions/:rid` | Version history |
| `POST` | `/api/docs/:id/revisions/:rid/restore` | Restore a version |
| `GET` `POST` | `/api/folders` | List or create folders |
| `PATCH` `DELETE` | `/api/folders/:id` | Rename, move or delete a folder |

## Security notes

- Passwords are hashed with scrypt, and session tokens are stored only as SHA-256 hashes.
- Session cookies are `HttpOnly` and `SameSite=Lax`. Writes from other origins are rejected.
- Rendered Markdown is sanitized with DOMPurify, and a strict Content-Security-Policy blocks inline scripts.
- Every database query is scoped to the signed-in user.
- Login and registration are rate-limited.

## Roadmap: talking to LLMs

It is possible to connect Hashmark to Claude, GPT, Gemini, Mistral, OpenRouter or local models (Ollama, LM Studio). You could chat about a document, rewrite a selection, or accept and reject suggested edits. See **[docs/LLM-INTEGRATION.md](docs/LLM-INTEGRATION.md)** for the research, the recommended architecture (users bring their own API keys, the server stores them encrypted and relays calls), and a phased plan.
