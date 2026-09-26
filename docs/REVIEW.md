# Hashlite review: walkthrough and improvements

**Date:** 2026-09-24. This covers the review done right after the first version was built, when the app was still called MD-BOY.

## How the review was done

1. **Review.** Four agents each looked at one part: the server, the editor's saving and draft logic, Markdown editing and rendering, and a real walkthrough in Chromium at desktop, tablet and phone sizes. A second agent then re-checked every finding against the code and tried to disprove it, and added what the first one missed. That confirmed about 70 findings.
2. **Fix.** Five agents fixed the findings. Each owned its own files, and each fix was reviewed by another agent.
3. **Final check.** A last round connected the parts. One agent then walked through every feature in the browser, another reviewed the whole diff, and the problems they found were fixed.

The API tests went from 11 to 38 and the browser tests from 1 to 6. All of them pass.

## Name

The app is called **Hashlite** (domain: **hashlite.io**), with the tagline *"Write Markdown. See it live. Keep it safe."*

- **History:** the first rebrand from MD-BOY was "Hashmark", but hashmark.com and hashmark.io were taken. Two naming rounds checked about 150 names against the domain registries (RDAP) and searched for existing products. The owner then chose Hashlite and registered hashlite.io. hashlite.com is taken (registered since 2011).
- **Why it fits:** `#` is the first character every Markdown user types, and "lite" says simple and lightweight. The `#` logo still fits.
- **Logo:** a white, slightly slanted `#` on the indigo accent colour.
- **In the code:** the name and tagline live in `client/src/brand.js`. `VITE_PUBLIC_URL=https://hashlite.io` is set in `.env`.
- This was a web and registry check only, not a trademark check.

## Walkthrough: what a user experiences now

- **Sign-up and welcome doc:** a new user lands on sign-up (a returning user sees sign-in). Errors show next to the form, and the email is kept when switching between the two forms. The welcome document shows math, a diagram, a table, highlighted code, a task list and footnotes.
- **Editing:** every toolbar button works on an empty line and on a selection, and pressing it again undoes it. Ctrl+/ switches between editor, split and preview without commenting out the line. Keyboard combinations that type characters (AltGr on European layouts) no longer trigger shortcuts.
- **Scrolling, outline and history:** the editor and preview scroll together in both directions, and clicking the outline moves both. Version history keeps the text *before* it is overwritten, so the last state of a writing session is never lost. Restoring a version keeps the current text in the history.
- **Organising:** folders, drag and drop, search with highlighted matches, and the trash all work, with an Undo toast after moving something to the trash.
- **Import and export:**
  - A dropped Markdown file becomes a new document and leaves the open document alone.
  - The exported HTML works offline.
  - Printing always uses the light theme, diagrams included.
- **Two tabs or devices:** when both change the same document, the default choice is **Keep both**. Renaming in one tab never undoes changes in another, and a document moved to the trash elsewhere offers "Restore it" or "Save as new document".
- **Offline:** the status reads "Offline – saved locally" and saving resumes when the connection is back. Signing out with unsaved text asks first.
- **Account dialog:** change password, download everything as a `.zip`, or delete the account.
- **Phone:** the sidebar is a drawer that keeps keyboard focus and closes with Escape. The theme choices move into the ⋯ menu, and tap targets are at least 40px.

## What was fixed

**Server**
- **Docker:** the image could not write its database. It now can, and it has a health check.
- **Behind a proxy:** the same-origin check blocked every write, sign-in included, behind a normal nginx setup. It now uses `Sec-Fetch-Site`, and falls back to comparing with the forwarded host.
- **Cookies:** a malformed cookie from another app on the same domain made every request fail with a server error.
- **Version history** now saves the text that is being replaced. Old versions are thinned out over time (all from the last day, then hourly, then daily).
- **Rate limits** are now per address, per email and per account, and they no longer slow down as they fill up.
- **Sessions** renew while you use them.
- **Accounts:** you can change your password, delete your account and download all your data. `server/admin.js` resets a password, since the app does not send email. Sign-ups can be closed, and each account has a storage limit.
- **Static files:** hashed files are cached forever and served as precompressed `.br`/`.gz`. A missing file returns a proper 404 instead of the app page.
- **Other fixes:**
  - Renaming or moving a document no longer causes false "changed elsewhere" conflicts.
  - A trashed document can no longer be saved to silently.
  - The server shuts down cleanly on SIGTERM.
  - Future database migrations can no longer wipe the version history.

