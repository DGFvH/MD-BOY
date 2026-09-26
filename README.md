# Hashlite

**Write Markdown. See it live. Keep it safe.**

Hashlite is a simple, capable **online Markdown editor**. Write in the browser, see a live preview, and have everything saved to your account. It is a static website backed by **Supabase** (accounts, database and file storage).

## Features

**Without an account** (the editor on the home page)
- Opens straight into the editor, full screen: write or paste Markdown and see it formatted
- Toolbar, shortcuts, split view, math, diagrams and colour themes, the same as the app
- Open `.md` files; download `.md` or `.html`; print or save as PDF; **copy as formatted text** for Word, Google Docs or email
- The text is kept in the browser; **Save** moves it into an account
- `https://hashlite.io/#text=<URL-encoded Markdown>` opens that text in the editor
- Free tool pages built on the same editor (`/tools`): Markdown to Word, Google Docs, PDF and HTML, a Markdown viewer, CSV to Markdown table, a table generator, and Mermaid, LaTeX math and README editors
- Installable as an app (PWA): opens offline, and "Share → Hashlite" on a phone opens shared text in the editor
- **Connector for AI assistants**: a public MCP server at `https://hashlite.io/api/mcp` (see `/connect`), so an assistant such as Claude can hand you a link that opens its document in the editor

**Editor**
- CodeMirror 6 editor with Markdown syntax highlighting, search and replace, multiple cursors, and automatic list continuation
- Live preview in split view with **synchronized scrolling**, or editor-only and preview-only modes
- Toolbar and shortcuts for headings, bold, italic, strikethrough, lists, task lists, quotes, links, images, code, tables, math and horizontal rules
- GitHub-flavoured Markdown: tables, task lists (tick them off in the preview), footnotes, autolinks
- Syntax-highlighted code blocks, **KaTeX math** (`$…$`, `$$…$$`) and **Mermaid diagrams**
- Callouts (`> [!NOTE]`, `[!TIP]`, `[!WARNING]`…), `==highlight==` and `:emoji:` shortcodes
- **Images**: paste, drop or upload them; they are stored in Supabase Storage
- YAML front matter at the top of a document is shown as a small metadata block
- Outline panel, word and character count, reading time, cursor position
- Colour themes: System, Light, Dark, Sepia and High contrast
- Responsive layout that works on phones, and full keyboard navigation

**Accounts and storage (Supabase)**
- Accounts with email and password, **email confirmation** and **password reset by email**; change your password, download everything, or delete your account from the **Account** dialog
- Documents and nested **folders**; drag a document onto a folder to move it
- **Autosave** one second after you stop typing, plus a local draft in the browser so nothing is lost when you go offline or close a tab
- **Conflict detection**: editing the same document in two tabs never silently overwrites; the default choice keeps both versions
- **Version history**: the text is kept before it is overwritten, at most every few minutes, plus a snapshot on <kbd>Ctrl</kbd>+<kbd>S</kbd>; preview and restore any version
- **Full-text search** across all your documents (Postgres full-text search)
- **Read-only share links**: anyone with the link can read the document; turn it off at any time
- Tabs in the same browser stay in sync
- **Trash** with restore and permanent delete

**Import and export**
- Import `.md` files with the button or by dragging them onto the window
- Download as `.md`, or as a standalone `.html` file that works offline (math as MathML, diagrams inlined)
- Download all documents as a `.zip` of Markdown files, in their folders
- Print or save as PDF (a clean print stylesheet shows only the document)

## How it works

```
Browser (static site: landing, /learn, /app editor, /s/<token> share page)
   │  supabase-js, signed in with Supabase Auth
   ▼
Supabase project "HASHLITE" (EU, eu-west-1)
   ├─ Auth: email + password, confirmation and reset emails
   ├─ Postgres: folders, documents, revisions, protected by Row Level Security
   │    functions: save_document (versions, conflicts, history), restore_revision,
   │    search_documents, get_shared_document (the only thing visitors can read),
   │    delete_my_account; storage limit of 100 MB per account
   └─ Storage: bucket "images" (public read, 5 MB, PNG/JPEG/GIF/WebP)
```

There is no application server. Every rule that matters (who can read what, version checks, the storage limit) lives in the database, in `supabase/migrations/`.

## Quick start

Requires **Node.js 20+** (only to build).

```bash
npm install
npm run dev        # http://localhost:5173/app
npm run build      # static site in dist/
```

`.env` holds the Supabase URL and publishable key of the HASHLITE project. Both are public by design: the key only allows what Row Level Security allows. Put overrides in `.env.local`.

| Variable | Description |
| --- | --- |
| `VITE_SUPABASE_URL` | The Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The project's publishable (anon) key |
| `VITE_PUBLIC_URL` | The site's address (`https://hashlite.io`): canonical links, social previews, `sitemap.xml`, `llms.txt` |

### Your own Supabase project

