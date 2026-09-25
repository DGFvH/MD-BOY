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
- Callouts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`…), `==highlight==` and `:emoji:` shortcodes
- **Images**: paste, drop or upload them; they are stored on the server
- YAML front matter at the top of a document is shown as a small metadata block
- Outline panel, word and character count, reading time, cursor position
- Light and dark theme (follows your system, or pick one)
- Responsive layout that works on phones, and full keyboard navigation

**Storage (backend)**
- Accounts with email and password; change your password, download everything, or delete your account from the **Account** dialog
- Documents and nested **folders**; drag a document onto a folder to move it
- **Autosave** one second after you stop typing, plus a local draft in the browser so nothing is lost when you go offline or close a tab
- **Conflict detection**: editing the same document in two tabs never silently overwrites; the default choice keeps both versions
- **Version history**: the text is kept before it is overwritten, at most every few minutes, plus a snapshot on <kbd>Ctrl</kbd>+<kbd>S</kbd>; preview and restore any version
- **Full-text search** across all your documents (SQLite FTS5)
- **Read-only share links**: anyone with the link can read the document; turn it off at any time
- Tabs in the same browser stay in sync
- **Trash** with restore and permanent delete

**Import and export**
- Import `.md` files with the button or by dragging them onto the window
- Download as `.md`, or as a standalone `.html` file that works offline (math as MathML, diagrams inlined)
- Download all documents as a `.zip` of Markdown files, in their folders
- Print or save as PDF (a clean print stylesheet shows only the document)

## Quick start

Requires **Node.js 22.13 or newer** (it uses the built-in `node:sqlite` module, so there are no native builds).

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

| Variable             | Default     | Description |
| -------------------- | ----------- | ----------- |
| `PORT`               | `3000`      | HTTP port |
| `HOST`               | all interfaces | Address to listen on, e.g. `127.0.0.1` so only a reverse proxy on the same machine can reach the app |
| `DATA_DIR`           | `./data`    | Folder for the SQLite database (`hashmark.db`) |
| `COOKIE_SECURE`      | unset       | Set to `1` when served over HTTPS, so session cookies are marked `Secure` (automatic behind an HTTPS proxy when `TRUST_PROXY` is set) |
| `TRUST_PROXY`        | unset       | Set behind a reverse proxy (nginx, Caddy, Fly.io, Render…) so rate limiting sees real client IPs: a hop count (`1`), or the proxies' addresses or subnets (`loopback`, `172.17.0.0/16`, comma-separated). `true` trusts every hop and is only safe when the app can be reached solely through the proxy |
| `ALLOW_REGISTRATION` | `1`         | Set to `0` to close sign-ups; existing accounts keep working |
| `MAX_USER_BYTES`     | `104857600` | Storage limit per account for document text and images, trash included (100 MB); `0` means no limit |
| `PUBLIC_URL`         | unset       | The site's public address, e.g. `https://hashmark.example`. Used for canonical links, social previews, `sitemap.xml` and `llms.txt`. Without it those absolute tags are left out |

Behind nginx, pass the original host and scheme so the same-origin check and secure cookies work:

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host $http_host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Then start Hashmark with `HOST=127.0.0.1 TRUST_PROXY=loopback`.

Back up your data by copying `DATA_DIR`. It is safest to do this while the server is stopped, or with `sqlite3 hashmark.db ".backup backup.db"`.

To reset a forgotten password, run this with the same `DATA_DIR` as the server (it is safe while the server runs). It prints a new random password and signs the account out everywhere:

```bash
node server/admin.js reset-password user@example.com
docker exec <container> node server/admin.js reset-password user@example.com   # in Docker
```

## Website and SEO

| Path | What |
| ---- | ---- |
| `/` | Landing page (static HTML, no editor JavaScript). Signed-in visitors are redirected to `/app` |
| `/guide` | Markdown cheat sheet |
| `/privacy` | Privacy page |
| `/app` | The editor (not indexed) |
| `/s/<token>` | A shared, read-only document (not indexed) |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt` | For search engines and AI crawlers; the sitemap needs `PUBLIC_URL` |

See [docs/SEO.md](docs/SEO.md) for the SEO/GEO plan and the steps to take after deploying.

## Tests

```bash
npm test            # API tests (node:test + supertest, in-memory database)
npm run test:e2e    # browser tests with Playwright: builds, starts a server, and drives the app
```

If Playwright can't find its bundled browser, point it at an installed Chromium with `CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Project layout