**Editor**
- **Empty lines:** the heading, list, task and quote buttons put the cursor after the marker instead of before it.
- **Horizontal rule** no longer turns the paragraph above it into a heading.
- **Code block:** the button no longer swallows the rest of the document, and pressing it twice no longer nests fences.
- **Bold and italic:** Ctrl+I on bold text no longer breaks the bold, and trailing spaces are kept outside the markers so the formatting still renders.
- **Other commands:**
  - Lists over several paragraphs are numbered correctly.
  - Tasks inside quotes can be ticked.
  - The line-numbers setting survives switching documents.

**Preview and export**
- **Mermaid:** diagram syntax errors no longer leak "Syntax error" images into the page and the printout.
- **Heading links:** headings named "Links", "Title" or "Name" lost their anchor ids, and outline links didn't match the preview when heading names repeated. Both fixed.
- **Math:** the math renderer used a different KaTeX version than its stylesheet, so fractions, superscripts and limits had the wrong sizes.
- **Speed:** the preview re-renders only the blocks that changed, and skips rendering while it is hidden.
- **Download size:** simple diagrams no longer download the 1.4 MB ELK layout engine. They use a 40 KB one instead.
- **Contrast:** faint text now meets WCAG AA contrast in both themes.

**App**
- **Trash view:** it showed `[object HTMLDivElement]` instead of the documents.
- **Keyboard:** AltGr+backslash could not be typed on European keyboards, and Ctrl+S saved twice.
- **Saving:**
  - A title with trailing spaces caused an endless save loop.
  - After the session expired, the old page kept saving and could overwrite newer work.
  - Opening documents quickly one after another no longer lets the slowest response win.
- **Accessibility:** the whole app was a live region, which made screen readers read out every change. It now has a skip link, focus returns where it should after dialogs and menus, menus work with the arrow keys, and the folder buttons work from the keyboard.
- **Updates:** after a new version is deployed, the app offers to reload.

## Follow-up round (2026-09-25)

The "not done yet" list from the review, and what happened to each item.

### Done