1. Create a project and apply the SQL files in `supabase/migrations/` in order (SQL editor, or `supabase db push`).
2. Put its URL and publishable key in `.env.local`.
3. In the dashboard under **Authentication**:
   - **URL configuration:** Site URL `https://your-domain`, and redirect URLs `https://your-domain/app` and `http://localhost:5173/app`.
   - **Email:** keep "Confirm email" on, and add your own **SMTP** sender before launch. The built-in sender allows only a few emails per hour.
   - **Password security:** turn on leaked-password protection.
   - **Email templates:** paste the Hashlite-styled emails from [`supabase/templates/`](supabase/templates/README.md) (sign-up confirmation, password reset, email change, magic link).
   - **Sign-ups:** turn them off there if you want a closed instance.

## Deploying

The build is plain static files. Config for common hosts is included:

- **Netlify / Cloudflare Pages:** `netlify.toml`, plus `client/public/_redirects` and `_headers` (these are copied into `dist/`).
- **Vercel:** `vercel.json`.

They route `/app/*` and `/s/*` to their pages and set security headers. The Content-Security-Policy lists the Supabase project URL, so update it there if you use another project. They also mark `/app` and `/s/` as `noindex`, and cache `/assets/` for a year.

## Website and SEO

| Path | What |
| --- | --- |
| `/` | The editor, no account needed, with the product page below it (static HTML the editor takes over) |
| `/tools`, `/markdown-to-word`, … | Free tool pages, generated from `build/tools.mjs` by `npm run gen:pages` |
| `/guide` | Markdown cheat sheet |
| `/learn`, `/learn/…` | Short articles |
| `/privacy` | Privacy page |
| `/app` | The editor (not indexed) |
| `/s/<token>` | A shared, read-only document (not indexed) |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt` | Generated at build time from `build/site.mjs` |

See [docs/SEO.md](docs/SEO.md) for the SEO/GEO plan and [docs/LAUNCH.md](docs/LAUNCH.md) for the launch kit.

## Tests

```bash
npm run test:e2e   # builds, serves dist/ and drives the app in Chromium against Supabase
```

- **Test accounts:** the tests use confirmed test accounts, so no email is sent. Their password goes in `.env.test.local` (`E2E_PASSWORD=…`), and each test empties the account first.
- **Creating them:** `supabase/test-users.sql` creates the accounts.
- **Browser:** if Playwright can't find its bundled browser, set `CHROMIUM_PATH`.

## Project layout

```
client/                 Vite frontend (vanilla JS, no framework)
  index.html, guide/, learn/, privacy/, 404.html   public pages (plain HTML + src/site.css)
  app/index.html        the editor
  s/index.html          read-only shared document
  src/supabase.js       the Supabase client
  src/api.js            data layer: auth, documents, folders, history, images, sharing
  src/main.js           app shell, autosave, conflicts, panels, routing
  src/app/              sign-in / sign-up / reset screens and the Account dialog
  src/editor.js         CodeMirror setup and formatting commands
  src/preview.js        markdown-it pipeline, sanitizing, scroll mapping
  src/render/           block re-rendering, Mermaid, front matter, callouts
  src/zip.js            "download all" as a zip, built in the browser
  src/home-editor.js    the editor on the home page (src/guest.js keeps its text)
  src/consent.js        the one-time storage notice
build/site.mjs          public page list, PUBLIC_URL, robots/sitemap/llms.txt
supabase/migrations/    database schema, RLS policies, functions, storage bucket
supabase/templates/     styled Auth emails to paste into the dashboard
api/mcp.js              Vercel function: the MCP endpoint (Streamable HTTP, stateless)
mcp/server.js           the MCP tools: open_in_hashlite, csv_to_markdown_table, list_hashlite_tools
tests/                  Playwright tests, a static server like the hosts, test-account helper
docs/                   review, SEO plan, LLM research
```

## Security notes

- **Row Level Security** on every table: a signed-in user can only reach their own rows. Visitors can read nothing, except one shared document through `get_shared_document(token)`.
- **Passwords and sessions** are handled by Supabase Auth.
- **Rendered Markdown** is sanitized with DOMPurify, and the hosts' Content-Security-Policy allows no inline scripts.
- **Images** must be PNG, JPEG, GIF or WebP. SVG is refused because it can carry scripts. Files go under the uploader's own folder.

## Review and roadmap

[docs/REVIEW.md](docs/REVIEW.md) walks through the app, lists what the multi-agent review fixed, and lists the next possible improvements.

### Talking to LLMs

It is possible to connect Hashlite to Claude, GPT, Gemini, Mistral, OpenRouter or local models (Ollama, LM Studio). You could chat about a document, rewrite a selection, or accept and reject suggested edits. See **[docs/LLM-INTEGRATION.md](docs/LLM-INTEGRATION.md)** for the research, the recommended architecture (users bring their own API keys, stored encrypted and relayed by a Supabase Edge Function or server), and a phased plan.