```
server/                 Express 5 API + static file server
  index.js              app setup, security headers, same-origin check, error handling
  db.js                 SQLite connection and migrations
  migrations/           SQL schema (users, sessions, folders, documents, revisions, FTS index, usage)
  auth.js               register / login / logout / password / account, scrypt hashing, sessions, rate limits
  documents.js          documents, search, trash, revisions, storage limit
  folders.js            folders
  export.js, zip.js     "download everything" as a zip (no dependencies)
  images.js             image upload (type sniffing, storage limit) and /i/<id>
  share.js, render.js   read-only share links, rendered on the server
  site.js               public pages, PUBLIC_URL, robots.txt, sitemap.xml, llms.txt, 404
  static.js             static files: immutable caching, precompressed .br/.gz
  admin.js              command-line password reset
client/                 Vite frontend (vanilla JS, no framework)
  index.html, guide/, privacy/, 404.html   public pages (plain HTML + src/site.css)
  app/index.html        the editor
  src/brand.js          product name and tagline
  src/main.js           app shell, autosave, conflicts, panels, routing
  src/app/              sign-in screen and Account dialog
  src/editor.js         CodeMirror setup and formatting commands
  src/preview.js        markdown-it pipeline, sanitizing, scroll mapping
  src/render/           block-level re-rendering, Mermaid, front matter
  src/sidebar.js        folder tree, search
  src/export.js         import and export
  src/storage.js        local drafts and preferences
tests/                  API and end-to-end tests
docs/LLM-INTEGRATION.md research: connecting Hashmark to LLMs
```

## API

All endpoints use JSON and need a session cookie, except `/api/config`, register and login.

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `POST` | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Account and session |
| `GET`  | `/api/auth/me` | Current user |
| `GET`  | `/api/config` | `{ registration }`: whether sign-ups are open |
| `POST` | `/api/auth/password` | Change password `{ current_password, new_password }`; signs out other sessions |
| `DELETE` | `/api/auth/account` | Delete the account and all its data `{ password }` |
| `GET`  | `/api/export` | Download all documents as a zip |
| `POST` | `/api/images` | Upload an image (raw body); returns `{ url }` |
| `POST` `DELETE` | `/api/docs/:id/share` | Turn the read-only link on (returns `{ url }`) or off |
| `GET`  | `/api/docs` · `?q=search` · `?trash=1` | List, search, or list the trash |
| `POST` | `/api/docs` | Create `{ title, content, folder_id }` |
| `GET`  | `/api/docs/:id` | Fetch one document |
| `PUT`  | `/api/docs/:id` | Save `{ title?, content?, folder_id?, version?, snapshot? }`; **409** if the content changed since `version`, **410** if the document is in the trash, **413** over the storage limit |
| `DELETE` | `/api/docs/:id` · `?permanent=1` | Move to trash, or delete permanently |
| `POST` | `/api/docs/:id/restore` | Restore from the trash |
| `DELETE` | `/api/docs/trash` | Empty the trash |
| `GET`  | `/api/docs/:id/revisions`, `/api/docs/:id/revisions/:rid` | Version history |
| `POST` | `/api/docs/:id/revisions/:rid/restore` | Restore a version |
| `GET` `POST` | `/api/folders` | List or create folders |
| `PATCH` `DELETE` | `/api/folders/:id` | Rename, move or delete a folder |

## Security notes

- Passwords are hashed with scrypt, and session tokens are stored only as SHA-256 hashes.
- Session cookies are `HttpOnly` and `SameSite=Lax`, and sessions renew while in use. Writes from other origins are rejected (`Sec-Fetch-Site`, with an `Origin` check as fallback).
- Rendered Markdown is sanitized with DOMPurify, and a strict Content-Security-Policy blocks inline scripts.
- Every database query is scoped to the signed-in user.
- Login and registration are rate-limited per address, per email and per account.

## Review and roadmap

[docs/REVIEW.md](docs/REVIEW.md) walks through the app, lists what the multi-agent review fixed, and lists the next possible improvements.

### Talking to LLMs

It is possible to connect Hashmark to Claude, GPT, Gemini, Mistral, OpenRouter or local models (Ollama, LM Studio). You could chat about a document, rewrite a selection, or accept and reject suggested edits. See **[docs/LLM-INTEGRATION.md](docs/LLM-INTEGRATION.md)** for the research, the recommended architecture (users bring their own API keys, the server stores them encrypted and relays calls), and a phased plan.