- **Images.** Paste or drop an image into the editor, or use the Upload image button. It is stored on the server and inserted as `![name](/i/…)`. PNG, JPEG, GIF and WebP are accepted, up to 5 MB each. The type is checked from the file's contents, and SVG is refused because it can carry scripts. Images count toward the account's storage limit and are deleted with the account.
- **Read-only share links.** Use "Share read-only link…" in the ⋯ menu. Anyone with the link sees a plain page that the server renders: raw HTML is shown as text, math appears as MathML, and search engines are asked not to index it. "Stop sharing" turns the link off at once, and so does moving the document to the trash. Shared documents show a link icon in the sidebar.
- **Live updates between tabs.** Tabs in the same browser tell each other when something changes. The other tabs refresh the document list, and they load the new text of the open document if they have nothing unsaved. If they do have unsaved changes, the usual conflict choice appears.
- **Markdown extras:**
  - GitHub-style callouts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`).
  - `==highlight==`.
  - `:emoji:` shortcodes, the full GitHub set. Text smileys like `:)` stay as typed.
  - All of these work in the editor preview, the HTML export and shared pages.
- **Polish:**
  - The conflict dialog shows one full-width button per row.
  - Clicking Link or Image again keeps the URL selected instead of nesting a second link.
  - Restoring a version no longer adds a duplicate history entry.
  - The outline highlights the section at the top of the editor.
  - Tablets from 701px wide get the split view (it was 821px).

### Deferred

| Item | Why it waits |
| --- | --- |
| **Talking to AI models** (milestone M1 in [LLM-INTEGRATION.md](LLM-INTEGRATION.md)) | Deferred on request. The research and plan are ready: about 1.5–2 weeks for key storage and a chat panel. |
| **Live sync between devices** | Tabs in one browser sync now. Other devices pick up changes when their tab regains focus and are protected by the conflict check. True live sync needs a server push channel. |
| **A lighter first load for the editor** | Loading KaTeX and highlight.js only when a document needs them requires re-render plumbing. The editor is about 250 KB compressed, and the new public pages load almost no JavaScript. |
| **Old versions in the storage limit** | The limit counts document text and images. Old versions are capped by the history thinning instead. |
| **Managing uploaded images** | Images are kept until the account is deleted, even if no document uses them any more. A later "unused images" cleanup could free the space. |

## Move to Supabase (2026-09-25)

Accounts and documents moved from the built-in SQLite server to the Supabase project **HASHLITE** (EU):

- **Auth:** Supabase Auth, with email confirmation and **password reset by email**, which is no longer deferred.
- **Database:** the rules that used to live in the Node server are now database functions behind Row Level Security. They cover saving with version and conflict checks, history thinning, search, the storage limit, share links and account deletion.
- **Images:** stored in Supabase Storage.
- **Hosting:** the site is static files (Netlify, Cloudflare Pages or Vercel). The Node server, Docker image and SQLite code were removed; they are in git history.
- **Deviation from the plan:** creating a Supabase development branch kept timing out, so the migrations were applied to the new, empty HASHLITE project directly and tested there with temporary SQL test users, which were removed afterwards.

## Simpler UI, try-it editor, storage notice, styled emails (2026-09-25)

- **Simpler editor UI:**
  - The top bar has one button less: the colour themes moved into the ⋯ menu ("Theme…").
  - The formatting toolbar keeps the ten most used buttons. Strikethrough, inline code, image link, math and horizontal rule still work with their shortcuts and Markdown.
  - The status bar no longer shows the cursor position, and "Save version now" lives only in the history panel (and on Ctrl/⌘+S).
- **Editor on the home page:** the screenshot became a live editor with a preview that works without an account.
  - The text is kept in the browser.
  - **Save** opens /app with the sign-up form and "Create a free account to save the document you started". Signing in works too.
  - After sign-in the text becomes a document in the account and opens.
  - The renderer loads after the page, so the first paint stays plain HTML.
- **Storage notice:** a small one-time notice on every page. Hashlite has no tracking cookies and only stores what it needs (sign-in session, drafts, preferences), so it informs rather than asks for consent. The privacy page says the same.
- **Styled emails:** Hashlite-styled templates for Supabase Auth are in `supabase/templates/`. They are pasted into the Supabase dashboard, because the Supabase tools can't set Auth templates.

## The home page is the editor (2026-09-25)

- `/` opens straight into a full-screen editor. It is the app's editor and preview, and works without an account:
  - toolbar and shortcuts, split/editor/preview views, synced scrolling, ticking tasks, math, diagrams, themes, line numbers;
  - open a `.md` file, start a new document;
  - download `.md` or `.html`, print or save as PDF (Ctrl/⌘+P prints the document, not the page), and copy as formatted text.
- The text stays in the browser. **Save** moves it into an account (sign-up first, sign-in possible). When signed in, the header says "My documents".
- `/#text=<URL-encoded Markdown>` opens that text. When there is already edited text, it can be undone.
- The page is still static HTML with its h1, example document, AI-chat steps, features and FAQ, for search engines and AI crawlers. See `docs/SEO.md`.
- Also new: **Copy as formatted text** in the app's ⋯ menu; a `/learn/ai-chat-to-document` guide; a rewritten `llms.txt`.
- Theme code moved to `src/theme.js`; menus, toasts and icon buttons to `src/widgets.css`, so both pages share them.

## Google Analytics, with consent (2026-09-25)

- GA4 tag `G-SBBVL7JEWM`, set as `VITE_GA_ID` in `.env`. It is loaded by `src/analytics.js`, and only after the visitor chooses **Allow** in the cookie banner (`src/consent.js`). Before that, and after **Decline**, no Google script loads and no cookie is set.
- What is sent: the page address without `?…` or `#…`, so no document ids and no `#text=` content; share links as `/s` without their token. Google signals and ad personalisation are off. Share pages (`/s/…`) never load analytics.
- **Cookie settings** in every footer, on the privacy page and in the app's ⋯ menu ask again. **Decline** stops sending and removes the `_ga` cookies.
- The CSP allows `www.googletagmanager.com` scripts and the Google Analytics endpoints. The privacy page, FAQ and `llms.txt` no longer say "no analytics".

## Growth, first batch (2026-09-26)

- **Ten free tool pages**, generated from `build/tools.mjs` (`npm run gen:pages`). Each is the home editor with its own example, a highlighted main button, a how-to and a FAQ. Each keeps its own text in the browser, and **Save** hands it to the app. Also a `/tools` hub.
  - New code: **CSV / spreadsheet → Markdown table** (delimiter detection, quoted fields, escaped pipes, alignment) and a **grid table generator**.
  - The pre-rendered example's headings are shifted one level, so each page has exactly one h1.
- **Installable app (PWA):** manifest, service worker (offline start; hashed assets cached), and a **share target** that turns shared text into `#text=`.
- **Bookmarklet** on `/tools`: sends selected text on any page to the editor.
- **Credit line** in downloaded HTML ("Written with Hashlite"). On by default, with a switch in the ⋯ menu; not included when printing.
- New menu items: Copy HTML source; main buttons on the tool pages (Copy for Word / Docs, Save as PDF, Copy HTML, Open .md file, Copy Markdown).
- **IndexNow:** a key file and `.github/workflows/indexnow.yml`, which submits the sitemap after each production deploy (or on demand).
- **Launch kit:** `docs/LAUNCH.md`, for the owner to post.

## Connector for Claude and other MCP clients (2026-09-26)

- **Endpoint:** a public, read-only remote MCP server at `/api/mcp`.
  - Code: `api/mcp.js`, a Vercel function using the SDK's web-standard Streamable HTTP transport, stateless, with JSON responses and CORS.
  - Tools, in `mcp/server.js`:
    - `open_in_hashlite` returns a `#text=` link to the editor. Documents too long for a link get an explanation instead.
    - `csv_to_markdown_table` is the same converter as the web tool, moved to the DOM-free `client/src/table-md.js`.
    - `list_hashlite_tools`.
  - Every tool is annotated read-only. There is no account and nothing is stored.
- **Setup page:** `/connect` (Claude: Settings › Connectors › Add custom connector; Claude Code: `claude mcp add --transport http …`). It is linked from `/tools` and in `llms.txt`; the privacy page describes the connector.
- **Tests:** `npm run test:mcp` drives the official MCP client over HTTP (initialize, list tools, call each tool, CORS preflight). An e2e test opens a link the connector built.
- **Later (not built):** connecting a Hashlite account over OAuth, so Claude can list, search, read and save documents. The plan is in the session notes.

## Account connector: your documents in Claude (2026-09-26)

- **OAuth 2.1 for MCP:** discovery (`/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`), dynamic client registration, PKCE (S256 only), a consent page at `/oauth/authorize`, and a token endpoint with rotating refresh tokens.
- **No server secret:** the Vercel functions call database functions with the public key.
  - All checks happen in the database (`20260926100000_connector_oauth.sql`, tables in `private`). Tokens are random and stored only as SHA-256 hashes. Codes are single-use and last 10 minutes; access tokens last 1 hour; refresh tokens last 30 days and rotate.
  - `private.act_as(token)` sets `auth.uid()` for the transaction, so the app's own functions and ownership checks apply unchanged.
- **Tools** on `/api/account-mcp`: `search_documents`, `list_documents`, `read_document`, `create_document`, `update_document` (version check; the replaced text always goes into history), `share_document`, plus the three public tools.
- **Revoking:** Account › Connected apps lists connections, with Disconnect.
- **Consent screen:** it shows the app's self-declared name *and* the host you return to, since registration is open (as MCP expects).
- **Test:** one e2e test runs the whole flow against the live database:
  - discovery, the 401 challenge, and registration (including a refused non-https redirect);
  - a refused unregistered redirect, sign-in, consent, a wrong verifier, code reuse;
  - every tool, including the stale-version guard;
  - refresh rotation, and Disconnect.
- **Advisors:** the only new warnings are the intended "security definer callable by anon" ones on the OAuth and `mcp_*` functions; each checks its own credential first.
